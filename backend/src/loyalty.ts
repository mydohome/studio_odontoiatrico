// Modulo Fidelity card (carta a timbri digitale). Tutto il modulo sta in questo file, in
// shared/loyalty.ts e in frontend/src/loyalty/: per eliminarlo vedi la sezione "Fidelity card" del README.
//
// - Il link pubblico della carta contiene un token di 192 bit generato con CSPRNG, mai derivato da
//   dati del cliente. Nel database c'è solo la sua impronta SHA-256 (per cercarla) e il token cifrato
//   con DATA_KEY (per poter rimandare lo stesso link): un dump non contiene link utilizzabili.
// - Nome e telefono del cliente sono cifrati come i dati dei pazienti.
// - La pagina pubblica mostra il minimo: nome di battesimo, timbri, premio e codice breve.

import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { addDays, today } from '../../shared/dates.ts'
import {
  cardStatus,
  checkStamp,
  CARD_PATH,
  firstName,
  formatShortCode,
  readCardCode,
  shortCodeFromRandom,
  TOKEN_RE,
  type LoyaltyCard,
  type LoyaltyCardDetail,
  type LoyaltyProgram,
  type LoyaltyStamp,
  type PublicLoyaltyCard,
  type StampResult,
} from '../../shared/loyalty.ts'
import { decrypt, encrypt } from './dataCrypto.ts'
import { getSetting, pool, setSetting } from './db.ts'

export class LoyaltyError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const STUDIO_TZ = process.env.TZ || 'Europe/Rome'
const MAX_STAMPS = 50

// ---------- Token e codici ----------

/** 24 byte da CSPRNG in base64url: 32 caratteri, 192 bit. Nessun legame con i dati del cliente. */
export const newToken = () => randomBytes(24).toString('base64url')

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Dominio dedicato alle carte (diverso da quello del portale), es. https://carte.dominio.it. */
export function cardBaseUrl(): string | null {
  const raw = (process.env.CARD_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const u = new URL(raw)
    return /^https?:$/.test(u.protocol) ? raw : null
  } catch {
    return null
  }
}

export const cardUrl = (token: string): string | null => {
  const base = cardBaseUrl()
  return base ? `${base}${CARD_PATH}${token}` : null
}

// ---------- Schema ----------

