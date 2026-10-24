// Pagina pubblica «richiesta di appuntamento»: server del container «booking», separato dal gestionale.
// Non ha DATA_KEY, SESSION_SECRET né la password del database principale: si collega con un utente che vede
// solo lo schema `inbox` (richieste sigillate con una chiave pubblica che non sa riaprire, codici già usati,
// contatori per IP e le impostazioni pubblicate dal gestionale). Il gestionale poi importa le richieste.

import { createHmac } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type pg from 'pg'
import { CONSENT_VERSION, MIN_FILL_MS, TOKEN_TTL_MS, type BookingSession } from '../../shared/webRequests.ts'
import { issueToken, MAX_PENDING, parseBooking, verifyToken, WebRequestError, WindowLimiter } from './bookingCore.ts'
import { seal } from './inboxCrypto.ts'

const PER_IP_HOUR = 3
const PER_IP_DAY = 8
/** Se il gestionale non aggiorna le impostazioni da più di 5 minuti (fermo o guasto) il modulo si chiude. */
const CONFIG_MAX_AGE_S = 300
const CLOSED = 'Le richieste online non sono al momento attive. Contatta direttamente lo studio.'

interface Config {
  studioName: string
  phone: string
  privacyUrl: string
  pubkey: Buffer
  pending: number
}

