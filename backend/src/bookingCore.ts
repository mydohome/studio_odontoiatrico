// Parti del modulo Richieste web senza database né chiavi del gestionale: le usa sia il container
// «booking» (pagina pubblica) sia il gestionale (che ricontrolla ogni richiesta prima di importarla).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  LIMITS,
  PHONE_RE,
  SLOTS,
  TOKEN_MAX_TOTAL_MS,
  TOKEN_TTL_MS,
  type WebSlot,
} from '../../shared/webRequests.ts'

export class WebRequestError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export const MAX_PENDING = 200

// ---------- Codice firmato ----------
// v1.<nonce>.<apertura>.<emissione>.<firma>: apertura = quando il cliente ha aperto il modulo
// (non cambia nei rinnovi), emissione = quando è stato emesso questo codice.

const NONCE_RE = /^[A-Za-z0-9_-]{32}$/
const sig = (key: Buffer, payload: string) => createHmac('sha256', key).update(`booking|${payload}`).digest('base64url')

export function issueToken(key: Buffer, now: number, startedAt = now): { token: string; nonce: string } {
  const nonce = randomBytes(24).toString('base64url')
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

