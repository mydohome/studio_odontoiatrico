import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { CATEGORIES } from '../../shared/catalog.ts'
import { addDays, isValidISO, today } from '../../shared/dates.ts'
import type { CategoryId, ImportResult } from '../../shared/types.ts'
import { buildCampaigns } from './campaigns.ts'
import { getSetting, listRecords, listServices, migrate, pool, setSetting, writeDays } from './db.ts'
import { generateDemo } from './demo.ts'
import { buildExport, buildTemplate, parseImport } from './excel.ts'
import { authenticate, countUsers, getUserById, migrateUsers, type User } from './users.ts'

const PORT = Number(process.env.PORT ?? 3000)
const SESSION_DAYS = 30
const CAT_IDS = new Set<string>(CATEGORIES.map((c) => c.id))
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 10 * 1024 * 1024 })

app.addContentTypeParser(
  ['application/octet-stream', XLSX],
  { parseAs: 'buffer' },
  (_req, body, done) => done(null, body),
)

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, _req, reply) => {
  const status = err.status ?? err.statusCode ?? 500
  if (status >= 500) app.log.error(err)
  reply.status(status).send({ error: status >= 500 ? 'Errore interno del server' : err.message })
})

// ---------- Autenticazione ----------
// Sessione in un cookie firmato: <id utente>.<versione sessione>.<scadenza>.<firma>.
// La versione aumenta quando cambia la password: le sessioni precedenti smettono di valere.

let SECRET: Buffer = Buffer.alloc(0)

async function loadSecret() {
  let secret = process.env.SESSION_SECRET || (await getSetting('sessionSecret'))
  if (!secret) {
    secret = randomBytes(32).toString('base64url')
    await setSetting('sessionSecret', secret)
  }
  SECRET = createHmac('sha256', 'studio-odontoiatrico').update(secret).digest()
}

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url')

function readCookie(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

async function sessionUser(req: FastifyRequest): Promise<User | null> {
  const token = readCookie(req, 'sid')
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [uid, ver, exp, sig] = parts
  if (Number(exp) < Date.now()) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(`${uid}.${ver}.${exp}`))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const user = await getUserById(Number(uid))
  return user && user.sessionVersion === Number(ver) ? user : null
}