export function buildBookingApp(db: pg.Pool, secret: string): FastifyInstance {
  const key = createHmac('sha256', 'studio-booking').update(secret).digest()
  const app = Fastify({ logger: { level: 'warn' }, trustProxy: false, bodyLimit: 16 * 1024 })

  app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, _req, reply) => {
    const status = err.status ?? err.statusCode ?? 500
    if (status >= 500) app.log.error(err)
    reply.status(status).send({ error: status >= 500 ? 'Errore interno del server' : err.message })
  })

  // Da qui si risponde solo alle rotte del modulo, e solo se arrivano dal server web con l'intestazione giusta.
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0]
    if (path === '/api/health') return
    if (req.headers['x-public-gateway'] !== 'requests' || !path.startsWith('/api/public/requests/')) throw new WebRequestError('Non trovato', 404)
  })

  app.get('/api/health', async () => {
    await db.query('SELECT 1')
    return { ok: true }
  })

  const clientIp = (req: FastifyRequest) => String(req.headers['x-real-ip'] ?? req.ip)
  const headers = (reply: FastifyReply) =>
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer')

  /** Impostazioni pubblicate dal gestionale; chiude il modulo se mancano, sono vecchie o è spento. */
  async function config(): Promise<Config> {
    const { rows } = await db.query<{ key: string; value: string; fresh: boolean }>(
      `SELECT key, value, updated_at > now() - make_interval(secs => $1) AS fresh FROM inbox.config`,
      [CONFIG_MAX_AGE_S],
    )
    const c = new Map(rows.map((r) => [r.key, r]))
    const get = (k: string) => c.get(k)?.value ?? ''
    const pubkey = Buffer.from(get('pubkey'), 'base64url')
    if (get('enabled') !== 'true' || !c.get('enabled')?.fresh || pubkey.length !== 32 || !get('privacyUrl')) throw new WebRequestError(CLOSED, 404)
    return { studioName: get('studioName'), phone: get('phone'), privacyUrl: get('privacyUrl'), pubkey, pending: Number(get('pending')) || 0 }
  }

  const sessions = new WindowLimiter(30, 10 * 60_000) // codici emessi o rinnovati per IP
  const misses = new WindowLimiter(20, 15 * 60_000) // invii respinti per IP

  const session = (token: string, startedAt: number, c: Config): BookingSession => ({
    token,
    startedAt,
    expiresAt: Number(token.split('.')[3]) + TOKEN_TTL_MS,
    studio: { name: c.studioName, phone: c.phone },
    privacyUrl: c.privacyUrl,
  })

  app.get('/api/public/requests/session', async (req, reply) => {
    headers(reply)
    const ip = clientIp(req)
    if (sessions.blocked(ip)) throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    sessions.hit(ip)
    const c = await config()
    const now = Date.now()
    return session(issueToken(key, now).token, now, c)
  })

  app.post('/api/public/requests/renew', async (req, reply) => {
    headers(reply)
    const ip = clientIp(req)
    if (sessions.blocked(ip)) throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    sessions.hit(ip)
    const c = await config()
    const now = Date.now()
    const info = verifyToken(key, (req.body as { token?: unknown } | null)?.token, now)
    if (!info) throw new WebRequestError('Il modulo è scaduto: ricarica la pagina per ricominciare.', 410)
    if ((await db.query('SELECT 1 FROM inbox.nonces WHERE nonce = $1', [info.nonce])).rowCount) throw new WebRequestError('Richiesta già inviata.', 410)
    return session(issueToken(key, now, info.startedAt).token, info.startedAt, c)
  })

  app.post('/api/public/requests/submit', async (req, reply) => {
    headers(reply)
    const ip = clientIp(req)
    if (misses.blocked(ip)) {
      reply.header('retry-after', '900')
      throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    }
    try {
      const c = await config()
      const input = parseBooking(req.body)
      const now = Date.now()
      const info = verifyToken(key, input.token, now)
      if (!info) throw new WebRequestError('Il modulo è scaduto: ricarica la pagina per ricominciare.', 410)
      if (now - info.startedAt < MIN_FILL_MS) throw new WebRequestError('Troppo veloce: riprova tra qualche secondo.', 429)
      // Trappola per i programmi automatici: si risponde come se fosse andata bene, senza salvare nulla.
      if (input.honeypot) return { ok: true }

      const ipHash = createHmac('sha256', key).update(`ip|${ip}`).digest('hex').slice(0, 32)
      const recent = await db.query(
        `SELECT count(*) FILTER (WHERE at > now() - interval '1 hour')::int AS h, count(*)::int AS d
         FROM inbox.hits WHERE ip_hash = $1 AND at > now() - interval '1 day'`,
        [ipHash],
      )
      if (recent.rows[0].h >= PER_IP_HOUR || recent.rows[0].d >= PER_IP_DAY) {
        throw new WebRequestError('Hai già inviato diverse richieste: per altre telefona allo studio.', 429)
      }
      const queued = (await db.query('SELECT count(id)::int AS n FROM inbox.requests')).rows[0].n as number
      if (c.pending + queued >= MAX_PENDING) {
        throw new WebRequestError('In questo momento non riusciamo a ricevere altre richieste online: telefona allo studio.', 503)
      }

      const sealed = seal(
        c.pubkey,
        JSON.stringify({ name: input.name, surname: input.surname, phone: input.phone, message: input.message }),
        info.nonce,
      )
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        try {
          // Il codice si registra qui: riusarlo, anche dopo che la richiesta è passata nell'agenda, dà errore.
          await client.query('INSERT INTO inbox.nonces (nonce) VALUES ($1)', [info.nonce])
        } catch (e) {
          await client.query('ROLLBACK')
          if ((e as { code?: string }).code === '23505') throw new WebRequestError('Richiesta già inviata.', 410)
          throw e
        }
        await client.query('INSERT INTO inbox.requests (nonce, sealed, slot, consent, ip_hash) VALUES ($1,$2,$3,$4,$5)', [
          info.nonce,
          sealed,
          input.slot,
          `${CONSENT_VERSION} ${c.privacyUrl}`.slice(0, 400),
          ipHash,
        ])
        await client.query('INSERT INTO inbox.hits (ip_hash) VALUES ($1)', [ipHash])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
      return { ok: true }
    } catch (e) {
      if (e instanceof WebRequestError && e.status !== 404) misses.hit(ip)
      throw e
    }
  })

  return app
}
