import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPassword, hashPassword, normalizeEmail, normalizeUsername, UserError, verifyPassword } from '../src/users.ts'

test('hash e verifica della password (scrypt, salt casuale)', async () => {
  const h1 = await hashPassword('password-sicura')
  const h2 = await hashPassword('password-sicura')
  assert.match(h1, /^scrypt\$16384\$8\$1\$/)
  assert.notEqual(h1, h2, 'ogni hash deve avere un salt diverso')
  assert.equal(await verifyPassword('password-sicura', h1), true)
  assert.equal(await verifyPassword('password-sbagliata', h1), false)
  assert.equal(await verifyPassword('password-sicura', 'formato-non-valido'), false)
})

test('validazione di nome utente, email e password', () => {
  assert.equal(normalizeUsername('  Mario.R_1 '), 'Mario.R_1')
  for (const bad of ['ab', 'nome con spazi', 'àccento', 'x'.repeat(33)]) {
    assert.throws(() => normalizeUsername(bad), UserError)
  }
  assert.equal(normalizeEmail(''), null)
  assert.equal(normalizeEmail(' Mario@Studio.IT '), 'mario@studio.it')
  assert.throws(() => normalizeEmail('mario@studio'), UserError)
  assert.throws(() => checkPassword('corta'), UserError)
  assert.equal(checkPassword('abbastanza'), 'abbastanza')
})