export async function migrateLoyalty(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_programs (
      id              serial PRIMARY KEY,
      name            text NOT NULL,
      stamps_required integer NOT NULL CHECK (stamps_required BETWEEN 1 AND ${MAX_STAMPS}),
      reward          text NOT NULL,
      valid_days      integer CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3650),
      cooldown_hours  integer NOT NULL DEFAULT 12 CHECK (cooldown_hours BETWEEN 0 AND 720),
      active          boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS loyalty_cards (
      id              serial PRIMARY KEY,
      program_id      integer REFERENCES loyalty_programs(id) ON DELETE SET NULL,
      program_name    text NOT NULL,
      stamps_required integer NOT NULL CHECK (stamps_required BETWEEN 1 AND ${MAX_STAMPS}),
      reward          text NOT NULL,
      holder_name     text NOT NULL,
      holder_phone    text NOT NULL DEFAULT '',
      token_hash      text NOT NULL UNIQUE,
      token_enc       text NOT NULL,
      short_code      text NOT NULL UNIQUE,
      expires_on      date,
      consent_at      timestamptz,
      created_by      text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      completed_at    timestamptz,
      disabled_at     timestamptz,
      disabled_by     text
    );
    CREATE TABLE IF NOT EXISTS loyalty_stamps (
      id         serial PRIMARY KEY,
      card_id    integer NOT NULL REFERENCES loyalty_cards(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text,
      note       text NOT NULL DEFAULT '',
      voided_at  timestamptz,
      voided_by  text
    );
    CREATE INDEX IF NOT EXISTS loyalty_stamps_card ON loyalty_stamps (card_id);
  `)
  // Programma di partenza (una volta sola: poi lo gestisce lo studio).
  if (!(await getSetting('loyaltyInit'))) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM loyalty_programs')
    if (rows[0].n === 0) {
      await pool.query('INSERT INTO loyalty_programs (name, stamps_required, reward, valid_days, cooldown_hours) VALUES ($1,$2,$3,NULL,12)', [
        'Carta fedeltà',
        10,
        'Igiene professionale gratuita',
      ])
    }
    await setSetting('loyaltyInit', '1')
  }
}

// ---------- Programma ----------

interface ProgramRow {
  id: number
  name: string
  stamps_required: number
  reward: string
  valid_days: number | null
  cooldown_hours: number
}

const toProgram = (r: ProgramRow): LoyaltyProgram => ({
  id: r.id,
  name: r.name,
  stampsRequired: r.stamps_required,
  reward: r.reward,
  validDays: r.valid_days,
  cooldownHours: r.cooldown_hours,
})

/** Il programma attivo (se non c'è se ne crea uno, così il modulo non resta senza). */
export async function getProgram(): Promise<LoyaltyProgram> {
  const { rows } = await pool.query<ProgramRow>('SELECT * FROM loyalty_programs WHERE active ORDER BY id LIMIT 1')
  if (rows[0]) return toProgram(rows[0])
  const r = await pool.query<ProgramRow>(
    `INSERT INTO loyalty_programs (name, stamps_required, reward, valid_days, cooldown_hours)
     VALUES ('Carta fedeltà', 10, 'Igiene professionale gratuita', NULL, 12) RETURNING *`,
  )
  return toProgram(r.rows[0])
}

const intIn = (v: unknown, field: string, min: number, max: number, nullable = false): number | null => {
  if (nullable && (v === null || v === undefined || v === '')) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new LoyaltyError(`${field}: un numero intero tra ${min} e ${max}`)
  return n
}

const text = (v: unknown, field: string, max: number, required = false): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (required && !s) throw new LoyaltyError(`${field} obbligatorio`)
  if (s.length > max) throw new LoyaltyError(`${field} troppo lungo (massimo ${max} caratteri)`)
  return s
}

/** Modifica il programma: vale per le carte create da ora (quelle già emesse tengono timbri e premio di allora). */
export async function updateProgram(body: unknown): Promise<LoyaltyProgram> {
  const b = (body ?? {}) as Record<string, unknown>
  const current = await getProgram()
  const name = text(b.name, 'Nome del programma', 60, true)
  const reward = text(b.reward, 'Premio', 120, true)
  const stampsRequired = intIn(b.stampsRequired, 'Timbri richiesti', 1, MAX_STAMPS)!
  const validDays = intIn(b.validDays, 'Validità (giorni)', 1, 3650, true)
  const cooldownHours = intIn(b.cooldownHours, 'Ore tra due timbri', 0, 720)!
  const r = await pool.query<ProgramRow>(
    `UPDATE loyalty_programs SET name=$2, stamps_required=$3, reward=$4, valid_days=$5, cooldown_hours=$6 WHERE id=$1 RETURNING *`,
    [current.id, name, stampsRequired, reward, validDays, cooldownHours],
  )
  return toProgram(r.rows[0])
}

// ---------- Lettura delle carte ----------

interface CardRow {
  id: number
  program_name: string
  stamps_required: number
  reward: string
  holder_name: string
  holder_phone: string
  token_hash: string
  token_enc: string
  short_code: string
  expires_on: string | null
  consent_at: string | null
  created_by: string | null
  created_at: string
  completed_at: string | null
  disabled_at: string | null
  stamps: number
  last_stamp_at: string | null
}

const CARD_SELECT = `
  SELECT c.*,
    (SELECT count(*)::int FROM loyalty_stamps s WHERE s.card_id = c.id AND s.voided_at IS NULL) AS stamps,
    (SELECT max(s.created_at) FROM loyalty_stamps s WHERE s.card_id = c.id AND s.voided_at IS NULL) AS last_stamp_at
  FROM loyalty_cards c`

function toCard(r: CardRow): LoyaltyCard {
  const base = { disabledAt: r.disabled_at, completedAt: r.completed_at, expiresOn: r.expires_on }
  return {
    id: r.id,
    holderName: decrypt(r.holder_name, 'lc_name'),
    holderPhone: decrypt(r.holder_phone, 'lc_phone'),
    shortCode: r.short_code,
    programName: r.program_name,
    stampsRequired: r.stamps_required,
    reward: r.reward,
    stamps: r.stamps,
    lastStampAt: r.last_stamp_at,
    status: cardStatus(base, today()),
    expiresOn: r.expires_on,
    createdAt: r.created_at,
    createdBy: r.created_by,
    completedAt: r.completed_at,
    disabledAt: r.disabled_at,
    consentAt: r.consent_at,
  }
}

async function cardRow(id: number): Promise<CardRow> {
  const { rows } = await pool.query<CardRow>(`${CARD_SELECT} WHERE c.id = $1`, [id])
  if (!rows[0]) throw new LoyaltyError('Carta non trovata', 404)
  return rows[0]
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Elenco con ricerca per cliente, telefono o codice breve e filtro per stato (nomi cifrati: si filtra qui). */
export async function listCards(q: string, status: string): Promise<LoyaltyCard[]> {
  const { rows } = await pool.query<CardRow>(`${CARD_SELECT} ORDER BY c.created_at DESC, c.id DESC`)
  const words = fold(q).split(/\s+/).filter(Boolean)
  const digits = q.replace(/\D/g, '')
  const short = q.toUpperCase().replace(/[\s-]/g, '')
  return rows
    .map(toCard)
    .filter((c) => !status || status === 'tutte' || c.status === status)
    .filter((c) => {
      if (!words.length) return true
      const name = fold(c.holderName)
      return words.every((w) => name.includes(w)) || (digits.length >= 4 && c.holderPhone.replace(/\D/g, '').includes(digits)) || (short.length >= 3 && c.shortCode.includes(short))
    })
    .slice(0, 500)
}

async function history(id: number): Promise<LoyaltyStamp[]> {
  const { rows } = await pool.query(
    `SELECT id, created_at AS at, created_by AS by, note, voided_at AS "voidedAt", voided_by AS "voidedBy"
     FROM loyalty_stamps WHERE card_id = $1 ORDER BY created_at DESC, id DESC`,
    [id],
  )
  return rows.map((r) => ({ ...r, note: decrypt(r.note, 'lc_note') }))
}

export async function getDetail(id: number): Promise<LoyaltyCardDetail> {
  const r = await cardRow(id)
  return { ...toCard(r), history: await history(id), url: cardUrl(decrypt(r.token_enc, 'lc_token')) }
}

// ---------- Creazione e modifica ----------

const PHONE_RE = /^\+?[0-9 ./()-]{6,20}$/

function parseHolder(b: Record<string, unknown>) {
  const name = text(b.name, 'Nome del cliente', 80, true)
  const phone = text(b.phone, 'Telefono', 20)
  if (phone && (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 6)) throw new LoyaltyError('Numero di telefono non valido')
  return { name, phone }
}

const isUnique = (e: unknown) => (e as { code?: string }).code === '23505'

export async function createCard(body: unknown, user: string | null): Promise<LoyaltyCardDetail> {
  const b = (body ?? {}) as Record<string, unknown>
  const holder = parseHolder(b)
  const program = await getProgram()
  const expires = program.validDays ? addDays(today(), program.validDays) : null
  for (let attempt = 0; attempt < 8; attempt++) {
    const token = newToken()
    try {
      const { rows } = await pool.query(
        `INSERT INTO loyalty_cards (program_id, program_name, stamps_required, reward, holder_name, holder_phone,
           token_hash, token_enc, short_code, expires_on, consent_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          program.id,
          program.name,
          program.stampsRequired,
          program.reward,
          encrypt(holder.name, 'lc_name'),
          encrypt(holder.phone, 'lc_phone'),
          tokenHash(token),
          encrypt(token, 'lc_token'),
          shortCodeFromRandom(randomBytes(8)),
          expires,
          b.consent === true ? new Date().toISOString() : null,
          user,
        ],
      )
      return getDetail(rows[0].id)
    } catch (e) {
      if (!isUnique(e)) throw e // codice breve già usato: se ne prova un altro
    }
  }
  throw new LoyaltyError('Non sono riuscito a generare un codice univoco: riprova.', 500)
}

