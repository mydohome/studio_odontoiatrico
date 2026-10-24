// Modulo Richieste web: il cliente compila un modulo su un dominio dedicato (aperto dal link del
// sito dello studio) e la richiesta compare nell'agenda come appuntamento «richiesta web», senza
// data, da richiamare e categorizzare. Tutto il modulo sta in questo file, in shared/webRequests.ts,
// in frontend/src/pages/Prenota.tsx e nelle colonne web_* di appointments (vedi README per eliminarlo).
//
// - Il codice del modulo è firmato (HMAC) e senza stato nel database: scade in 10 minuti e vale una
//   sola volta, perché il suo identificativo viene registrato con la richiesta (indice univoco).
// - Nome, telefono e testo sono cifrati come i dati dei pazienti. L'IP non si salva in chiaro: solo
//   un'impronta con chiave, per i limiti antispam, che si cancella dopo 7 giorni.
// - Le richieste non gestite si cancellano dopo 30 giorni.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  CONSENT_VERSION,
  LIMITS,
  MIN_FILL_MS,
  PHONE_RE,
  SLOTS,
  TOKEN_MAX_TOTAL_MS,
  TOKEN_TTL_MS,
  type BookingSession,
  type WebSlot,
} from '../../shared/webRequests.ts'
import { newToken } from './appointments.ts'
import { encrypt } from './dataCrypto.ts'
import { getSetting, pool, setSetting } from './db.ts'

export class WebRequestError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const MAX_PENDING = 200
const RETENTION_DAYS = 30
const IP_RETENTION_DAYS = 7
const PER_IP_HOUR = 3
const PER_IP_DAY = 8

export function bookingBaseUrl(): string | null {
  const raw = (process.env.BOOKING_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    return /^https?:$/.test(new URL(raw).protocol) ? raw : null
  } catch {
    return null
  }
}

// ---------- Codice firmato ----------
// v1.<nonce>.<apertura>.<emissione>.<firma>: apertura = quando il cliente ha aperto il modulo
// (non cambia nei rinnovi), emissione = quando è stato emesso questo codice.

const NONCE_RE = /^[A-Za-z0-9_-]{22}$/
const sig = (key: Buffer, payload: string) => createHmac('sha256', key).update(`booking|${payload}`).digest('base64url')

export function issueToken(key: Buffer, now: number, startedAt = now): { token: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url')
  const payload = `v1.${nonce}.${startedAt}.${now}`
  return { token: `${payload}.${sig(key, payload)}`, nonce }
}

export interface TokenInfo {
  nonce: string
  startedAt: number
  issuedAt: number
}

/** Dati del codice se la firma è valida e non è scaduto; altrimenti null. */
export function verifyToken(key: Buffer, token: unknown, now: number): TokenInfo | null {
  if (typeof token !== 'string' || token.length > 120) return null
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'v1' || !NONCE_RE.test(parts[1]) || !/^\d{10,15}$/.test(parts[2]) || !/^\d{10,15}$/.test(parts[3])) return null
  const expected = Buffer.from(sig(key, parts.slice(0, 4).join('.')))
  const given = Buffer.from(parts[4])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const startedAt = Number(parts[2])
  const issuedAt = Number(parts[3])
  if (issuedAt > now + 5000 || now - issuedAt > TOKEN_TTL_MS || issuedAt < startedAt || now - startedAt > TOKEN_MAX_TOTAL_MS) return null
  return { nonce: parts[1], startedAt, issuedAt }
}

// ---------- Validazione ----------

const clean = (v: unknown, field: string, max: number, required = true): string => {
  if (v !== undefined && typeof v !== 'string') throw new WebRequestError(`${field} non valido`)
  // Niente caratteri di controllo né di direzione del testo (usati per ingannare chi legge).
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/[ \t]+/g, ' ').trim()
  if (required && !s) throw new WebRequestError(`${field} obbligatorio`)
  if (s.length > max) throw new WebRequestError(`${field} troppo lungo (massimo ${max} caratteri)`)
  return s
}

export interface ParsedBooking {
  token: unknown
  name: string
  surname: string
  phone: string
  message: string
  slot: WebSlot
  honeypot: boolean
}

