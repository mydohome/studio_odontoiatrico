// Prove sul database vero (PostgreSQL): si eseguono solo con TEST_DATABASE_URL impostata, es.
//   TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test
// Usa un database di prova: crea le tabelle e CANCELLA le richieste web (e gli appuntamenti «Prova DB») che contiene.

import assert from 'node:assert/strict'
import { test } from 'node:test'

const URL = process.env.TEST_DATABASE_URL
const opts = { skip: URL ? false : 'TEST_DATABASE_URL non impostata' }

test('richieste web su database: invio, codice monouso, limiti, cifratura, scadenza e pulizia', opts, async (t) => {
  process.env.DATABASE_URL = URL
  process.env.DATA_KEY = 'b'.repeat(64)
  const { migrate, pool, setSetting } = await import('../src/db.ts')
  const { loadDataKey } = await import('../src/dataCrypto.ts')
  const { default: Fastify } = await import('fastify')
  const A = await import('../src/appointments.ts')
  const W = await import('../src/webRequests.ts')
  loadDataKey()
  await migrate()
  await A.migrateAppointments()
  t.after(() => pool.end())
  await pool.query(`DELETE FROM appointments WHERE web_request_at IS NOT NULL OR patient_name = 'Prova DB'`)

  const key = Buffer.alloc(32, 9)
  let enabled = true
  let ip = '10.0.0.1'
  const app = Fastify()
  app.setErrorHandler((err: Error & { status?: number }, _req, reply) => {
    reply.status(err.status ?? 500).send({ error: err.message })
  })
  W.registerWebRequests(app, {
    currentUser: async () => 'tester',
    studio: async () => ({ name: 'Studio Prova', phone: '02 1234567' }),
    clientIp: () => ip,
    secret: () => key,
    enabled: async () => enabled,
  })
  const get = (url: string) => app.inject({ method: 'GET', url })
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object })
  const form = { name: 'Giulia', surname: 'Verdi', phone: '333 123 4567', message: 'Mal di denti', slot: 'pomeriggio', consent: true, website: '' }
  // Il modulo si può inviare solo dopo 3 secondi: si emettono codici «vecchi» firmati con la stessa chiave.
  const old = (ms = 5000) => W.issueToken(key, Date.now() - ms)

  // senza informativa il modulo resta chiuso
  await setSetting(W.PRIVACY_KEY, '')
  assert.equal((await get('/api/public/requests/session')).statusCode, 404)
  await setSetting(W.PRIVACY_KEY, 'https://www.studio.test/privacy')
  enabled = false
  assert.equal((await get('/api/public/requests/session')).statusCode, 404)
  enabled = true
  const session = (await get('/api/public/requests/session')).json()
  assert.equal(session.studio.name, 'Studio Prova')
  assert.equal(session.privacyUrl, 'https://www.studio.test/privacy')
  assert.equal((await post('/api/public/requests/submit', { ...form, token: session.token })).statusCode, 429, 'troppo veloce')

  // invio: una richiesta senza data, cifrata, con consenso registrato e IP solo come impronta
  const a = old()
  assert.equal((await post('/api/public/requests/submit', { ...form, token: a.token })).statusCode, 200)
  const raw = (await pool.query('SELECT * FROM appointments WHERE web_nonce = $1', [a.nonce])).rows[0]
  assert.equal(raw.day, null)
  assert.ok(raw.patient_name.startsWith('v1:') && raw.patient_phone.startsWith('v1:') && raw.notes.startsWith('v1:'))
  assert.ok(!JSON.stringify(raw).includes('Verdi') && !JSON.stringify(raw).includes('10.0.0.1'))
  assert.equal(raw.web_slot, 'pomeriggio')
  assert.equal(raw.web_consent, 'v1 https://www.studio.test/privacy')
  assert.equal(raw.web_ip_hash.length, 32)

  // stato e liste: «richiesta-web», non «da riprogrammare»
  const reqs = await A.listWebRequests()
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].status, 'richiesta-web')
  assert.equal(reqs[0].patientName, 'Giulia Verdi')
  assert.equal(reqs[0].notes, 'Mal di denti')
  assert.equal(reqs[0].webSlot, 'pomeriggio')
  assert.equal((await A.listToReschedule()).filter((x) => x.webRequestAt).length, 0)
  assert.equal((await get('/api/web-requests/count')).json().count, 1)

  // codice monouso: stesso modulo inviato due volte, rinnovo di un codice già usato
  assert.equal((await post('/api/public/requests/submit', { ...form, token: a.token })).statusCode, 410)
  assert.equal((await post('/api/public/requests/renew', { token: a.token })).statusCode, 410)
  // codice scaduto (oltre 10 minuti) o con firma di un'altra chiave
  const expired = W.issueToken(key, Date.now() - 11 * 60_000)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: expired.token })).statusCode, 410)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: W.issueToken(Buffer.alloc(32, 1), Date.now() - 5000).token })).statusCode, 410)
  // trappola: risposta positiva ma nulla salvato
  const h = old()
  assert.equal((await post('/api/public/requests/submit', { ...form, website: 'x', token: h.token })).statusCode, 200)
  assert.equal((await pool.query('SELECT 1 FROM appointments WHERE web_nonce = $1', [h.nonce])).rowCount, 0)

  // rinnovo: nuovo codice con la stessa apertura
  const r = (await post('/api/public/requests/renew', { token: session.token })).json()
  assert.equal(r.startedAt, session.startedAt)
  assert.notEqual(r.token, session.token)

  // limite per IP: al massimo 3 richieste all'ora
  const c1 = old()
  const c2 = old()
  const c3 = old()
  assert.equal((await post('/api/public/requests/submit', { ...form, token: c1.token })).statusCode, 200)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: c2.token })).statusCode, 200)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: c3.token })).statusCode, 429)
  ip = '10.0.0.2' // un altro IP non è limitato
  assert.equal((await post('/api/public/requests/submit', { ...form, token: c3.token })).statusCode, 200)

  // «Fissa appuntamento»: con data e ora diventa un appuntamento normale e non è più una richiesta
  const id = reqs[0].id
  const fixed = await A.updateAppointment(id, { day: '2030-01-15', time: '10:00', duration: 30, patientName: 'Giulia Verdi', patientPhone: '333 123 4567', serviceId: null, doctorId: null, notes: '' })
  assert.equal(fixed.status, 'da-inviare')
  assert.equal(fixed.webRequestAt, null)
  assert.equal((await A.listWebRequests()).some((x) => x.id === id), false)
  // e rimesso «da riprogrammare» non torna tra le richieste web
  assert.equal((await A.setToReschedule(id)).status, 'da-riprogrammare')

  // pulizia: richieste vecchie di oltre 30 giorni cancellate, impronte IP oltre 7 giorni azzerate
  await pool.query(`UPDATE appointments SET web_request_at = now() - interval '31 days' WHERE web_nonce = $1`, [c1.nonce])
  await pool.query(`UPDATE appointments SET web_request_at = now() - interval '8 days' WHERE web_nonce = $1`, [c2.nonce])
  await W.purgeWebRequests()
  assert.equal((await pool.query('SELECT 1 FROM appointments WHERE web_nonce = $1', [c1.nonce])).rowCount, 0)
  const kept = (await pool.query('SELECT web_ip_hash FROM appointments WHERE web_nonce = $1', [c2.nonce])).rows[0]
  assert.equal(kept.web_ip_hash, null)
  // un appuntamento fissato non si cancella mai con la pulizia, nemmeno se nato da una richiesta vecchia
  assert.equal((await pool.query('SELECT 1 FROM appointments WHERE id = $1', [id])).rowCount, 1)
  await pool.query(`DELETE FROM appointments WHERE web_request_at IS NOT NULL OR id = $1`, [id])
})