export async function updateCard(id: number, body: unknown): Promise<LoyaltyCardDetail> {
  const b = (body ?? {}) as Record<string, unknown>
  const holder = parseHolder(b)
  const consent = b.consent === true ? new Date().toISOString() : b.consent === false ? null : undefined
  const r = await pool.query(
    `UPDATE loyalty_cards SET holder_name = $2, holder_phone = $3, consent_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE consent_at END WHERE id = $1`,
    [id, encrypt(holder.name, 'lc_name'), encrypt(holder.phone, 'lc_phone'), consent !== undefined, consent ?? null],
  )
  if (!r.rowCount) throw new LoyaltyError('Carta non trovata', 404)
  return getDetail(id)
}

export async function setDisabled(id: number, disabled: boolean, user: string | null): Promise<LoyaltyCardDetail> {
  const r = disabled
    ? await pool.query('UPDATE loyalty_cards SET disabled_at = coalesce(disabled_at, now()), disabled_by = $2 WHERE id = $1', [id, user])
    : await pool.query('UPDATE loyalty_cards SET disabled_at = NULL, disabled_by = NULL WHERE id = $1', [id])
  if (!r.rowCount) throw new LoyaltyError('Carta non trovata', 404)
  return getDetail(id)
}

/** Nuovo link: quello vecchio smette subito di funzionare (es. se il cliente lo ha condiviso per sbaglio). */
export async function regenerateLink(id: number): Promise<LoyaltyCardDetail> {
  const token = newToken()
  const r = await pool.query('UPDATE loyalty_cards SET token_hash = $2, token_enc = $3 WHERE id = $1', [id, tokenHash(token), encrypt(token, 'lc_token')])
  if (!r.rowCount) throw new LoyaltyError('Carta non trovata', 404)
  return getDetail(id)
}

