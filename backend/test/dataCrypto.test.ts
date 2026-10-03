import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { decryptWith, encryptWith, isEncrypted, parseDataKey } from '../src/dataCrypto.ts'

const key = randomBytes(32)

test('cifra e decifra nome, telefono e note (anche vuote e con accenti)', () => {
  for (const v of ['Mario Rossi', '+39 333 1234567', '', 'Allergia alla penicillina\nNiccolò D’Amico']) {
    const enc = encryptWith(key, v, 'notes')
    assert.ok(isEncrypted(enc), enc)
    assert.ok(!enc.includes(v) || v === '')
    assert.equal(decryptWith(key, enc, 'notes'), v)
  }
})

test('lo stesso valore cifrato due volte dà testi diversi', () => {
  assert.notEqual(encryptWith(key, 'Mario Rossi', 'patient_name'), encryptWith(key, 'Mario Rossi', 'patient_name'))
})

test('chiave sbagliata, colonna diversa o dato alterato: errore', () => {
  const enc = encryptWith(key, 'Mario Rossi', 'patient_name')
  assert.throws(() => decryptWith(randomBytes(32), enc, 'patient_name'))
  assert.throws(() => decryptWith(key, enc, 'patient_phone'))
  const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA')
  assert.throws(() => decryptWith(key, tampered, 'patient_name'))
})

test('testo in chiaro non viene scambiato per cifrato', () => {
  for (const v of ['Mario Rossi', '333 1234567', '', 'v1:nota breve']) assert.equal(isEncrypted(v), false)
})

test('formato della chiave DATA_KEY', () => {
  const hex = key.toString('hex')
  assert.deepEqual(parseDataKey(hex), key)
  assert.deepEqual(parseDataKey(` ${hex}\n`), key)
  assert.deepEqual(parseDataKey(key.toString('base64')), key)
  assert.deepEqual(parseDataKey(key.toString('base64url')), key)
  assert.equal(parseDataKey(''), null)
  assert.equal(parseDataKey(undefined), null)
  assert.throws(() => parseDataKey('troppo-corta'))
  assert.throws(() => parseDataKey(hex.slice(2)))
})
