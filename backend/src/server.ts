import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { appointmentEventText } from '../../shared/appointments.ts'
import { buildIcs, zonedToUtc } from '../../shared/calendar.ts'
import { CATEGORIES } from '../../shared/catalog.ts'
import { addDays, isValidISO, today } from '../../shared/dates.ts'
import type { CategoryId, ImportResult, PublicAppointment, ScheduledAppointment } from '../../shared/types.ts'
import { deleteLogo, getLogo, LOGO_TYPES, LogoError, logoVersion, migrateBranding, saveLogo, type LogoType } from './branding.ts'
import {
  AppointmentError,
  confirmByToken,
  createAppointment,
  deleteAppointment,
  findByToken,
  listAppointments,
  listPatients,
  listToReschedule,
  markCalled,
  markSent,
  migrateAppointments,
  parseAppointment,
  setManualConfirmation,
  setToReschedule,
  updateAppointment,
} from './appointments.ts'
import { buildCampaigns } from './campaigns.ts'
import {
  CampaignError,
  createCustomCampaign,
  deleteCustomCampaign,
  listCustomCampaigns,
  migrateCustomCampaigns,
  parseFlyer,
  parseInput,
  saveCustomFlyer,
  updateCustomCampaign,
} from './customCampaigns.ts'
import { DataKeyError, initDataCrypto } from './dataCrypto.ts'
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
  ['application/octet-stream', XLSX, 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
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
  // Nome e logo dello studio sono visibili anche nella pagina di accesso: chi segue più studi
  // riconosce subito in quale sta entrando. Nessun altro dato prima del login.
  const { studioName, logoType, logoVersion, flyerStyle } = await readSettings()
  return {
    authenticated: !!user,
    user: user ? publicUser(user) : null,
    hasUsers: (await countUsers()) > 0,
    studio: { name: studioName, logoType, logoVersion, flyerStyle },
  }
})

app.addHook('onRequest', async (req) => {
  const path = req.url.split('?')[0]
  // Richieste arrivate dal server delle conferme (porta 8081, dominio pubblico dei link): solo le
  // rotte pubbliche e il logo. Nginx lo garantisce già; qui è la seconda protezione.
  if (req.headers['x-public-gateway']) {
    const allowed = path.startsWith('/api/public/') || (path === '/api/logo' && (req.method === 'GET' || req.method === 'HEAD'))
    if (!allowed) throw new HttpError(404, 'Non trovato')
    return
  }
  const open = ['/api/login', '/api/logout', '/api/health', '/api/me']
  if (open.includes(path)) return
  // Pagina di conferma degli appuntamenti: il paziente non ha un account, il codice nel link basta.
  if (path.startsWith('/api/public/')) return
  // Il logo si può leggere senza accesso (pagina di login); caricarlo o eliminarlo no.
  if (path === '/api/logo' && (req.method === 'GET' || req.method === 'HEAD')) return
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
  /** Indirizzo dello studio, mostrato nei volantini. */
  address: string
  /** Nome del dottore, mostrato nei volantini sotto "Studio odontoiatrico". */
  doctorName: string
  /** Logo dei volantini: uno di quelli pronti oppure quello caricato ("custom"). */
  logoType: LogoType
  /** Versione del logo caricato (0 = nessun logo caricato); serve anche a evitare la cache. */
  logoVersion: number
  /** Modello grafico dei volantini. */
  flyerStyle: FlyerStyle
  /** Indirizzo pubblico dell'app (es. https://studio.example.it), usato nei link di conferma. */
  publicUrl: string
}

const FLYER_STYLES = ['smile', 'mint'] as const
type FlyerStyle = (typeof FLYER_STYLES)[number]

async function logoSettings(): Promise<Pick<Settings, 'logoType' | 'logoVersion'>> {
  const version = await logoVersion()
  const stored = (await getSetting('logoType')) as LogoType | null
  // Senza un logo caricato, "custom" non ha senso: si torna alla famiglia di dentini.
  const logoType = stored && LOGO_TYPES.includes(stored) && (stored !== 'custom' || version) ? stored : 'famiglia'
  return { logoType, logoVersion: version }
}

/** "conferma.dominio.it/" → "https://conferma.dominio.it"; vuoto resta vuoto. Errore se non valido. */
function normalizePublicUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!url) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) {
    throw new Error("L'indirizzo pubblico deve iniziare con https:// (o http://)")
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Indirizzo pubblico non valido (es. https://studio.esempio.it)')
  }
  if (parsed.search || parsed.hash || parsed.username) throw new Error('Indirizzo pubblico non valido (es. https://studio.esempio.it)')
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
}

