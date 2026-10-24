// Modulo Fidelity card (carta a timbri): tipi e logica condivisa tra backend e frontend.
// Tutto il modulo sta in questo file, in backend/src/loyalty.ts e in frontend/src/loyalty/:
// per eliminarlo vedi la sezione "Fidelity card" del README.

import { CODE_ALPHABET, checkChar } from './codes.ts'

export type LoyaltyStatus = 'attiva' | 'completata' | 'scaduta' | 'disattivata'

export const LOYALTY_STATUS_LABEL: Record<LoyaltyStatus, string> = {
  attiva: 'Attiva',
  completata: 'Completata',
  scaduta: 'Scaduta',
  disattivata: 'Disattivata',
}

export interface LoyaltyProgram {
  id: number
  name: string
  /** Timbri per ottenere il premio. */
  stampsRequired: number
  /** Descrizione del premio (es. «Igiene professionale gratuita»). */
  reward: string
  /** Giorni di validità di una carta dalla creazione (null = senza scadenza). */
  validDays: number | null
  /** Ore da attendere tra un timbro e il successivo sulla stessa carta. */
  cooldownHours: number
}

export interface LoyaltyStamp {
  id: number
  at: string
  by: string | null
  note: string
  voidedAt: string | null
  voidedBy: string | null
}

/** Carta come la vede lo staff. */
export interface LoyaltyCard {
  id: number
  holderName: string
  holderPhone: string
  /** Codice breve leggibile (es. K7QM-X2PD), per l'inserimento a mano. */
  shortCode: string
  programName: string
  stampsRequired: number
  reward: string
  /** Timbri validi (non annullati). */
  stamps: number
  lastStampAt: string | null
  status: LoyaltyStatus
  expiresOn: string | null
  createdAt: string
  createdBy: string | null
  completedAt: string | null
  disabledAt: string | null
  /** Quando è stato raccolto il consenso alle comunicazioni (per ora solo registrato, non blocca nulla). */
  consentAt: string | null
}

export interface LoyaltyCardDetail extends LoyaltyCard {
  history: LoyaltyStamp[]
  /** Indirizzo pubblico della carta (da inviare al cliente); null se manca il dominio delle carte. */
  url: string | null
}

/** Esito di un timbro (scanner o dettaglio). */
export interface StampResult {
  card: LoyaltyCard
  stamp: LoyaltyStamp
  /** Il timbro ha completato la carta. */
  completed: boolean
}

/** Dati della pagina pubblica: il minimo indispensabile (nessun dato sanitario né di appuntamenti). */
export interface PublicLoyaltyCard {
  studio: { name: string; phone: string; address: string; logoType: string; logoVersion: number; flyerStyle: 'smile' | 'mint' }
  /** Solo il nome di battesimo. */
  firstName: string
  shortCode: string
  stamps: number
  stampsRequired: number
  reward: string
  status: LoyaltyStatus
  lastStampAt: string | null
  expiresOn: string | null
  completedAt: string | null
}

// ---------- Token e codice breve ----------

/** Token del link: 24 byte casuali in base64url = 32 caratteri (192 bit). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

export const CARD_PATH = '/f/'

const SHORT_BODY = 7

/** Codice breve: 7 caratteri casuali + carattere di controllo (es. K7QMX2PD). */
export function shortCodeFromRandom(bytes: Uint8Array): string {
  let body = ''
  for (let i = 0; i < SHORT_BODY; i++) body += CODE_ALPHABET[bytes[i] % 32]
  return body + checkChar(body)
}

/** Ripulisce quanto scritto: maiuscole, senza spazi né trattini. */
export const normalizeShortCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, '')

export function isValidShortCode(code: string): boolean {
  if (code.length !== SHORT_BODY + 1 || ![...code].every((c) => CODE_ALPHABET.includes(c))) return false
  return checkChar(code.slice(0, SHORT_BODY)) === code[SHORT_BODY]
}

/** K7QMX2PD → K7QM-X2PD. */
export const formatShortCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

/**
 * Da quanto letto dal QR code o scritto a mano: un indirizzo della carta (di qualsiasi dominio, oppure
 * solo di quello indicato), il token da solo, oppure il codice breve.
 */
export function readCardCode(text: string, baseUrl?: string | null): { token: string } | { short: string } | null {
  const t = text.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) {
    let url: URL
    try {
      url = new URL(t)
    } catch {
      return null
    }
    if (baseUrl) {
      try {
        if (new URL(baseUrl).host.toLowerCase() !== url.host.toLowerCase()) return null
      } catch {
        /* dominio delle carte non valido: nessun controllo sul dominio */
      }
    }
    const m = url.pathname.match(/^\/f\/([A-Za-z0-9_-]{32})\/?$/)
    return m ? { token: m[1] } : null
  }
  if (TOKEN_RE.test(t)) return { token: t }
  const short = normalizeShortCode(t)
  return isValidShortCode(short) ? { short } : null
}

// ---------- Regole ----------

export function cardStatus(c: { disabledAt: string | null; completedAt: string | null; expiresOn: string | null }, today: string): LoyaltyStatus {
  if (c.disabledAt) return 'disattivata'
  if (c.completedAt) return 'completata'
  if (c.expiresOn && c.expiresOn < today) return 'scaduta'
  return 'attiva'
}

export type StampBlock = { ok: true } | { ok: false; reason: 'disattivata' | 'scaduta' | 'completata' | 'attesa'; retryAt?: string }

/**
 * Si può aggiungere un timbro? Carta attiva, non completata e (salvo `force`, per le correzioni dello staff)
 * passate le ore di attesa dall'ultimo timbro valido.
 */
export function checkStamp(
  c: { status: LoyaltyStatus; lastStampAt: string | null },
  cooldownHours: number,
  nowMs: number,
  force = false,
): StampBlock {
  if (c.status === 'disattivata' || c.status === 'scaduta' || c.status === 'completata') return { ok: false, reason: c.status }
  if (!force && c.lastStampAt && cooldownHours > 0) {
    const next = Date.parse(c.lastStampAt) + cooldownHours * 3_600_000
    if (next > nowMs) return { ok: false, reason: 'attesa', retryAt: new Date(next).toISOString() }
  }
  return { ok: true }
}

/** Solo il nome di battesimo («Maria Grazia Rossi» → «Maria»). */
export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? ''

// ---------- Messaggio al cliente ----------

/**
 * Testo da inviare con il link della carta. Solo ciò che serve: nome di battesimo, premio e link
 * (nessun dato sanitario né di appuntamenti). Senza icone: arriva intatto anche da WhatsApp Web.
 */
export function loyaltyMessage(m: { studioName: string; holderName: string; stampsRequired: number; reward: string; url: string }): string {
  const name = firstName(m.holderName)
  return [
    `*${m.studioName}* - La tua carta fedeltà`,
    '',
    name ? `Gentile ${name},` : 'Gentile cliente,',
    `ecco la tua carta a timbri: a ogni visita in studio ricevi un timbro e con ${m.stampsRequired} timbri ottieni: ${m.reward}.`,
    '',
    '*Apri la tua carta* e mostrala in studio:',
    m.url,
    'Puoi aggiungerla alla schermata Home del telefono, così l\'hai sempre a portata di mano.',
    '',
    'A presto!',
  ].join('\n')
}