function setSession(reply: FastifyReply, req: FastifyRequest, user: User) {
  const exp = String(Date.now() + SESSION_DAYS * 86400000)
  const payload = `${user.id}.${user.sessionVersion}.${exp}`
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  reply.header(
    'set-cookie',
    `sid=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  )
}

const publicUser = (u: User) => ({ username: u.username, email: u.email })

// Tentativi falliti per nome utente: ogni errore aumenta l'attesa (max 5 s).
const failures = new Map<string, { n: number; at: number }>()

app.post('/api/login', async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string }
  const key = String(username ?? '').trim().toLowerCase()
  const f = failures.get(key)
  if (f && Date.now() - f.at < 15 * 60000) await new Promise((r) => setTimeout(r, Math.min(5000, 400 * f.n)))
  const user = await authenticate(String(username ?? ''), String(password ?? ''))
  if (!user) {
    failures.set(key, { n: (f?.n ?? 0) + 1, at: Date.now() })
    if (failures.size > 1000) failures.clear()
    throw new HttpError(401, 'Nome utente o password errati')
  }
  failures.delete(key)
  setSession(reply, req, user)
  return { ok: true, user: publicUser(user) }
})

app.post('/api/logout', async (_req, reply) => {
  reply.header('set-cookie', 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
  return { ok: true }
})

app.get('/api/health', async () => {
  await pool.query('SELECT 1')
  return { ok: true }
})

app.get('/api/me', async (req) => {
  const user = await sessionUser(req)
  return { authenticated: !!user, user: user ? publicUser(user) : null, hasUsers: (await countUsers()) > 0 }
})

app.addHook('onRequest', async (req) => {
  const open = ['/api/login', '/api/logout', '/api/health', '/api/me']
  if (open.includes(req.url.split('?')[0])) return
  if (!(await sessionUser(req))) throw new HttpError(401, 'Accesso richiesto')
})

// ---------- Validazione ----------

function assertDate(v: unknown, field = 'data'): string {
  if (typeof v !== 'string' || !isValidISO(v)) throw new HttpError(400, `Campo ${field} non valido`)
  return v
}

function optDate(v: unknown, field: string): string | undefined {
  return v === undefined || v === '' ? undefined : assertDate(v, field)
}

function assertQty(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new HttpError(400, 'Quantità non valida')
  return n
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'prestazione'
  )
}

// ---------- Impostazioni ----------

interface Settings {
  studioName: string
  /** Mostra prezzi e fatturato stimato nelle viste e nei file Excel. */
  showPrices: boolean
  /** Telefono / WhatsApp dello studio, usato nei volantini. */
  phone: string
}

async function readSettings(): Promise<Settings> {
  return {
    studioName: (await getSetting('studioName')) ?? 'Studio Odontoiatrico',
    showPrices: (await getSetting('showPrices')) !== 'false',
    phone: (await getSetting('phone')) ?? '',
  }
}

app.get('/api/settings', async () => readSettings())

// Aggiorna solo i campi presenti nel corpo della richiesta.
app.put('/api/settings', async (req) => {
  const body = (req.body ?? {}) as { studioName?: unknown; showPrices?: unknown; phone?: unknown }
  if (body.studioName !== undefined) {
    const name = String(body.studioName).trim().slice(0, 80)
    if (!name) throw new HttpError(400, 'Nome studio obbligatorio')
    await setSetting('studioName', name)
  }
  if (body.showPrices !== undefined) {
    if (typeof body.showPrices !== 'boolean') throw new HttpError(400, 'Valore di showPrices non valido')
    await setSetting('showPrices', String(body.showPrices))
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim()
    if (phone && !/^\+?[0-9 ./-]{6,20}$/.test(phone)) throw new HttpError(400, 'Numero di telefono non valido')
    await setSetting('phone', phone)
  }
  return readSettings()
})

// ---------- Prestazioni ----------

app.get('/api/services', async () => listServices())

interface ServiceBody {
  name?: string
  category?: string
  price?: number | string | null
  active?: boolean
  sort?: number
}

function parseServiceBody(b: ServiceBody) {
  const name = String(b.name ?? '').trim().slice(0, 80)
  if (!name) throw new HttpError(400, 'Nome prestazione obbligatorio')
  if (!b.category || !CAT_IDS.has(b.category)) throw new HttpError(400, 'Categoria non valida')
  const price = b.price === null || b.price === undefined || b.price === '' ? null : Number(b.price)
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new HttpError(400, 'Prezzo non valido')
  return { name, category: b.category as CategoryId, price, active: b.active !== false }
}

app.post('/api/services', async (req) => {
  const s = parseServiceBody((req.body ?? {}) as ServiceBody)
  let id = slugify(s.name)
  const existing = new Set((await listServices()).map((x) => x.id))
  for (let i = 2; existing.has(id); i++) id = `${slugify(s.name)}-${i}`
  try {
    await pool.query(
      `INSERT INTO services (id, name, category, price, active, sort)
       VALUES ($1,$2,$3,$4,$5,(SELECT coalesce(max(sort),0)+1 FROM services))`,
      [id, s.name, s.category, s.price, s.active],
    )
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Esiste già una prestazione con questo nome')
    throw e
  }
  return (await listServices()).find((x) => x.id === id)
})

app.put('/api/services/:id', async (req) => {
  const { id } = req.params as { id: string }
  const s = parseServiceBody((req.body ?? {}) as ServiceBody)
  try {
    const r = await pool.query('UPDATE services SET name=$2, category=$3, price=$4, active=$5 WHERE id=$1', [
      id, s.name, s.category, s.price, s.active,
    ])
    if (!r.rowCount) throw new HttpError(404, 'Prestazione non trovata')
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Esiste già una prestazione con questo nome')
    throw e
  }
  return (await listServices()).find((x) => x.id === id)
})

app.delete('/api/services/:id', async (req) => {
  const { id } = req.params as { id: string }
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM records WHERE service_id=$1', [id])
  if (rows[0].n > 0) {
    // Con storico: si disattiva per non perdere i dati.
    await pool.query('UPDATE services SET active=false WHERE id=$1', [id])
    return { deleted: false, deactivated: true }
  }
  await pool.query('DELETE FROM services WHERE id=$1', [id])
  return { deleted: true, deactivated: false }
})

// ---------- Registrazioni giornaliere ----------

app.get('/api/records', async (req) => {
  const q = req.query as { from?: string; to?: string }
  return listRecords(optDate(q.from, 'from'), optDate(q.to, 'to'))
})

app.get('/api/days/:date', async (req) => {
  const date = assertDate((req.params as { date: string }).date)
  const rows = await listRecords(date, date)
  return { date, items: Object.fromEntries(rows.map((r) => [r.s, r.q])) }
})

app.put('/api/days/:date', async (req) => {
  const date = assertDate((req.params as { date: string }).date)
  const { items } = (req.body ?? {}) as { items?: Record<string, unknown> }
  if (!items || typeof items !== 'object') throw new HttpError(400, 'Dati mancanti')
  const known = new Set((await listServices()).map((s) => s.id))
  const map = new Map<string, number>()
  for (const [sid, q] of Object.entries(items)) {
    if (!known.has(sid)) throw new HttpError(400, `Prestazione sconosciuta: ${sid}`)
    map.set(sid, assertQty(q))
  }
  await writeDays(new Map([[date, map]]), 'replace')
  return { date, items: Object.fromEntries([...map].filter(([, q]) => q > 0)) }
})

app.delete('/api/records', async (req) => {
  const { confirm } = req.query as { confirm?: string }
  if (confirm !== 'ELIMINA') throw new HttpError(400, 'Conferma mancante')
  await pool.query('DELETE FROM records')
  return { ok: true }
})

// ---------- Campagne ----------

app.get('/api/campaigns', async (req) => {
  const { months } = req.query as { months?: string }
  const horizon = Math.min(24, Math.max(1, Number(months) || 12))
  const [services, records] = await Promise.all([listServices(), listRecords()])
  return buildCampaigns(services, records, today(), horizon)
})

// ---------- Excel ----------

function sendXlsx(reply: FastifyReply, filename: string, buf: Buffer) {
  return reply
    .header('content-type', XLSX)
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(buf)
}

app.get('/api/excel/template', async (_req, reply) => {
  const { showPrices } = await readSettings()
  return sendXlsx(reply, 'template-prestazioni.xlsx', await buildTemplate(await listServices(), today(), showPrices))
})

app.get('/api/excel/export', async (_req, reply) => {
  const [services, records] = await Promise.all([listServices(), listRecords()])
  const { showPrices } = await readSettings()
  return sendXlsx(reply, `prestazioni-${today()}.xlsx`, await buildExport(services, records, showPrices))
})

app.post('/api/excel/import', async (req): Promise<ImportResult> => {
  const { mode } = req.query as { mode?: string }
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'File mancante')
  let parsed
  try {
    parsed = await parseImport(req.body, await listServices())
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  const imported = await writeDays(parsed.days, mode === 'sum' ? 'sum' : 'replace')
  return { rows: parsed.rows, days: parsed.days.size, imported, errors: parsed.errors }
})

// ---------- Dati dimostrativi ----------

app.post('/api/demo', async () => {
  const services = (await listServices()).filter((s) => s.active)
  const to = addDays(today(), -1)
  const from = `${Number(to.slice(0, 4)) - 2}-${to.slice(5, 7)}-01`
  const days = generateDemo(services, from, to)
  const imported = await writeDays(days, 'replace')
  return { days: days.size, imported }
})

// ---------- Avvio ----------

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate()
      await migrateUsers()
      break
    } catch (e) {
      if (attempt >= 30) throw e
      app.log.warn(`Database non pronto (tentativo ${attempt}), riprovo...`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  await loadSecret()
  await app.listen({ port: PORT, host: '0.0.0.0' })
  const n = await countUsers()
  console.log(`Backend in ascolto sulla porta ${PORT} · utenti configurati: ${n}`)
  if (n === 0) console.log('Nessun utente: creane uno con ./manage-users.sh create')
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close()
    await pool.end()
    process.exit(0)
  })
}

start().catch((e) => {
  console.error(e)
  process.exit(1)
})
