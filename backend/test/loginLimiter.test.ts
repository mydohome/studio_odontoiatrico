import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LoginLimiter } from '../src/loginLimiter.ts'

const opts = { windowMs: 15 * 60000, perUserIp: 5, perUser: 20, perIp: 30 }

test('dallo stesso IP: oltre il limite si attende, anche con richieste in parallelo', () => {
  const l = new LoginLimiter(opts)
  const results = Array.from({ length: 40 }, () => l.attempt('Mario', '10.0.0.1', 0))
  assert.equal(results.filter((r) => r === 0).length, 5)
  assert.equal(results[5], 900)
  // Maiuscole e spazi non creano un nome utente diverso.
  assert.ok(l.attempt('  MARIO ', '10.0.0.1', 0) > 0)
  // Finestra scaduta: si riprova.
  assert.equal(l.attempt('mario', '10.0.0.1', opts.windowMs), 0)
})

test("un attacco da un IP non blocca il collega che entra da un altro IP", () => {
  const l = new LoginLimiter(opts)
  for (let i = 0; i < 10; i++) l.attempt('mario', '198.51.100.7', 0)
  assert.ok(l.attempt('mario', '198.51.100.7', 0) > 0)
  assert.equal(l.attempt('mario', '203.0.113.9', 0), 0)
})

test('attacco da tanti IP: tetto per nome utente, ma non per gli IP già usati con successo', () => {
  const l = new LoginLimiter(opts)
  assert.equal(l.attempt('mario', 'studio', 0), 0)
  l.success('mario', 'studio', 0)
  for (let i = 0; i < 20; i++) assert.equal(l.attempt('mario', `bot${i}`, 1), 0)
  assert.ok(l.attempt('mario', 'bot-nuovo', 2) > 0, 'tetto per nome utente raggiunto')
  assert.equal(l.attempt('mario', 'studio', 3), 0, "dall'IP dello studio si entra comunque")
})

test('limite per IP anche con nomi utente sempre diversi', () => {
  const l = new LoginLimiter(opts)
  for (let i = 0; i < 30; i++) assert.equal(l.attempt(`utente${i}`, '1.2.3.4', 0), 0)
  assert.ok(l.attempt('altro', '1.2.3.4', 0) > 0)
  assert.equal(l.attempt('altro', '5.6.7.8', 0), 0)
})

test("per l'IP contano solo gli errori: tante persone dello studio dietro lo stesso indirizzo", () => {
  const l = new LoginLimiter({ ...opts, perIp: 3 })
  for (let i = 0; i < 50; i++) {
    assert.equal(l.attempt(`collega${i}`, 'ufficio', 0), 0)
    l.success(`collega${i}`, 'ufficio', 0)
  }
  for (let i = 0; i < 3; i++) l.attempt('x', 'ufficio', 0)
  assert.ok(l.attempt('y', 'ufficio', 0) > 0)
})

test('inventare tanti nomi utente non azzera i contatori ancora validi', () => {
  const l = new LoginLimiter({ ...opts, perIp: 1_000_000, maxEntries: 100 })
  for (let i = 0; i < 5; i++) l.attempt('mario', 'ip', 0)
  for (let i = 0; i < 50; i++) l.attempt(`x${i}`, 'ip', 1)
  assert.ok(l.attempt('mario', 'ip', 2) > 0)
})