// ---------- Timbri ----------

const when = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: STUDIO_TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

const BLOCK_MESSAGE = {
  disattivata: 'La carta è disattivata.',
  scaduta: 'La carta è scaduta.',
  completata: 'La carta è già completa: il premio è stato raggiunto.',
} as const

/**
 * Aggiunge un timbro. Con `force` (solo dal dettaglio, per correzioni) non si applica l'attesa tra due
 * timbri. Si lavora con la carta bloccata, così due scansioni insieme non danno due timbri.
 */
export async function addStamp(id: number, user: string | null, opts: { force?: boolean; note?: string } = {}, nowMs = Date.now()): Promise<StampResult> {
  const note = text(opts.note, 'Nota', 200)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT id FROM loyalty_cards WHERE id = $1 FOR UPDATE', [id])
    if (!locked.rowCount) throw new LoyaltyError('Carta non trovata', 404)
    const { rows } = await client.query<CardRow>(`${CARD_SELECT} WHERE c.id = $1`, [id])
    const card = toCard(rows[0])
    const cooldown = (await getProgram()).cooldownHours
    const block = checkStamp(card, cooldown, nowMs, opts.force)
    if (!block.ok) {
      throw new LoyaltyError(
        block.reason === 'attesa'
          ? `Timbro già dato di recente (${when(card.lastStampAt!)}): il prossimo si può dare da ${when(block.retryAt!)}.`
          : BLOCK_MESSAGE[block.reason],
        409,
      )
    }
    const ins = await client.query('INSERT INTO loyalty_stamps (card_id, created_by, note, created_at) VALUES ($1,$2,$3,to_timestamp($4::double precision / 1000.0)) RETURNING id', [
      id,
      user,
      encrypt(note, 'lc_note'),
      nowMs,
    ])
    const completed = card.stamps + 1 >= card.stampsRequired
    if (completed) await client.query('UPDATE loyalty_cards SET completed_at = now() WHERE id = $1', [id])
    await client.query('COMMIT')
    const fresh = toCard(await cardRow(id))
    const stamp = (await history(id)).find((s) => s.id === ins.rows[0].id)!
    return { card: fresh, stamp, completed }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Annulla un timbro (resta nello storico con chi e quando); se la carta era completa torna attiva. */
export async function voidStamp(cardId: number, stampId: number, user: string | null): Promise<LoyaltyCardDetail> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM loyalty_cards WHERE id = $1 FOR UPDATE', [cardId])
    const r = await client.query('UPDATE loyalty_stamps SET voided_at = now(), voided_by = $3 WHERE id = $2 AND card_id = $1 AND voided_at IS NULL', [cardId, stampId, user])
    if (!r.rowCount) throw new LoyaltyError('Timbro non trovato o già annullato', 404)
    await client.query(
      `UPDATE loyalty_cards c SET completed_at = NULL
       WHERE c.id = $1 AND c.completed_at IS NOT NULL
         AND (SELECT count(*) FROM loyalty_stamps s WHERE s.card_id = c.id AND s.voided_at IS NULL) < c.stamps_required`,
      [cardId],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return getDetail(cardId)
}

// ---------- Ricerca per token o codice breve ----------

async function idByToken(token: string): Promise<number | null> {
  if (!TOKEN_RE.test(token)) return null
  const { rows } = await pool.query('SELECT id FROM loyalty_cards WHERE token_hash = $1', [tokenHash(token)])
  return rows[0]?.id ?? null
}

async function idByShort(code: string): Promise<number | null> {
  const { rows } = await pool.query('SELECT id FROM loyalty_cards WHERE short_code = $1', [code])
  return rows[0]?.id ?? null
}

/** Scanner: dal QR code (indirizzo o token) o dal codice breve scritto a mano. */
export async function scanStamp(input: string, user: string | null): Promise<StampResult> {
  const read = readCardCode(String(input ?? '').slice(0, 300), cardBaseUrl())
  if (!read) throw new LoyaltyError('Codice non riconosciuto: inquadra il QR della carta o scrivi il codice breve (es. K7QM-X2PD).', 404)
  const id = 'token' in read ? await idByToken(read.token) : await idByShort(read.short)
  if (id === null) throw new LoyaltyError('Carta non trovata.', 404)
  return addStamp(id, user)
}

// ---------- Pagina pubblica ----------

export interface StudioInfo {
  name: string
  phone: string
  address: string
  logoType: string
  logoVersion: number
  flyerStyle: 'smile' | 'mint'
}

/** Dati pubblici di una carta, solo se il token esiste e la carta non è disattivata (stessa risposta altrimenti). */
export async function publicCard(token: string, studio: StudioInfo): Promise<PublicLoyaltyCard | null> {
  const id = await idByToken(token)
  if (id === null) return null
  const r = await cardRow(id)
  if (r.disabled_at) return null
  const c = toCard(r)
  return {
    studio,
    firstName: firstName(c.holderName),
    shortCode: formatShortCode(c.shortCode),
    stamps: c.stamps,
    stampsRequired: c.stampsRequired,
    reward: c.reward,
    status: c.status,
    lastStampAt: c.lastStampAt,
    expiresOn: c.expiresOn,
    completedAt: c.completedAt,
  }
}

/** Contatore dei token sbagliati per indirizzo IP: frena chi prova token a raffica (oltre al limite di Nginx). */
class MissLimiter {
  private map = new Map<string, { n: number; since: number }>()
  private max: number
  private windowMs: number
  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }
  blocked(ip: string, now = Date.now()): boolean {
    const e = this.map.get(ip)
    return !!e && now - e.since < this.windowMs && e.n >= this.max
  }
  miss(ip: string, now = Date.now()) {
    const e = this.map.get(ip)
    if (e && now - e.since < this.windowMs) e.n++
    else {
      if (this.map.size > 5000) for (const [k, v] of this.map) if (now - v.since >= this.windowMs) this.map.delete(k)
      this.map.set(ip, { n: 1, since: now })
    }
  }
}

