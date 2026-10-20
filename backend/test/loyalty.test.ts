import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cardStatus,
  checkStamp,
  firstName,
  formatShortCode,
  isValidShortCode,
  normalizeShortCode,
  readCardCode,
  shortCodeFromRandom,
  TOKEN_RE,
} from '../../shared/loyalty.ts'
import { randomBytes } from 'node:crypto'
import { cardBaseUrl, cardUrl, newToken, tokenHash } from '../src/loyalty.ts'

test('token: 192 bit casuali in base64url, tutti diversi, impronta di 64 caratteri', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 3000; i++) {
    const t = newToken()
    assert.equal(t.length, 32)
    assert.match(t, TOKEN_RE)
    assert.equal(Buffer.from(t, 'base64url').length, 24)
    assert.ok(!seen.has(t))
    seen.add(t)
  }
  const t = newToken()
  assert.match(tokenHash(t), /^[0-9a-f]{64}$/)
  assert.equal(tokenHash(t), tokenHash(t))
  assert.notEqual(tokenHash(t), tokenHash(newToken()))
})

test('codice breve: formato, controllo e lettura a mano', () => {
  for (let i = 0; i < 300; i++) {
    const c = shortCodeFromRandom(randomBytes(8))
    assert.match(c, /^[2-9A-HJ-NP-Z]{8}$/)
    assert.ok(isValidShortCode(c))
    assert.equal(normalizeShortCode(formatShortCode(c).toLowerCase()), c)
    // Un carattere sbagliato viene riconosciuto.
    const bad = c.slice(0, 3) + (c[3] === '2' ? '3' : '2') + c.slice(4)
    assert.ok(!isValidShortCode(bad))
  }
  assert.ok(!isValidShortCode('ABC'))
  assert.ok(!isValidShortCode('0000O0O0'))
})

test('lettura del QR: indirizzo della carta, token da solo o codice breve', () => {
  const token = newToken()
  const short = shortCodeFromRandom(randomBytes(8))
  assert.deepEqual(readCardCode(`https://carte.studio.it/f/${token}`), { token })
  assert.deepEqual(readCardCode(` https://carte.studio.it/f/${token}/ `), { token })
  assert.deepEqual(readCardCode(`https://carte.studio.it/f/${token}`, 'https://carte.studio.it'), { token })
  // Un indirizzo di un altro dominio non vale (se il dominio delle carte è configurato)…
  assert.equal(readCardCode(`https://altro.example/f/${token}`, 'https://carte.studio.it'), null)
  // …né un percorso diverso o un token di lunghezza sbagliata.
  assert.equal(readCardCode(`https://carte.studio.it/c/${token}`), null)
  assert.equal(readCardCode(`https://carte.studio.it/f/${token.slice(1)}`), null)
  assert.equal(readCardCode('https://carte.studio.it/f/'), null)
  assert.deepEqual(readCardCode(token), { token })
  assert.deepEqual(readCardCode(formatShortCode(short).toLowerCase()), { short })
  assert.equal(readCardCode('ciao'), null)
  assert.equal(readCardCode(''), null)
})

test('stato della carta', () => {
  const base = { disabledAt: null, completedAt: null, expiresOn: null }
  assert.equal(cardStatus(base, '2026-10-20'), 'attiva')
  assert.equal(cardStatus({ ...base, completedAt: 'x' }, '2026-10-20'), 'completata')
  assert.equal(cardStatus({ ...base, expiresOn: '2026-10-19' }, '2026-10-20'), 'scaduta')
  assert.equal(cardStatus({ ...base, expiresOn: '2026-10-20' }, '2026-10-20'), 'attiva')
  assert.equal(cardStatus({ ...base, disabledAt: 'x', completedAt: 'y' }, '2026-10-20'), 'disattivata')
})

test('timbri: attesa tra due timbri, carta completa/disattivata/scaduta, correzioni dello staff', () => {
  const t0 = Date.parse('2026-10-20T10:00:00Z')
  const H = 3_600_000
  const card = { status: 'attiva' as const, lastStampAt: new Date(t0).toISOString() }
  assert.deepEqual(checkStamp({ status: 'attiva', lastStampAt: null }, 12, t0), { ok: true })
  // Prima delle 12 ore: bloccato, con l'ora in cui si può riprovare.
  const early = checkStamp(card, 12, t0 + 11 * H + 59 * 60_000)
  assert.deepEqual(early, { ok: false, reason: 'attesa', retryAt: new Date(t0 + 12 * H).toISOString() })
  // Alle 12 ore esatte passa.
  assert.deepEqual(checkStamp(card, 12, t0 + 12 * H), { ok: true })
  // Attesa configurabile, anche zero.
  assert.equal(checkStamp(card, 24, t0 + 13 * H).ok, false)
  assert.equal(checkStamp(card, 0, t0).ok, true)
  // «force» (solo dal dettaglio) salta l'attesa ma non gli altri blocchi.
  assert.equal(checkStamp(card, 12, t0 + H, true).ok, true)
  for (const status of ['completata', 'disattivata', 'scaduta'] as const) {
    const r = checkStamp({ status, lastStampAt: null }, 12, t0, true)
    assert.deepEqual(r, { ok: false, reason: status })
  }
})

test('solo il nome di battesimo', () => {
  assert.equal(firstName('Maria Grazia Rossi'), 'Maria')
  assert.equal(firstName('  Luca  '), 'Luca')
  assert.equal(firstName(''), '')
})

test('dominio delle carte da CARD_BASE_URL', () => {
  const old = process.env.CARD_BASE_URL
  try {
    delete process.env.CARD_BASE_URL
    assert.equal(cardBaseUrl(), null)
    assert.equal(cardUrl('x'.repeat(32)), null)
    process.env.CARD_BASE_URL = 'https://carte.studio.it/'
    assert.equal(cardBaseUrl(), 'https://carte.studio.it')
    assert.equal(cardUrl('abc'), 'https://carte.studio.it/f/abc')
    process.env.CARD_BASE_URL = 'non un indirizzo'
    assert.equal(cardBaseUrl(), null)
    process.env.CARD_BASE_URL = 'ftp://carte.studio.it'
    assert.equal(cardBaseUrl(), null)
  } finally {
    if (old === undefined) delete process.env.CARD_BASE_URL
    else process.env.CARD_BASE_URL = old
  }
})
