import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  base32Decode,
  base32Encode,
  hashRecovery,
  newRecoveryCode,
  newSecret,
  normalizeRecovery,
  otpauthUrl,
  stepAt,
  totpCode,
  verifyTotp,
} from '../src/totp.ts'

// Segreto di prova di RFC 6238: "12345678901234567890" in ASCII, in base32.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

test('totp: valori di riferimento dell\'RFC 6238 (SHA-1, ultime 6 cifre)', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  // Tempo 59 s → 94287082, 1111111109 → 07081804, 1234567890 → 89005924, 2000000000 → 69279037
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']] as const) {
    assert.equal(totpCode(RFC_SECRET, stepAt(t * 1000)), code, `t=${t}`)
  }
})

test('base32: andata e ritorno, anche con spazi e minuscole', () => {
  for (let i = 0; i < 50; i++) {
    const s = newSecret()
    assert.match(s, /^[A-Z2-7]{32}$/)
    assert.equal(base32Encode(base32Decode(s)), s)
    assert.equal(base32Encode(base32Decode(s.toLowerCase().replace(/(.{4})/g, '$1 '))), s)
  }
  assert.throws(() => base32Decode('0189'), /non valido/)
})

test('totp: finestra di ±1 intervallo, codici sbagliati e riuso', () => {
  const now = 1_700_000_000_000
  const step = stepAt(now)
  const code = totpCode(RFC_SECRET, step)
  assert.equal(verifyTotp(RFC_SECRET, code, now), step)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now), step - 1)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now), step + 1)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now), null)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now), null)
  assert.equal(verifyTotp(RFC_SECRET, code.replace(/\d$/, (d) => String((Number(d) + 1) % 10)), now), null)
  assert.equal(verifyTotp(RFC_SECRET, '12345', now), null)
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', now), null)
  // Spazi tra le cifre (come le mostrano alcune app) vanno bene.
  assert.equal(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now), step)
  // Lo stesso codice non vale due volte: dopo aver usato l'intervallo, quello e i precedenti sono rifiutati.
  assert.equal(verifyTotp(RFC_SECRET, code, now, step), null)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step), null)
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step), step + 1)
})

test('otpauth: indirizzo per il QR code', () => {
  const u = otpauthUrl('mario', 'Studio Rossi', 'ABCDEFGH')
  assert.equal(u, 'otpauth://totp/Studio%20Rossi:mario?secret=ABCDEFGH&issuer=Studio%20Rossi&algorithm=SHA1&digits=6&period=30')
})

test('codici di recupero: formato, normalizzazione e impronta', () => {
  const c = newRecoveryCode()
  assert.match(c, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
  assert.equal(normalizeRecovery(c.toLowerCase()), c.replace(/-/g, ''))
  assert.equal(hashRecovery(c), hashRecovery(c.toLowerCase().replace(/-/g, ' ')))
  assert.notEqual(hashRecovery(c), hashRecovery(newRecoveryCode()))
  assert.match(hashRecovery(c), /^[0-9a-f]{64}$/)
})
