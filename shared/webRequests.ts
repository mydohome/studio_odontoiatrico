// Richieste di appuntamento dal sito dello studio (modulo isolato: vedi la sezione "Richieste web"
// del README). Regole condivise tra la pagina pubblica e il server.

/** Percorso della pagina pubblica sul dominio dedicato. */
export const BOOKING_PATH = '/prenota'

export const SLOTS = ['mattina', 'pomeriggio', 'indifferente'] as const
export type WebSlot = (typeof SLOTS)[number]
export const SLOT_LABEL: Record<WebSlot, string> = { mattina: 'Mattina', pomeriggio: 'Pomeriggio', indifferente: 'Indifferente' }

export const LIMITS = { name: 40, surname: 40, phone: 20, message: 600 } as const

/** Versione del testo di consenso mostrato: si registra insieme alla richiesta. */
export const CONSENT_VERSION = 'v1'

/** Validità del codice: 10 minuti, rinnovabile mentre il cliente scrive (al massimo 30 in tutto). */
export const TOKEN_TTL_MS = 10 * 60_000
export const TOKEN_MAX_TOTAL_MS = 30 * 60_000
/** Tempo minimo per compilare il modulo: più veloce di così è un programma, non una persona. */
export const MIN_FILL_MS = 3000

export const PHONE_RE = /^\+?[0-9 ./()-]{6,20}$/

export interface BookingSession {
  token: string
  /** Scadenza del codice (ms dall'epoca) e momento in cui si è aperto il modulo. */
  expiresAt: number
  startedAt: number
  studio: { name: string; phone: string }
  privacyUrl: string
}

/** Richiesta come arriva dalla pagina pubblica. */
export interface BookingInput {
  token: string
  name: string
  surname: string
  phone: string
  message: string
  slot: WebSlot
  consent: boolean
  /** Campo trappola: le persone non lo vedono e lo lasciano vuoto. */
  website: string
}
