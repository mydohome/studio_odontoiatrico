// Verifica in due passaggi con app (Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Aegis…):
// TOTP secondo RFC 6238 (HMAC-SHA1, 6 cifre, 30 secondi), più i codici di recupero monouso.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const PERIOD_S = 30
const DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('Segreto non valido')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Nuovo segreto: 160 bit casuali in base32 (32 caratteri), come richiedono le app. */
export const newSecret = () => base32Encode(randomBytes(20))

/** Codice a 6 cifre per un intervallo di 30 secondi (RFC 4226/6238). */
export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0')
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / PERIOD_S)

/**
 * Controlla un codice: accetta quello dell'intervallo attuale, del precedente e del successivo (orologi
 * del telefono leggermente sfasati). Restituisce l'intervallo del codice, o null se è sbagliato.
 * `after` è l'ultimo intervallo già usato: lo stesso codice non vale due volte.
 */
export function verifyTotp(secret: string, input: string, nowMs: number, after = -1): number | null {
  const code = input.replace(/\s/g, '')
  if (!/^\d{6}$/.test(code)) return null
  const now = stepAt(nowMs)
  let hit: number | null = null
  for (const step of [now - 1, now, now + 1]) {
    // Confronto a tempo costante su tutte le finestre.
    const a = Buffer.from(totpCode(secret, step))
    const b = Buffer.from(code)
    if (timingSafeEqual(a, b) && step > after) hit = step
  }
  return hit
}

/** Indirizzo da trasformare in QR code: le app lo leggono e creano l'account. */
export function otpauthUrl(account: string, issuer: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`
}

// ---------- Codici di recupero ----------

// Senza caratteri ambigui; 12 caratteri = 60 bit.
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const RECOVERY_COUNT = 10

export function newRecoveryCode(): string {
  const bytes = randomBytes(12)
  let s = ''
  for (let i = 0; i < 12; i++) s += RECOVERY_ALPHABET[bytes[i] % 32]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

export const normalizeRecovery = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Si conserva solo l'impronta del codice: se il database trapela, i codici non si leggono. */
export const hashRecovery = (raw: string) => createHash('sha256').update('recovery:' + normalizeRecovery(raw)).digest('hex')