/** CONFIRM_URL del .env (scelto con setup.sh), normalizzato; ignorato se non valido. */
const ENV_CONFIRM_URL = (() => {
  try {
    return normalizePublicUrl(process.env.CONFIRM_URL ?? '')
  } catch {
    console.warn(`CONFIRM_URL non valido, ignorato: ${process.env.CONFIRM_URL}`)
    return ''
  }
})()

async function readSettings(): Promise<Settings> {
  return {
    studioName: (await getSetting('studioName')) ?? 'Studio Odontoiatrico',
    showPrices: (await getSetting('showPrices')) !== 'false',
    phone: (await getSetting('phone')) ?? '',
    address: (await getSetting('address')) ?? '',
    doctorName: (await getSetting('doctorName')) ?? '',
    ...(await logoSettings()),
    // "tech" è il vecchio nome del modello Mint.
    flyerStyle: ['mint', 'tech'].includes((await getSetting('flyerStyle')) ?? '') ? 'mint' : 'smile',
    // Impostato nell'app, altrimenti quello scelto con setup.sh (CONFIRM_URL nel .env).
    publicUrl: (await getSetting('publicUrl')) || ENV_CONFIRM_URL,
  }
}

app.get('/api/settings', async () => readSettings())

// Aggiorna solo i campi presenti nel corpo della richiesta.
app.put('/api/settings', async (req) => {
  const body = (req.body ?? {}) as { studioName?: unknown; showPrices?: unknown; phone?: unknown; address?: unknown; doctorName?: unknown; logoType?: unknown; flyerStyle?: unknown; publicUrl?: unknown }
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
  if (body.address !== undefined) {
    const address = String(body.address).replace(/\s+/g, ' ').trim()
    if (address.length > 120) throw new HttpError(400, 'Indirizzo troppo lungo (massimo 120 caratteri)')
    await setSetting('address', address)
  }
  if (body.doctorName !== undefined) {
    const doctorName = String(body.doctorName).replace(/\s+/g, ' ').trim()
    if (doctorName.length > 80) throw new HttpError(400, 'Nome del dottore troppo lungo (massimo 80 caratteri)')
    await setSetting('doctorName', doctorName)
  }
  if (body.logoType !== undefined) {
    if (!LOGO_TYPES.includes(body.logoType as LogoType)) throw new HttpError(400, 'Logo non valido')
    if (body.logoType === 'custom' && !(await logoVersion())) throw new HttpError(400, 'Carica prima il logo dello studio')
    await setSetting('logoType', String(body.logoType))
  }
  if (body.flyerStyle !== undefined) {
    // "tech" è il vecchio nome di Mint (pagine aperte prima dell'aggiornamento).
    const style = body.flyerStyle === 'tech' ? 'mint' : body.flyerStyle
    if (!FLYER_STYLES.includes(style as FlyerStyle)) throw new HttpError(400, 'Modello di volantino non valido')
    await setSetting('flyerStyle', String(style))
  }
  if (body.publicUrl !== undefined) {
    let url: string
    try {
      url = normalizePublicUrl(String(body.publicUrl))
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
    await setSetting('publicUrl', url)
  }
  return readSettings()
})

// ---------- Logo dello studio ----------

app.get('/api/logo', async (_req, reply) => {
  const logo = await getLogo()
  if (!logo) throw new HttpError(404, 'Nessun logo caricato')
  reply
    .header('content-type', logo.mime)
    .header('cache-control', 'public, max-age=86400')
    .header('x-content-type-options', 'nosniff')
    // Un SVG aperto direttamente non può eseguire nulla.
    .header('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  return reply.send(logo.data)
})

app.put('/api/logo', async (req) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Invia il file del logo (PNG, JPG, WebP o SVG).')
  try {
    await saveLogo(req.body)
  } catch (e) {
    if (e instanceof LogoError) throw new HttpError(400, e.message)
    throw e
  }
  await setSetting('logoType', 'custom')
  return readSettings()
})

app.delete('/api/logo', async () => {
  await deleteLogo()
  if ((await getSetting('logoType')) === 'custom') await setSetting('logoType', 'famiglia')
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
  color?: string | null
}

function parseServiceBody(b: ServiceBody) {
  const name = String(b.name ?? '').trim().slice(0, 80)
  if (!name) throw new HttpError(400, 'Nome prestazione obbligatorio')
  if (!b.category || !CAT_IDS.has(b.category)) throw new HttpError(400, 'Categoria non valida')
  const price = b.price === null || b.price === undefined || b.price === '' ? null : Number(b.price)
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new HttpError(400, 'Prezzo non valido')
  const color = b.color === null || b.color === undefined || b.color === '' ? null : String(b.color).toLowerCase()
  if (color !== null && !/^#[0-9a-f]{6}$/.test(color)) throw new HttpError(400, 'Colore non valido (formato #rrggbb)')
  return { name, category: b.category as CategoryId, price, active: b.active !== false, color }
}

app.post('/api/services', async (req) => {
  const s = parseServiceBody((req.body ?? {}) as ServiceBody)
  let id = slugify(s.name)
  const existing = new Set((await listServices()).map((x) => x.id))
  for (let i = 2; existing.has(id); i++) id = `${slugify(s.name)}-${i}`
  try {
    await pool.query(
      `INSERT INTO services (id, name, category, price, active, color, sort)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT coalesce(max(sort),0)+1 FROM services))`,
      [id, s.name, s.category, s.price, s.active, s.color],
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
    const r = await pool.query('UPDATE services SET name=$2, category=$3, price=$4, active=$5, color=$6 WHERE id=$1', [
      id, s.name, s.category, s.price, s.active, s.color,
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

// ---------- Campagne personalizzate ----------

function campaignId(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Campagna non valida')
  return id
}

/** Converte gli errori di validazione in risposte 400 (404 se la campagna non esiste). */
async function campaignCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof CampaignError) throw new HttpError(/non trovata/.test(e.message) ? 404 : 400, e.message)
    throw e
  }
}

app.get('/api/custom-campaigns', async (req) => {
  const q = req.query as { from?: string; to?: string }
  return listCustomCampaigns(optDate(q.from, 'from'), optDate(q.to, 'to'))
})

app.post('/api/custom-campaigns', async (req) => {
  const user = await sessionUser(req)
  return campaignCall(() => createCustomCampaign(parseInput(req.body), user?.username ?? null))
})

app.put('/api/custom-campaigns/:id', async (req) => campaignCall(() => updateCustomCampaign(campaignId(req), parseInput(req.body))))

app.put('/api/custom-campaigns/:id/flyer', async (req) =>
  campaignCall(() => saveCustomFlyer(campaignId(req), parseFlyer((req.body as { flyer?: unknown } | null)?.flyer ?? null))),
)

app.delete('/api/custom-campaigns/:id', async (req) => {
  await campaignCall(() => deleteCustomCampaign(campaignId(req)))
  return { ok: true }
})

// ---------- Appuntamenti ----------

function appointmentId(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Appuntamento non valido')
  return id
}

async function appointmentCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AppointmentError) throw new HttpError(/non trovato/.test(e.message) ? 404 : 400, e.message)
    throw e
  }
}

app.get('/api/appointments', async (req) => {
  const q = req.query as { from?: string; to?: string }
  return appointmentCall(() => listAppointments(assertDate(q.from, 'from'), assertDate(q.to, 'to')))
})

app.get('/api/appointments/patients', async () => listPatients())

app.get('/api/appointments/to-reschedule', async () => listToReschedule())

app.post('/api/appointments/:id/reschedule', async (req) => appointmentCall(() => setToReschedule(appointmentId(req))))

app.post('/api/appointments', async (req) => {
  const user = await sessionUser(req)
  return appointmentCall(() => createAppointment(parseAppointment(req.body), user?.username ?? null))
})

app.put('/api/appointments/:id', async (req) => appointmentCall(() => updateAppointment(appointmentId(req), parseAppointment(req.body))))

app.post('/api/appointments/:id/sent', async (req) => appointmentCall(() => markSent(appointmentId(req))))

app.post('/api/appointments/:id/call', async (req) => appointmentCall(() => markCalled(appointmentId(req))))

app.post('/api/appointments/:id/confirmation', async (req) => {
  const confirmed = (req.body as { confirmed?: unknown } | null)?.confirmed
  if (typeof confirmed !== 'boolean') throw new HttpError(400, 'Valore di confirmed non valido')
  return appointmentCall(() => setManualConfirmation(appointmentId(req), confirmed))
})

app.delete('/api/appointments/:id', async (req) => {
  await appointmentCall(() => deleteAppointment(appointmentId(req)))
  return { ok: true }
})

/** Solo ciò che serve al paziente: niente telefono, cognome o note interne. */
async function publicView(a: ScheduledAppointment): Promise<PublicAppointment> {
  const st = await readSettings()
  return {
    studio: { name: st.studioName, phone: st.phone, address: st.address, logoType: st.logoType, logoVersion: st.logoVersion, flyerStyle: st.flyerStyle },
    firstName: a.patientName.split(' ')[0],
    day: a.day,
    time: a.time,
    duration: a.duration,
    serviceName: a.serviceName,
    confirmed: a.confirmedAt !== null,
    confirmedAt: a.confirmedAt,
    past: a.day < today(),
    timeZone: STUDIO_TZ,
  }
}

// Fuso dello studio (variabile TZ del container): gli orari degli appuntamenti sono in quest'ora.
const STUDIO_TZ = process.env.TZ || 'Europe/Rome'

const NOT_FOUND = 'Link non valido o scaduto, oppure l\'appuntamento è stato annullato.'

app.get('/api/public/appointments/:token', async (req, reply) => {
  reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow')
  const a = await findByToken((req.params as { token: string }).token)
  if (!a) throw new HttpError(404, NOT_FOUND)
  return publicView(a)
})

// Evento da aggiungere al calendario del telefono (iPhone apre direttamente "Aggiungi evento").
app.get('/api/public/appointments/:token/calendar.ics', async (req, reply) => {
  const token = (req.params as { token: string }).token
  const a = await findByToken(token)
  if (!a) throw new HttpError(404, NOT_FOUND)
  const st = await readSettings()
  const start = zonedToUtc(a.day, a.time, STUDIO_TZ)
  const ics = buildIcs({
    // Stesso UID per lo stesso appuntamento: riaggiungendolo il calendario lo aggiorna invece di duplicarlo.
    uid: `${createHash('sha256').update(token).digest('hex').slice(0, 24)}@studio-odontoiatrico`,
    start,
    end: start + a.duration * 60_000,
    ...appointmentEventText({ studioName: st.studioName, studioPhone: st.phone, address: st.address, serviceName: a.serviceName }),
  })
  return reply
    .header('content-type', 'text/calendar; charset=utf-8')
    .header('content-disposition', `attachment; filename="appuntamento-${a.day}.ics"`)
    .header('cache-control', 'no-store')
    .header('x-robots-tag', 'noindex, nofollow')
    .send(ics)
})

// Conferma solo con POST (pulsante nella pagina): le anteprime dei link di WhatsApp fanno GET.
app.post('/api/public/appointments/:token/confirm', async (req, reply) => {
  reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow')
  const a = await confirmByToken((req.params as { token: string }).token)
  if (!a) throw new HttpError(404, NOT_FOUND)
  if (!a.confirmedAt) throw new HttpError(410, "L'appuntamento è già passato: non è più possibile confermarlo.")
  return publicView(a)
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
      await migrateCustomCampaigns()
      await migrateBranding()
      await migrateAppointments()
      break
    } catch (e) {
      if (attempt >= 30) throw e
      app.log.warn(`Database non pronto (tentativo ${attempt}), riprovo...`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  await loadSecret()
  await initDataCrypto()
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
  console.error(e instanceof DataKeyError ? `ERRORE: ${e.message}` : e)
  process.exit(1)
})
