import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TOKEN_MAX_TOTAL_MS, TOKEN_TTL_MS } from '../../shared/webRequests.ts'
import { issueToken, parseBooking, verifyToken, WebRequestError, WindowLimiter } from '../src/bookingCore.ts'
import { inboxKeys, open, seal } from '../src/inboxCrypto.ts'

const key = Buffer.alloc(32, 7)
const T0 = 1_800_000_000_000

test('il codice vale fino a 10 minuti e poi scade', () => {
  const { token, nonce } = issueToken(key, T0)
  assert.equal(verifyToken(key, token, T0 + 1000)?.nonce, nonce)
  assert.equal(verifyToken(key, token, T0 + TOKEN_TTL_MS)?.nonce, nonce)
  assert.equal(verifyToken(key, token, T0 + TOKEN_TTL_MS + 1), null)
})

test('il codice con firma sbagliata, alterato o di un\'altra chiave è rifiutato', () => {
  const { token } = issueToken(key, T0)
  assert.equal(verifyToken(Buffer.alloc(32, 8), token, T0 + 1), null)
  const parts = token.split('.')
  parts[3] = String(T0 + 5 * 60_000) // emissione ritoccata per allungare la validità
  assert.equal(verifyToken(key, parts.join('.'), T0 + TOKEN_TTL_MS + 1), null)
  for (const bad of ['', 'x', 'v1.a.b.c.d', token + 'x', token.slice(0, -2), null, undefined, 42, {}, 'v1..1800000000000.1800000000000.' + 'a'.repeat(43)]) {
    assert.equal(verifyToken(key, bad, T0 + 1), null)
  }
})

test('il codice emesso nel futuro non vale', () => {
  const { token } = issueToken(key, T0 + 60_000)
  assert.equal(verifyToken(key, token, T0), null)
})

test('i rinnovi conservano l\'apertura e hanno un tetto di 30 minuti', () => {
  let t = T0
  let { token } = issueToken(key, t)
  for (let i = 0; i < 3; i++) {
    t += 8 * 60_000
    const info = verifyToken(key, token, t)
    assert.ok(info, `rinnovo ${i}`)
    assert.equal(info.startedAt, T0)
    token = issueToken(key, t, info.startedAt).token
  }
  t += 8 * 60_000 // 32 minuti dall'apertura
  assert.equal(verifyToken(key, token, t), null)
  assert.ok(t - T0 > TOKEN_MAX_TOTAL_MS)
})

const valid = { name: ' Mario ', surname: 'Rossi', phone: '+39 333 123 4567', message: 'Mal di denti\n\n\n\nda ieri', slot: 'mattina', consent: true, website: '' }

test('la richiesta valida viene normalizzata', () => {
  const p = parseBooking(valid)
  assert.equal(p.name, 'Mario')
  assert.equal(p.message, 'Mal di denti\n\nda ieri')
  assert.equal(p.slot, 'mattina')
  assert.equal(p.honeypot, false)
  assert.equal(parseBooking({ ...valid, slot: undefined }).slot, 'indifferente')
  assert.equal(parseBooking({ ...valid, website: 'http://spam' }).honeypot, true)
})

test('la richiesta non valida è rifiutata', () => {
  const bad: Record<string, unknown>[] = [
    { consent: false },
    { consent: 'true' },
    { name: '' },
    { name: 'a'.repeat(41) },
    { surname: ' ' },
    { phone: 'abc' },
    { phone: '12' },
    { phone: '333; DROP TABLE' },
    { message: 'x'.repeat(601) },
    { slot: 'notte' },
    { slot: '__proto__' },
    { name: { a: 1 } },
    { name: ['Mario'] },
  ]
  for (const b of bad) assert.throws(() => parseBooking({ ...valid, ...b }), WebRequestError, JSON.stringify(b))
  assert.throws(() => parseBooking(null), WebRequestError)
})

test('caratteri di controllo e di direzione del testo vengono tolti', () => {
  const p = parseBooking({ ...valid, name: 'Ma‮rio\u0000', message: 'ciao\u0007' })
  assert.equal(p.name, 'Mario')
  assert.equal(p.message, 'ciao')
})

test('il limite per IP scatta e poi si libera', () => {
  const l = new WindowLimiter(2, 1000)
  assert.equal(l.blocked('a', 0), false)
  l.hit('a', 0)
  l.hit('a', 10)
  assert.equal(l.blocked('a', 20), true)
  assert.equal(l.blocked('b', 20), false)
  assert.equal(l.blocked('a', 1001), false)
})

test('sigillo della inbox: solo il gestionale riapre, e solo per la richiesta giusta', () => {
  const k = inboxKeys(Buffer.alloc(32, 5))
  const sealed = seal(k.publicRaw, '{"name":"Mario"}', 'nonce-1')
  assert.ok(!sealed.includes('Mario'))
  assert.equal(open(k.privateKey, sealed, 'nonce-1'), '{"name":"Mario"}')
  // un altro identificativo, un'altra chiave o un sigillo manomesso non si aprono
  assert.equal(open(k.privateKey, sealed, 'nonce-2'), null)
  assert.equal(open(inboxKeys(Buffer.alloc(32, 6)).privateKey, sealed, 'nonce-1'), null)
  const parts = sealed.split('.')
  parts[3] = parts[3].slice(0, -4) + 'AAAA'
  assert.equal(open(k.privateKey, parts.join('.'), 'nonce-1'), null)
  for (const bad of ['', 's1', 's1.a.b.c', 'x.y.z.w', sealed + '.extra']) assert.equal(open(k.privateKey, bad, 'nonce-1'), null)
  // ogni sigillo è diverso (chiave temporanea) e la chiave pubblica non permette di aprire
  assert.notEqual(seal(k.publicRaw, 'a', 'n'), seal(k.publicRaw, 'a', 'n'))
  assert.deepEqual(inboxKeys(Buffer.alloc(32, 5)).publicRaw, k.publicRaw)
})
