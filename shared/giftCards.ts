// Modulo Gift card: tipi e funzioni condivise tra backend e frontend.
// Tutto il modulo sta in questo file, in backend/src/giftCards.ts e in frontend/src/giftcards/:
// per eliminarlo vedi la sezione "Gift card" del README.

/** Credito in euro oppure un elenco di prestazioni (es. 1 controllo + 1 igiene). */
export type GiftCardKind = 'credito' | 'prestazioni'

export type GiftCardStatus = 'attiva' | 'esaurita' | 'scaduta' | 'annullata'

export interface GiftCardItem {
  /** Posizione nella gift card (riferimento dei movimenti). */
  idx: number
  serviceId: string | null
  name: string
  qty: number
  /** Ancora da usare. */
  left: number
}

export interface GiftCardMovement {
  id: number
  at: string
  user: string | null
  /** Credito scalato (gift card a credito). */
  amount: number | null
  /** Prestazione usata (gift card a prestazioni). */
  itemIdx: number | null
  qty: number | null
  note: string
  reversedAt: string | null
  reversedBy: string | null
}

export interface GiftCard {
  id: number
  code: string
  kind: GiftCardKind
  /** Nome mostrato sulla card: il pacchetto o "Gift card". */
  title: string
  /** Credito iniziale (solo a credito). */
  amount: number | null
  /** Credito residuo (solo a credito). */
  balance: number | null
  items: GiftCardItem[]
  recipient: string
  buyer: string
  notes: string
  /** Prezzo pagato (facoltativo; per le card a credito di solito coincide con l'importo). */
  pricePaid: number | null
  packageId: number | null
  expiresOn: string | null
  status: GiftCardStatus
  createdBy: string | null
  createdAt: string
  cancelledAt: string | null
  movements: GiftCardMovement[]
}

export interface GiftPackageItem {
  serviceId: string | null
  name: string
  qty: number
}

/** Pacchetto predefinito da cui generare gift card. */
export interface GiftPackage {
  id: number
  name: string
  kind: GiftCardKind
  amount: number | null
  items: GiftPackageItem[]
  price: number | null
  active: boolean
}

export interface GiftCardInput {
  kind: GiftCardKind
  title: string
  amount: number | null
  items: GiftPackageItem[]
  recipient: string
  buyer: string
  notes: string
  pricePaid: number | null
  packageId: number | null
  expiresOn: string | null
}

// ---------- Codice ----------

/** Caratteri senza ambiguità (niente 0/O, 1/I): si leggono e si dettano senza errori. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PREFIX = 'GC'
const BODY = 10

/**
 * Carattere di controllo (algoritmo di Luhn mod N, come per le carte di credito): individua ogni
 * carattere sbagliato e quasi tutti gli scambi tra due caratteri vicini.
 */
export function checkChar(body: string): string {
  const n = CODE_ALPHABET.length
  let factor = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    const addend = factor * CODE_ALPHABET.indexOf(body[i])
    sum += Math.floor(addend / n) + (addend % n)
    factor = factor === 2 ? 1 : 2
  }
  return CODE_ALPHABET[(n - (sum % n)) % n]
}

/** Codice completo da caratteri casuali: GC + 10 caratteri + controllo (es. GC7KQ2MXP4RTH). */
export function codeFromRandom(bytes: Uint8Array): string {
  let body = ''
  for (let i = 0; i < BODY; i++) body += CODE_ALPHABET[bytes[i] % 32]
  return PREFIX + body + checkChar(body)
}

/** Ripulisce quanto scritto o letto dallo scanner: maiuscole, senza spazi né trattini. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '')
}

export function isValidCode(code: string): boolean {
  const re = new RegExp(`^${PREFIX}[${CODE_ALPHABET}]{${BODY + 1}}$`)
  if (!re.test(code)) return false
  const body = code.slice(PREFIX.length, PREFIX.length + BODY)
  return checkChar(body) === code.slice(-1)
}

/** Caratteri minimi per cercare una gift card dalla parte finale del codice. */
export const MIN_CODE_END = 3

/**
 * Gift card il cui codice finisce con quanto scritto (es. "RTH" o "MXP4-RTH"): basta leggere gli
 * ultimi caratteri stampati sulla card. Null se il testo è troppo corto o non può essere un codice.
 */
export function matchCodeEnd<T extends { code: string }>(cards: T[], raw: string): T[] | null {
  const end = normalizeCode(raw)
  if (end.length < MIN_CODE_END || !new RegExp(`^[${CODE_ALPHABET}]+$`).test(end)) return null
  return cards.filter((c) => c.code.endsWith(end))
}

/** GC7KQ2MXP4RTH → GC-7KQ2-MXP4-RTH, più facile da leggere e dettare. */
export function formatCode(code: string): string {
  return `${code.slice(0, 2)}-${code.slice(2, 6)}-${code.slice(6, 10)}-${code.slice(10)}`
}

// ---------- Importi ----------

/** "12,50" / "12.50" / "12" → 12.5 (null se vuoto o non valido). */
export function parseEuro(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null
  const s = raw.trim().replace(/€/g, '').replace(/\s/g, '')
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s.replace(',', '.')) * 100) / 100
}

export const formatEuro = (n: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: n % 1 ? 2 : 0 }).format(n)

/** Descrizione del contenuto: "100 €" oppure "1 × Visita di controllo, 2 × Igiene orale". */
export function describeContent(c: { kind: GiftCardKind; amount: number | null; items: { name: string; qty: number }[] }): string {
  if (c.kind === 'credito') return c.amount !== null ? formatEuro(c.amount) : ''
  return c.items.map((i) => `${i.qty} × ${i.name}`).join(', ')
}

export const STATUS_LABEL: Record<GiftCardStatus, string> = {
  attiva: 'Attiva',
  esaurita: 'Esaurita',
  scaduta: 'Scaduta',
  annullata: 'Annullata',
}
