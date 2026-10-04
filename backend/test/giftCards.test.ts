import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { CODE_ALPHABET, codeFromRandom, describeContent, formatCode, isValidCode, matchCodeEnd, normalizeCode, parseEuro } from '../../shared/giftCards.ts'

test('codice: formato, validità e lettura con trattini o minuscole', () => {
  for (let i = 0; i < 200; i++) {
    const c = codeFromRandom(randomBytes(10))
    assert.match(c, /^GC[2-9A-HJ-NP-Z]{11}$/)
    assert.ok(isValidCode(c), c)
    assert.equal(normalizeCode(formatCode(c).toLowerCase()), c)
  }
})

test('codice: un carattere sbagliato viene sempre riconosciuto', () => {
  for (let n = 0; n < 50; n++) {
    const c = codeFromRandom(randomBytes(10))
    for (let pos = 2; pos < c.length; pos++) {
      for (const ch of CODE_ALPHABET) {
        if (ch === c[pos]) continue
        assert.equal(isValidCode(c.slice(0, pos) + ch + c.slice(pos + 1)), false, `${c} pos ${pos} → ${ch}`)
      }
    }
  }
})

test('codice: due caratteri vicini scambiati quasi sempre riconosciuti', () => {
  let swaps = 0
  let caught = 0
  for (let n = 0; n < 300; n++) {
    const c = codeFromRandom(randomBytes(10))
    for (let pos = 2; pos < c.length - 1; pos++) {
      if (c[pos] === c[pos + 1]) continue
      swaps++
      if (!isValidCode(c.slice(0, pos) + c[pos + 1] + c[pos] + c.slice(pos + 2))) caught++
    }
  }
  assert.ok(caught / swaps > 0.95, `${caught}/${swaps}`)
})

test('codice: testo non valido rifiutato', () => {
  for (const s of ['', 'GC', 'GC123', 'XX7KQ2MXP4RTH', 'GC0KQ2MXP4RTH', 'GC7KQ2MXP4RTHX']) assert.equal(isValidCode(s), false, s)
})

test('importi in euro', () => {
  assert.equal(parseEuro('12,50'), 12.5)
  assert.equal(parseEuro('12.5'), 12.5)
  assert.equal(parseEuro(' 100 € '), 100)
  assert.equal(parseEuro(30), 30)
  assert.equal(parseEuro(''), null)
  assert.equal(parseEuro('12,505'), null)
  assert.equal(parseEuro('abc'), null)
  assert.equal(parseEuro('-5'), null)
  assert.equal(describeContent({ kind: 'prestazioni', amount: null, items: [{ name: 'Igiene orale', qty: 1 }, { name: 'Visita', qty: 2 }] }), '1 × Igiene orale, 2 × Visita')
})

test('ricerca dagli ultimi caratteri del codice', () => {
  const cards = [{ code: 'GC8DSNRRJRRPW' }, { code: 'GC7KQ2MXP4RTH' }, { code: 'GCABCDEFGHRTH' }]
  assert.deepEqual(matchCodeEnd(cards, 'rpw'), [cards[0]])
  assert.deepEqual(matchCodeEnd(cards, 'RRJR-RPW'), [cards[0]])
  assert.deepEqual(matchCodeEnd(cards, ' r t h '), [cards[1], cards[2]])
  assert.deepEqual(matchCodeEnd(cards, 'MXP4-RTH'), [cards[1]])
  assert.deepEqual(matchCodeEnd(cards, 'ZZZ'), [])
  assert.equal(matchCodeEnd(cards, 'TH'), null)
  assert.equal(matchCodeEnd(cards, 'R0H'), null)
})