// ---------- Rotte ----------

export interface LoyaltyDeps {
  currentUser: (req: FastifyRequest) => Promise<string | null>
  studio: () => Promise<StudioInfo>
  clientIp: (req: FastifyRequest) => string
}

const NOT_FOUND = 'Carta non trovata.'

export function registerLoyalty(app: FastifyInstance, d: LoyaltyDeps) {
  const idParam = (req: FastifyRequest, name = 'id') => {
    const n = Number((req.params as Record<string, string>)[name])
    if (!Number.isInteger(n) || n <= 0) throw new LoyaltyError('Richiesta non valida')
    return n
  }
  const user = (req: FastifyRequest) => d.currentUser(req)

  // --- Staff (richiedono l'accesso: lo controlla l'hook globale del server) ---
  app.get('/api/loyalty/program', async () => getProgram())
  app.put('/api/loyalty/program', async (req) => updateProgram(req.body))
  app.get('/api/loyalty/info', async () => ({ baseUrl: cardBaseUrl() }))

  app.get('/api/loyalty/cards', async (req) => {
    const q = req.query as { q?: string; status?: string }
    return listCards(String(q.q ?? '').slice(0, 80), String(q.status ?? ''))
  })
  app.post('/api/loyalty/cards', async (req) => createCard(req.body, await user(req)))
  app.get('/api/loyalty/cards/:id', async (req) => getDetail(idParam(req)))
  app.put('/api/loyalty/cards/:id', async (req) => updateCard(idParam(req), req.body))
  app.post('/api/loyalty/cards/:id/stamps', async (req) => {
    const b = (req.body ?? {}) as { force?: unknown; note?: unknown }
    return addStamp(idParam(req), await user(req), { force: b.force === true, note: String(b.note ?? '') })
  })
  app.post('/api/loyalty/cards/:id/stamps/:sid/void', async (req) => voidStamp(idParam(req), idParam(req, 'sid'), await user(req)))
  app.post('/api/loyalty/cards/:id/disable', async (req) => setDisabled(idParam(req), true, await user(req)))
  app.post('/api/loyalty/cards/:id/enable', async (req) => setDisabled(idParam(req), false, await user(req)))
  app.post('/api/loyalty/cards/:id/regenerate', async (req) => regenerateLink(idParam(req)))
  app.post('/api/loyalty/scan', async (req) => scanStamp(String((req.body as { code?: string } | null)?.code ?? ''), await user(req)))

  // --- Pubbliche (dominio dedicato: senza accesso) ---
  const misses = new MissLimiter(30, 15 * 60_000)
  const publicHeaders = (reply: FastifyReply) =>
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer')

  const lookup = async (req: FastifyRequest, reply: FastifyReply) => {
    publicHeaders(reply)
    const ip = d.clientIp(req)
    if (misses.blocked(ip)) {
      reply.header('retry-after', '900')
      throw new LoyaltyError('Troppe richieste: riprova più tardi.', 429)
    }
    const card = await publicCard((req.params as { token: string }).token, await d.studio())
    if (!card) {
      misses.miss(ip)
      // Stessa risposta per token inesistente, malformato o carta disattivata.
      throw new LoyaltyError(NOT_FOUND, 404)
    }
    return card
  }

  app.get('/api/public/cards/:token', async (req, reply) => lookup(req, reply))

  // Manifest per «Aggiungi alla schermata Home»: apre direttamente la carta di questo cliente.
  app.get('/api/public/cards/:token/manifest.webmanifest', async (req, reply) => {
    const card = await lookup(req, reply)
    const token = (req.params as { token: string }).token
    return reply.header('content-type', 'application/manifest+json; charset=utf-8').send({
      name: `${card.studio.name} · Carta fedeltà`,
      short_name: 'Fidelity',
      description: `Carta a timbri di ${card.studio.name}`,
      start_url: `${CARD_PATH}${token}`,
      scope: CARD_PATH,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#fff5fa',
      theme_color: '#e6007e',
      icons: [
        { src: '/loyalty/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/loyalty/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/loyalty/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
  })
}
