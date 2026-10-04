// Modulo Gift card: gift card a credito o a prestazioni (anche da pacchetti predefiniti), con un codice
// univoco (codice a barre sulla card) e lo storico dei movimenti. Il credito residuo e le prestazioni
// rimaste si calcolano dai movimenti: ogni utilizzo resta registrato e si può stornare.
//
// Modulo isolato: tabelle proprie (gift_*), rotte /api/giftcards e /api/gift-packages registrate da
// registerGiftCards. Per eliminarlo del tutto vedi la sezione "Gift card" del README.

import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  codeFromRandom,
  formatEuro,
  isValidCode,
  normalizeCode,
  parseEuro,
  type GiftCard,
  type GiftCardInput,
  type GiftCardItem,
  type GiftCardKind,
  type GiftCardMovement,
  type GiftCardStatus,
  type GiftPackage,
  type GiftPackageItem,
} from '../../shared/giftCards.ts'
import { formatDay, isValidISO, today } from '../../shared/dates.ts'
import { decrypt, encrypt } from './dataCrypto.ts'
import { pool } from './db.ts'

class GiftCardError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const MAX_AMOUNT = 100000
const MAX_ITEMS = 20

export async function migrateGiftCards(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_packages (
      id         serial PRIMARY KEY,
      name       text NOT NULL,
      kind       text NOT NULL CHECK (kind IN ('credito', 'prestazioni')),
      amount     numeric(10,2),
      items      jsonb NOT NULL DEFAULT '[]',
      price      numeric(10,2),
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS gift_cards (
      id           serial PRIMARY KEY,
      code         text NOT NULL UNIQUE,
      kind         text NOT NULL CHECK (kind IN ('credito', 'prestazioni')),
      title        text NOT NULL,
      amount       numeric(10,2),
      recipient    text NOT NULL DEFAULT '',
      buyer        text NOT NULL DEFAULT '',
      notes        text NOT NULL DEFAULT '',
      price_paid   numeric(10,2),
      package_id   integer REFERENCES gift_packages(id) ON DELETE SET NULL,
      expires_on   date,
      created_by   text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      cancelled_at timestamptz,
      cancelled_by text
    );
    CREATE TABLE IF NOT EXISTS gift_card_items (
      card_id    integer NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
      idx        integer NOT NULL,
      service_id text,
      name       text NOT NULL,
      qty        integer NOT NULL CHECK (qty > 0),
      PRIMARY KEY (card_id, idx)
    );
    CREATE TABLE IF NOT EXISTS gift_card_movements (
      id          serial PRIMARY KEY,
      card_id     integer NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
      at          timestamptz NOT NULL DEFAULT now(),
      by_user     text,
      amount      numeric(10,2) CHECK (amount > 0),
      item_idx    integer,
      qty         integer CHECK (qty > 0),
      note        text NOT NULL DEFAULT '',
      reversed_at timestamptz,
      reversed_by text
    );
    CREATE INDEX IF NOT EXISTS gift_card_movements_card ON gift_card_movements (card_id);
  `)
}

// ---------- Lettura ----------

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const round2 = (n: number) => Math.round(n * 100) / 100

interface CardRow {
  id: number
  code: string
  kind: GiftCardKind
  title: string
  amount: string | null
  recipient: string
  buyer: string
  notes: string
  price_paid: string | null
  package_id: number | null
  expires_on: string | null
  created_by: string | null
  created_at: string
  cancelled_at: string | null
}

function statusOf(c: { cancelledAt: string | null; expiresOn: string | null; balance: number | null; items: GiftCardItem[]; kind: GiftCardKind }): GiftCardStatus {
  if (c.cancelledAt) return 'annullata'
  const empty = c.kind === 'credito' ? (c.balance ?? 0) <= 0 : c.items.every((i) => i.left <= 0)
  if (empty) return 'esaurita'
  if (c.expiresOn && c.expiresOn < today()) return 'scaduta'
  return 'attiva'
}

async function loadCards(where: string, params: unknown[]): Promise<GiftCard[]> {
  const { rows } = await pool.query<CardRow>(`SELECT * FROM gift_cards ${where} ORDER BY created_at DESC, id DESC`, params)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [items, moves] = await Promise.all([
    pool.query('SELECT card_id, idx, service_id, name, qty FROM gift_card_items WHERE card_id = ANY($1) ORDER BY card_id, idx', [ids]),
    pool.query('SELECT * FROM gift_card_movements WHERE card_id = ANY($1) ORDER BY at, id', [ids]),
  ])
  return rows.map((r) => {
    const movements: GiftCardMovement[] = moves.rows
      .filter((m) => m.card_id === r.id)
      .map((m) => ({
        id: m.id,
        at: m.at,
        user: m.by_user,
        amount: num(m.amount),
        itemIdx: m.item_idx,
        qty: m.qty,
        note: decrypt(m.note, 'gc_note'),
        reversedAt: m.reversed_at,
        reversedBy: m.reversed_by,
      }))
    const valid = movements.filter((m) => !m.reversedAt)
    const cardItems: GiftCardItem[] = items.rows
      .filter((i) => i.card_id === r.id)
      .map((i) => ({
        idx: i.idx,
        serviceId: i.service_id,
        name: i.name,
        qty: i.qty,
        left: i.qty - valid.filter((m) => m.itemIdx === i.idx).reduce((n, m) => n + (m.qty ?? 0), 0),
      }))
    const amount = num(r.amount)
    const balance = r.kind === 'credito' && amount !== null ? round2(amount - valid.reduce((n, m) => n + (m.amount ?? 0), 0)) : null
    const card = {
      id: r.id,
      code: r.code,
      kind: r.kind,
      title: r.title,
      amount,
      balance,
      items: cardItems,
      recipient: decrypt(r.recipient, 'gc_recipient'),
      buyer: decrypt(r.buyer, 'gc_buyer'),
      notes: decrypt(r.notes, 'gc_notes'),
      pricePaid: num(r.price_paid),
      packageId: r.package_id,
      expiresOn: r.expires_on,
      createdBy: r.created_by,
      createdAt: r.created_at,
      cancelledAt: r.cancelled_at,
      movements,
    }
    return { ...card, status: statusOf(card) }
  })
}

async function getCard(id: number): Promise<GiftCard> {
  const [c] = await loadCards('WHERE id = $1', [id])
  if (!c) throw new GiftCardError('Gift card non trovata', 404)
  return c
}

// ---------- Validazione ----------

const text = (v: unknown, field: string, max: number, required = false) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (required && !s) throw new GiftCardError(`${field} obbligatorio`)
  if (s.length > max) throw new GiftCardError(`${field} troppo lungo (massimo ${max} caratteri)`)
  return s
}

function euro(v: unknown, field: string, required: boolean): number | null {
  const n = parseEuro(v as string | number | null | undefined)
  if (n === null) {
    if (required) throw new GiftCardError(`${field} non valido`)
    if (v !== null && v !== undefined && v !== '') throw new GiftCardError(`${field} non valido`)
    return null
  }
  if (n <= 0 || n > MAX_AMOUNT) throw new GiftCardError(`${field} non valido`)
  return n
}

/** Prestazioni: quelle del catalogo prendono il nome dal catalogo; si possono anche scrivere a mano. */
async function parseItems(v: unknown): Promise<GiftPackageItem[]> {
  if (!Array.isArray(v) || !v.length) throw new GiftCardError('Indica almeno una prestazione')
  if (v.length > MAX_ITEMS) throw new GiftCardError(`Al massimo ${MAX_ITEMS} prestazioni`)
  const { rows } = await pool.query('SELECT id, name FROM services')
  const names = new Map<string, string>(rows.map((r) => [r.id, r.name]))
  return v.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>
    const serviceId = it.serviceId ? String(it.serviceId) : null
    if (serviceId && !names.has(serviceId)) throw new GiftCardError('Prestazione sconosciuta')
    const name = serviceId ? names.get(serviceId)! : text(it.name, 'Nome della prestazione', 80, true)
    const qty = Number(it.qty ?? 1)
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new GiftCardError('Quantità non valida (da 1 a 99)')
    return { serviceId, name, qty }
  })
}

function parseKind(v: unknown): GiftCardKind {
  if (v !== 'credito' && v !== 'prestazioni') throw new GiftCardError('Tipo non valido')
  return v
}

async function parseCardInput(body: unknown): Promise<GiftCardInput> {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = parseKind(b.kind)
  const expiresOn = b.expiresOn ? String(b.expiresOn) : null
  if (expiresOn && (!isValidISO(expiresOn) || expiresOn < today())) throw new GiftCardError('Scadenza non valida')
  return {
    kind,
    title: text(b.title, 'Titolo', 60) || 'Gift card',
    amount: kind === 'credito' ? euro(b.amount, 'Importo', true) : null,
    items: kind === 'prestazioni' ? await parseItems(b.items) : [],
    recipient: text(b.recipient, 'Intestatario', 80),
    buyer: text(b.buyer, 'Acquistata da', 80),
    notes: String(b.notes ?? '').trim().slice(0, 1000),
    pricePaid: euro(b.pricePaid, 'Prezzo pagato', false),
    packageId: b.packageId ? Number(b.packageId) : null,
    expiresOn,
  }
}

// ---------- Scrittura ----------

async function createCard(input: GiftCardInput, user: string | null): Promise<GiftCard> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let id = 0
    // Codice casuale da 50 bit: una collisione è praticamente impossibile, ma si riprova comunque.
    for (let attempt = 0; !id; attempt++) {
      if (attempt >= 5) throw new GiftCardError('Impossibile generare un codice univoco, riprova', 500)
      const code = codeFromRandom(randomBytes(10))
      const r = await client.query(
        `INSERT INTO gift_cards (code, kind, title, amount, recipient, buyer, notes, price_paid, package_id, expires_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [
          code,
          input.kind,
          input.title,
          input.amount,
          encrypt(input.recipient, 'gc_recipient'),
          encrypt(input.buyer, 'gc_buyer'),
          encrypt(input.notes, 'gc_notes'),
          input.pricePaid,
          input.packageId,
          input.expiresOn,
          user,
        ],
      )
      id = r.rows[0]?.id ?? 0
    }
    for (const [idx, it] of input.items.entries()) {
      await client.query('INSERT INTO gift_card_items (card_id, idx, service_id, name, qty) VALUES ($1,$2,$3,$4,$5)', [id, idx, it.serviceId, it.name, it.qty])
    }
    await client.query('COMMIT')
    return getCard(id)
  } catch (e) {
    await client.query('ROLLBACK')
    if ((e as { code?: string }).code === '23503') throw new GiftCardError('Pacchetto non trovato')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Utilizzo: scala credito (anche parziale) o segna prestazioni usate. In una transazione con la gift
 * card bloccata, così due operatori insieme non possono usare due volte lo stesso credito.
 */
async function redeem(id: number, body: unknown, user: string | null): Promise<GiftCard> {
  const b = (body ?? {}) as Record<string, unknown>
  const note = String(b.note ?? '').trim().slice(0, 300)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT id FROM gift_cards WHERE id = $1 FOR UPDATE', [id])
    if (!locked.rowCount) throw new GiftCardError('Gift card non trovata', 404)
    const card = await getCard(id)
    if (card.status === 'annullata') throw new GiftCardError('La gift card è stata annullata')
    if (card.status === 'scaduta') throw new GiftCardError(`La gift card è scaduta il ${formatDay(card.expiresOn!)}: per usarla prolunga prima la scadenza`)
    if (card.status === 'esaurita') throw new GiftCardError('La gift card è già stata usata completamente')
    if (card.kind === 'credito') {
      const amount = euro(b.amount, 'Importo da scalare', true)!
      if (amount > (card.balance ?? 0) + 1e-9) throw new GiftCardError(`Credito insufficiente: restano ${formatEuro(card.balance ?? 0)}`)
      await client.query('INSERT INTO gift_card_movements (card_id, by_user, amount, note) VALUES ($1,$2,$3,$4)', [id, user, amount, encrypt(note, 'gc_note')])
    } else {
      const idx = Number(b.itemIdx)
      const item = card.items.find((i) => i.idx === idx)
      if (!item) throw new GiftCardError('Prestazione non valida')
      const qty = Number(b.qty ?? 1)
      if (!Number.isInteger(qty) || qty < 1) throw new GiftCardError('Quantità non valida')
      if (qty > item.left) throw new GiftCardError(`${item.name}: ne restano ${item.left}`)
      await client.query('INSERT INTO gift_card_movements (card_id, by_user, item_idx, qty, note) VALUES ($1,$2,$3,$4,$5)', [id, user, idx, qty, encrypt(note, 'gc_note')])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return getCard(id)
}

/** Storno di un utilizzo registrato per errore: il credito o la prestazione tornano disponibili. */
async function reverseMovement(id: number, movementId: number, user: string | null): Promise<GiftCard> {
  const r = await pool.query(
    'UPDATE gift_card_movements SET reversed_at = now(), reversed_by = $3 WHERE id = $2 AND card_id = $1 AND reversed_at IS NULL',
    [id, movementId, user],
  )
  if (!r.rowCount) throw new GiftCardError('Movimento non trovato o già stornato', 404)
  return getCard(id)
}

async function updateCard(id: number, body: unknown): Promise<GiftCard> {
  const b = (body ?? {}) as Record<string, unknown>
  const card = await getCard(id)
  const expiresOn = b.expiresOn === undefined ? card.expiresOn : b.expiresOn ? String(b.expiresOn) : null
  if (expiresOn && !isValidISO(expiresOn)) throw new GiftCardError('Scadenza non valida')
  await pool.query('UPDATE gift_cards SET recipient = $2, buyer = $3, notes = $4, expires_on = $5 WHERE id = $1', [
    id,
    encrypt(b.recipient === undefined ? card.recipient : text(b.recipient, 'Intestatario', 80), 'gc_recipient'),
    encrypt(b.buyer === undefined ? card.buyer : text(b.buyer, 'Acquistata da', 80), 'gc_buyer'),
    encrypt(b.notes === undefined ? card.notes : String(b.notes).trim().slice(0, 1000), 'gc_notes'),
    expiresOn,
  ])
  return getCard(id)
}

async function setCancelled(id: number, cancelled: boolean, user: string | null): Promise<GiftCard> {
  const r = await pool.query(
    cancelled
      ? 'UPDATE gift_cards SET cancelled_at = coalesce(cancelled_at, now()), cancelled_by = coalesce(cancelled_by, $2) WHERE id = $1'
      : 'UPDATE gift_cards SET cancelled_at = NULL, cancelled_by = NULL WHERE id = $1',
    cancelled ? [id, user] : [id],
  )
  if (!r.rowCount) throw new GiftCardError('Gift card non trovata', 404)
  return getCard(id)
}

// ---------- Pacchetti ----------

async function listPackages(): Promise<GiftPackage[]> {
  const { rows } = await pool.query('SELECT id, name, kind, amount, items, price, active FROM gift_packages ORDER BY active DESC, name')
  return rows.map((r) => ({ ...r, amount: num(r.amount), price: num(r.price) }))
}

async function parsePackage(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = parseKind(b.kind)
  return {
    name: text(b.name, 'Nome del pacchetto', 60, true),
    kind,
    amount: kind === 'credito' ? euro(b.amount, 'Importo', true) : null,
    items: kind === 'prestazioni' ? await parseItems(b.items) : [],
    price: euro(b.price, 'Prezzo', false),
    active: b.active !== false,
  }
}

// ---------- Rotte ----------

const idParam = (req: FastifyRequest, name = 'id') => {
  const n = Number((req.params as Record<string, string>)[name])
  if (!Number.isInteger(n) || n <= 0) throw new GiftCardError('Identificativo non valido')
  return n
}

/** Registra le API del modulo (tutte riservate agli utenti dello studio). */
export function registerGiftCards(app: FastifyInstance, currentUser: (req: FastifyRequest) => Promise<string | null>) {
  app.get('/api/giftcards', async () => loadCards('', []))

  // Ricerca dal codice scritto o letto con lo scanner (con o senza trattini).
  app.get('/api/giftcards/lookup/:code', async (req) => {
    const code = normalizeCode((req.params as { code: string }).code)
    if (!isValidCode(code)) throw new GiftCardError('Codice non valido: controlla di averlo scritto correttamente')
    const [card] = await loadCards('WHERE code = $1', [code])
    if (!card) throw new GiftCardError('Nessuna gift card con questo codice', 404)
    return card
  })

  app.post('/api/giftcards', async (req) => createCard(await parseCardInput(req.body), await currentUser(req)))
  app.put('/api/giftcards/:id', async (req) => updateCard(idParam(req), req.body))
  app.post('/api/giftcards/:id/redeem', async (req) => redeem(idParam(req), req.body, await currentUser(req)))
  app.post('/api/giftcards/:id/movements/:mid/reverse', async (req) => reverseMovement(idParam(req), idParam(req, 'mid'), await currentUser(req)))
  app.post('/api/giftcards/:id/cancel', async (req) => {
    const cancelled = (req.body as { cancelled?: unknown } | null)?.cancelled
    if (typeof cancelled !== 'boolean') throw new GiftCardError('Valore non valido')
    return setCancelled(idParam(req), cancelled, await currentUser(req))
  })

  app.get('/api/gift-packages', async () => listPackages())
  app.post('/api/gift-packages', async (req) => {
    const p = await parsePackage(req.body)
    const { rows } = await pool.query(
      'INSERT INTO gift_packages (name, kind, amount, items, price, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [p.name, p.kind, p.amount, JSON.stringify(p.items), p.price, p.active],
    )
    return (await listPackages()).find((x) => x.id === rows[0].id)
  })
  app.put('/api/gift-packages/:id', async (req) => {
    const id = idParam(req)
    const p = await parsePackage(req.body)
    const r = await pool.query('UPDATE gift_packages SET name=$2, kind=$3, amount=$4, items=$5, price=$6, active=$7 WHERE id=$1', [
      id, p.name, p.kind, p.amount, JSON.stringify(p.items), p.price, p.active,
    ])
    if (!r.rowCount) throw new GiftCardError('Pacchetto non trovato', 404)
    return (await listPackages()).find((x) => x.id === id)
  })
  // Le gift card già create restano: perdono solo il riferimento al pacchetto.
  app.delete('/api/gift-packages/:id', async (req) => {
    const r = await pool.query('DELETE FROM gift_packages WHERE id = $1', [idParam(req)])
    if (!r.rowCount) throw new GiftCardError('Pacchetto non trovato', 404)
    return { ok: true }
  })
}