export function parseBooking(body: unknown): ParsedBooking {
  const b = (body ?? {}) as Record<string, unknown>
  const honeypot = typeof b.website === 'string' && b.website.trim() !== ''
  if (b.consent !== true) throw new WebRequestError('Per inviare la richiesta serve il consenso al trattamento dei dati.')
  const phone = clean(b.phone, 'Telefono', LIMITS.phone)
  if (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 6) throw new WebRequestError('Numero di telefono non valido')
  const slot = b.slot === undefined || b.slot === '' ? 'indifferente' : b.slot
  if (typeof slot !== 'string' || !(SLOTS as readonly string[]).includes(slot)) throw new WebRequestError('Fascia oraria non valida')
  return {
    token: b.token,
    name: clean(b.name, 'Nome', LIMITS.name),
    surname: clean(b.surname, 'Cognome', LIMITS.surname),
    phone,
    message: clean(String(b.message ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n'), 'Descrizione', LIMITS.message, false),
    slot: slot as WebSlot,
    honeypot,
  }
}

// ---------- Limiti ----------

/** Conta eventi per chiave in una finestra di tempo (in memoria: basta riavviare per azzerarla). */
export class WindowLimiter {
  private map = new Map<string, { n: number; since: number }>()
  private max: number
  private windowMs: number
  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }
  blocked(key: string, now = Date.now()): boolean {
    const e = this.map.get(key)
    return !!e && now - e.since < this.windowMs && e.n >= this.max
  }
  hit(key: string, now = Date.now()) {
    const e = this.map.get(key)
    if (e && now - e.since < this.windowMs) e.n++
    else {
      if (this.map.size > 5000) for (const [k, v] of this.map) if (now - v.since >= this.windowMs) this.map.delete(k)
      this.map.set(key, { n: 1, since: now })
    }
  }
}

// ---------- Schema e pulizia ----------

/** Cancella le richieste non gestite dopo 30 giorni e le impronte IP dopo 7. */
export async function purgeWebRequests(): Promise<void> {
  await pool.query(`DELETE FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL AND web_request_at < now() - make_interval(days => $1)`, [RETENTION_DAYS])
  await pool.query(`UPDATE appointments SET web_ip_hash = NULL WHERE web_ip_hash IS NOT NULL AND web_request_at < now() - make_interval(days => $1)`, [IP_RETENTION_DAYS])
}

export interface WebRequestsDeps {
  currentUser: (req: FastifyRequest) => Promise<string | null>
  studio: () => Promise<{ name: string; phone: string }>
  clientIp: (req: FastifyRequest) => string
  secret: () => Buffer
  enabled: () => Promise<boolean>
}

export const PRIVACY_KEY = 'bookingPrivacyUrl'

function normalizePrivacyUrl(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new WebRequestError("Indirizzo dell'informativa non valido (es. https://www.studio.it/privacy)")
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new WebRequestError("L'indirizzo dell'informativa deve iniziare con https://")
  if (s.length > 300) throw new WebRequestError('Indirizzo troppo lungo')
  return u.toString()
}

export function registerWebRequests(app: FastifyInstance, d: WebRequestsDeps) {
  // --- Staff (richiedono l'accesso: lo controlla l'hook globale del server) ---
  app.get('/api/web-requests/info', async () => ({ baseUrl: bookingBaseUrl(), privacyUrl: (await getSetting(PRIVACY_KEY)) ?? '' }))
  app.put('/api/web-requests/info', async (req) => {
    const url = normalizePrivacyUrl((req.body as { privacyUrl?: unknown } | null)?.privacyUrl)
    await setSetting(PRIVACY_KEY, url)
    return { baseUrl: bookingBaseUrl(), privacyUrl: url }
  })
  app.get('/api/web-requests/count', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL')
    return { count: rows[0].n as number }
  })

  // --- Pubbliche (dominio dedicato: senza accesso) ---
  const sessions = new WindowLimiter(30, 10 * 60_000) // codici emessi o rinnovati per IP
  const misses = new WindowLimiter(20, 15 * 60_000) // invii respinti per IP
  const headers = (reply: FastifyReply) =>
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer')

  const open = async (): Promise<{ name: string; phone: string; privacyUrl: string }> => {
    if (!(await d.enabled())) throw new WebRequestError('Le richieste online non sono al momento attive. Contatta direttamente lo studio.', 404)
    const privacyUrl = (await getSetting(PRIVACY_KEY)) ?? ''
    // Senza informativa il consenso non avrebbe un testo da leggere: il modulo resta chiuso.
    if (!privacyUrl) throw new WebRequestError('Le richieste online non sono al momento attive. Contatta direttamente lo studio.', 404)
    return { ...(await d.studio()), privacyUrl }
  }

  const session = (token: string, startedAt: number, studio: { name: string; phone: string; privacyUrl: string }): BookingSession => ({
    token,
    startedAt,
    expiresAt: Number(token.split('.')[3]) + TOKEN_TTL_MS,
    studio: { name: studio.name, phone: studio.phone },
    privacyUrl: studio.privacyUrl,
  })

  // Apertura del modulo: emette il primo codice.
  app.get('/api/public/requests/session', async (req, reply) => {
    headers(reply)
    const ip = d.clientIp(req)
    if (sessions.blocked(ip)) throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    sessions.hit(ip)
    const studio = await open()
    const now = Date.now()
    return session(issueToken(d.secret(), now).token, now, studio)
  })

  // Rinnovo mentre il cliente sta ancora scrivendo: serve un codice ancora valido.
  app.post('/api/public/requests/renew', async (req, reply) => {
    headers(reply)
    const ip = d.clientIp(req)
    if (sessions.blocked(ip)) throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    sessions.hit(ip)
    const studio = await open()
    const now = Date.now()
    const info = verifyToken(d.secret(), (req.body as { token?: unknown } | null)?.token, now)
    if (!info) throw new WebRequestError('Il modulo è scaduto: ricarica la pagina per ricominciare.', 410)
    // Un codice già usato non si rinnova.
    const used = await pool.query('SELECT 1 FROM appointments WHERE web_nonce = $1', [info.nonce])
    if (used.rowCount) throw new WebRequestError('Richiesta già inviata.', 410)
    return session(issueToken(d.secret(), now, info.startedAt).token, info.startedAt, studio)
  })

  app.post('/api/public/requests/submit', async (req, reply) => {
    headers(reply)
    const ip = d.clientIp(req)
    if (misses.blocked(ip)) {
      reply.header('retry-after', '900')
      throw new WebRequestError('Troppe richieste: riprova più tardi.', 429)
    }
    try {
      await open()
      const input = parseBooking(req.body)
      const now = Date.now()
      const info = verifyToken(d.secret(), input.token, now)
      if (!info) throw new WebRequestError('Il modulo è scaduto: ricarica la pagina per ricominciare.', 410)
      if (now - info.startedAt < MIN_FILL_MS) throw new WebRequestError('Troppo veloce: riprova tra qualche secondo.', 429)
      // Trappola per i programmi automatici: si risponde come se fosse andata bene, senza salvare nulla.
      if (input.honeypot) return { ok: true }

      const ipHash = createHmac('sha256', d.secret()).update(`ip|${ip}`).digest('hex').slice(0, 32)
      const recent = await pool.query(
        `SELECT count(*) FILTER (WHERE web_request_at > now() - interval '1 hour')::int AS h, count(*)::int AS d
         FROM appointments WHERE web_ip_hash = $1 AND web_request_at > now() - interval '1 day'`,
        [ipHash],
      )
      if (recent.rows[0].h >= PER_IP_HOUR || recent.rows[0].d >= PER_IP_DAY) {
        throw new WebRequestError('Hai già inviato diverse richieste: per altre telefona allo studio.', 429)
      }
      const pending = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL')
      if (pending.rows[0].n >= MAX_PENDING) {
        throw new WebRequestError('In questo momento non riusciamo a ricevere altre richieste online: telefona allo studio.', 503)
      }

      const privacyUrl = (await getSetting(PRIVACY_KEY)) ?? ''
      try {
        await pool.query(
          `INSERT INTO appointments (day, start_time, duration_min, patient_name, patient_phone, notes, token, created_by,
             web_request_at, web_slot, web_nonce, web_consent, web_ip_hash)
           VALUES (NULL, NULL, 30, $1, $2, $3, $4, NULL, now(), $5, $6, $7, $8)`,
          [
            encrypt(`${input.name} ${input.surname}`, 'patient_name'),
            encrypt(input.phone, 'patient_phone'),
            encrypt(input.message, 'notes'),
            newToken(),
            input.slot,
            info.nonce,
            `${CONSENT_VERSION} ${privacyUrl}`.slice(0, 400),
            ipHash,
          ],
        )
      } catch (e) {
        // Indice univoco sul codice: stesso modulo inviato due volte.
        if ((e as { code?: string }).code === '23505') throw new WebRequestError('Richiesta già inviata.', 410)
        throw e
      }
      return { ok: true }
    } catch (e) {
      if (e instanceof WebRequestError && e.status !== 404) misses.hit(ip)
      throw e
    }
  })
}
