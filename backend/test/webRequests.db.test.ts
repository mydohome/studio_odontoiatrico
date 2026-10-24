// Prove sul database vero (PostgreSQL): si eseguono solo con TEST_DATABASE_URL impostata (utente con diritti di
// amministratore: crea lo schema e l'utente della inbox), es.
//   TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test
// Usa un database di prova: CANCELLA le richieste web (e gli appuntamenti «Prova DB») che contiene.

import assert from 'node:assert/strict'
import { test } from 'node:test'

const URL = process.env.TEST_DATABASE_URL
const opts = { skip: URL ? false : 'TEST_DATABASE_URL non impostata' }

test('richieste web: container pubblico isolato, inbox sigillata, importazione, limiti, pulizia', opts, async (t) => {
  const PASSWORD = 'test_password_booking_1234'
  process.env.DATABASE_URL = URL
  process.env.DATA_KEY = 'b'.repeat(64)
  process.env.BOOKING_DB_PASSWORD = PASSWORD
  const { migrate, pool, setSetting } = await import('../src/db.ts')
  const { loadDataKey } = await import('../src/dataCrypto.ts')
  const { default: pg } = await import('pg')
  const A = await import('../src/appointments.ts')
  const W = await import('../src/webRequests.ts')
  const I = await import('../src/inbox.ts')
  const { buildBookingApp } = await import('../src/bookingApp.ts')
  const { issueToken } = await import('../src/bookingCore.ts')
  loadDataKey()
  await migrate()
  await (await import('../src/users.ts')).migrateUsers()
  await (await import('../src/categories.ts')).migrateCategories()
  await (await import('../src/doctors.ts')).migrateDoctors()
  await A.migrateAppointments()
  await I.migrateInbox()

  // Il container pubblico si collega SOLO con l'utente della inbox.
  const u = new globalThis.URL(URL!)
  u.username = I.INBOX_ROLE
  u.password = PASSWORD
  const pub = new pg.Pool({ connectionString: u.toString(), max: 3 })
  t.after(async () => {
    await pub.end()
    await pool.end()
  })
  await pool.query(`DELETE FROM appointments WHERE web_request_at IS NOT NULL OR patient_name = 'Prova DB'`)
  await pool.query('DELETE FROM inbox.requests')
  await pool.query('DELETE FROM inbox.nonces')
  await pool.query('DELETE FROM inbox.hits')
  await pool.query('DELETE FROM inbox.config')

  // --- isolamento: nient'altro che la inbox è leggibile o scrivibile con quell'utente
  for (const table of ['appointments', 'users', 'settings', 'services', 'doctors']) {
    await assert.rejects(pub.query(`SELECT * FROM public.${table} LIMIT 1`), /permission denied/, `lettura di ${table}`)
  }
  await assert.rejects(pub.query(`UPDATE public.appointments SET notes = 'x'`), /permission denied/)
  await assert.rejects(pub.query(`DELETE FROM public.appointments`), /permission denied/)
  await assert.rejects(pub.query(`CREATE TABLE public.x (a int)`), /permission denied/)
  await assert.rejects(pub.query(`SELECT sealed FROM inbox.requests`), /permission denied/, 'il contenuto della inbox non si legge')
  await assert.rejects(pub.query(`UPDATE inbox.config SET value = 'x'`), /permission denied/)
  await assert.rejects(pub.query(`DELETE FROM inbox.requests`), /permission denied/)
  await pub.query('SELECT count(id) FROM inbox.requests')

  const studio = { enabled: true, studioName: 'Studio Prova', phone: '02 1234567' }
  const app = buildBookingApp(pub, 'segreto-di-prova-'.repeat(3))
  const H = { 'x-public-gateway': 'requests' }
  const get = (url: string, headers: Record<string, string> = H) => app.inject({ method: 'GET', url, headers })
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: H, payload: payload as object })
  const form = { name: 'Giulia', surname: 'Verdi', phone: '333 123 4567', message: 'Mal di denti', slot: 'pomeriggio', consent: true, website: '' }
  // Il modulo si può inviare solo dopo 3 secondi: si emettono codici «vecchi» firmati con la stessa chiave.
  const bkey = (await import('node:crypto')).createHmac('sha256', 'studio-booking').update('segreto-di-prova-'.repeat(3)).digest()
  const old = (ms = 5000) => issueToken(bkey, Date.now() - ms)

  // --- chiuso finché il gestionale non pubblica: senza informativa, spento, o pubblicazione ferma da troppo
  assert.equal((await get('/api/public/requests/session')).statusCode, 404, 'niente impostazioni pubblicate')
  await setSetting(W.PRIVACY_KEY, '')
  await I.publishInbox(studio)
  assert.equal((await get('/api/public/requests/session')).statusCode, 404, 'senza informativa')
  await setSetting(W.PRIVACY_KEY, 'https://www.studio.test/privacy')
  await I.publishInbox({ ...studio, enabled: false })
  assert.equal((await get('/api/public/requests/session')).statusCode, 404, 'spento')
  await I.publishInbox(studio)
  const session = (await get('/api/public/requests/session')).json()
  assert.equal(session.studio.name, 'Studio Prova')
  assert.equal(session.privacyUrl, 'https://www.studio.test/privacy')
  await pool.query(`UPDATE inbox.config SET updated_at = now() - interval '6 minutes'`)
  assert.equal((await get('/api/public/requests/session')).statusCode, 404, 'stato del gestionale scaduto')
  await I.publishInbox(studio)

  // --- il container risponde solo alle sue rotte
  assert.equal((await get('/api/public/requests/session', {})).statusCode, 404, 'senza intestazione del gateway')
  assert.equal((await get('/api/appointments')).statusCode, 404)
  assert.equal((await get('/api/login')).statusCode, 404)
  assert.equal((await get('/api/health', {})).statusCode, 200)

  assert.equal((await post('/api/public/requests/submit', { ...form, token: session.token })).statusCode, 429, 'troppo veloce')

  // --- invio: nella inbox c'è solo il sigillo, e nulla di leggibile
  const a = old()
  assert.equal((await post('/api/public/requests/submit', { ...form, token: a.token })).statusCode, 200)
  const raw = (await pool.query('SELECT * FROM inbox.requests')).rows
  assert.equal(raw.length, 1)
  assert.ok(raw[0].sealed.startsWith('s1.'))
  assert.ok(!JSON.stringify(raw[0]).includes('Verdi') && !JSON.stringify(raw[0]).includes('333'))
  assert.equal(raw[0].consent, 'v1 https://www.studio.test/privacy')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM appointments WHERE web_request_at IS NOT NULL')).rows[0].n, 0, 'non è ancora nell\'agenda')

  // --- codice monouso: anche dopo l'importazione, il codice usato non vale più
  assert.equal(await I.importInbox(), 1)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n, 0)
  assert.equal(await I.importInbox(), 0)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: a.token })).statusCode, 410)
  assert.equal((await post('/api/public/requests/renew', { token: a.token })).statusCode, 410)

  // --- agenda: cifrata, senza data, con consenso e fascia; non è «da riprogrammare»
  const reqs = await A.listWebRequests()
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].status, 'richiesta-web')
  assert.equal(reqs[0].patientName, 'Giulia Verdi')
  assert.equal(reqs[0].patientPhone, '333 123 4567')
  assert.equal(reqs[0].notes, 'Mal di denti')
  assert.equal(reqs[0].webSlot, 'pomeriggio')
  const stored = (await pool.query('SELECT * FROM appointments WHERE id = $1', [reqs[0].id])).rows[0]
  assert.ok(stored.patient_name.startsWith('v1:') && stored.patient_phone.startsWith('v1:') && stored.notes.startsWith('v1:'))
  assert.equal(stored.web_consent, 'v1 https://www.studio.test/privacy')
  assert.equal((await A.listToReschedule()).filter((x) => x.webRequestAt).length, 0)

  // --- altri controlli del container
  const expired = issueToken(bkey, Date.now() - 11 * 60_000)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: expired.token })).statusCode, 410)
  assert.equal((await post('/api/public/requests/submit', { ...form, token: issueToken(Buffer.alloc(32, 1), Date.now() - 5000).token })).statusCode, 410)
  assert.equal((await post('/api/public/requests/submit', { ...form, consent: false, token: old().token })).statusCode, 400)
  const h = old()
  assert.equal((await post('/api/public/requests/submit', { ...form, website: 'x', token: h.token })).statusCode, 200, 'trappola: finta riuscita')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n, 0)
  const r = (await post('/api/public/requests/renew', { token: session.token })).json()
  assert.equal(r.startedAt, session.startedAt)
  assert.notEqual(r.token, session.token)

  // --- limite per IP: 3 all'ora (stesso IP dei test = x-real-ip assente)
  const c = [old(), old(), old(), old()]
  const ok = []
  for (const x of c) ok.push((await post('/api/public/requests/submit', { ...form, token: x.token })).statusCode)
  assert.deepEqual(ok, [200, 200, 429, 429], 'dopo 3 richieste all\'ora lo stesso IP viene fermato')

  // --- importazione: ricontrolla ogni richiesta, anche se il container pubblico fosse compromesso
  assert.equal(await I.importInbox(), 2)
  const { rows: ins } = await pool.query(`SELECT id FROM inbox.requests`)
  assert.equal(ins.length, 0)
  const { seal } = await import('../src/inboxCrypto.ts')
  const { inboxKeys } = await import('../src/inboxCrypto.ts')
  const { loadedDataKey } = await import('../src/dataCrypto.ts')
  const k = inboxKeys(loadedDataKey()!)
  const nonce = (n: string) => n.padEnd(32, 'x')
  const put = (n: string, sealed: string, slot = 'mattina', consent = 'v1 https://x.test') =>
    pool.query('INSERT INTO inbox.requests (nonce, sealed, slot, consent, ip_hash) VALUES ($1,$2,$3,$4,$5)', [nonce(n), sealed, slot, consent, 'h'])
  const good = { name: 'Anna', surname: 'Neri', phone: '0612345678', message: '' }
  await put('ok', seal(k.publicRaw, JSON.stringify(good), nonce('ok')))
  await put('altro', seal(k.publicRaw, JSON.stringify(good), nonce('qualcosa-di-diverso'))) // sigillo di un'altra richiesta
  await put('lungo', seal(k.publicRaw, JSON.stringify({ ...good, name: 'a'.repeat(500) }), nonce('lungo')))
  await put('tel', seal(k.publicRaw, JSON.stringify({ ...good, phone: 'abc' }), nonce('tel')))
  await put('slot', seal(k.publicRaw, JSON.stringify(good), nonce('slot')), 'notte')
  await put('json', seal(k.publicRaw, 'non è json', nonce('json')))
  await put('cons', seal(k.publicRaw, JSON.stringify(good), nonce('cons')), 'mattina', 'senza versione')
  await put('chiaro', JSON.stringify(good)) // non sigillata
  assert.equal(await I.importInbox(), 1, 'solo la richiesta valida entra nell\'agenda')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n, 0, 'le scartate non restano in coda')
  assert.equal((await A.listWebRequests()).filter((x) => x.patientName === 'Anna Neri').length, 1)

  // --- tetto di richieste in attesa
  await pool.query(`INSERT INTO appointments (day, start_time, patient_name, patient_phone, notes, token, web_request_at, web_nonce)
                    SELECT NULL, NULL, 'x', 'x', 'x', 'tk' || g, now(), 'riempi' || g FROM generate_series(1, 200) g`)
  await put('tetto', seal(k.publicRaw, JSON.stringify(good), nonce('tetto')))
  assert.equal(await I.importInbox(), 0)
  await pool.query(`DELETE FROM appointments WHERE web_nonce LIKE 'riempi%'`)

  // --- «Fissa appuntamento»: con data e ora diventa un appuntamento normale e non è più una richiesta
  const id = reqs[0].id
  const fixed = await A.updateAppointment(id, { day: '2030-01-15', time: '10:00', duration: 30, patientName: 'Giulia Verdi', patientPhone: '333 123 4567', serviceId: null, doctorId: null, notes: '' })
  assert.equal(fixed.status, 'da-inviare')
  assert.equal((await A.listWebRequests()).some((x) => x.id === id), false)
  assert.equal((await A.setToReschedule(id)).status, 'da-riprogrammare')

  // --- pulizia: richieste ferme oltre 30 giorni, codici oltre un'ora, contatori oltre un giorno
  await put('vecchia', seal(k.publicRaw, JSON.stringify(good), nonce('vecchia')))
  await pool.query(`UPDATE inbox.requests SET created_at = now() - interval '31 days'`)
  await pool.query(`UPDATE inbox.nonces SET at = now() - interval '2 hours' WHERE nonce = $1`, [a.nonce])
  await pool.query(`UPDATE inbox.hits SET at = now() - interval '2 days'`)
  await I.purgeInbox()
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n, 0)
  assert.equal((await pool.query('SELECT 1 FROM inbox.nonces WHERE nonce = $1', [a.nonce])).rowCount, 0)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inbox.hits')).rows[0].n, 0)
  await pool.query(`UPDATE appointments SET web_request_at = now() - interval '31 days' WHERE web_nonce IS NOT NULL AND day IS NULL AND web_request_at IS NOT NULL`)
  await W.purgeWebRequests()
  assert.equal((await A.listWebRequests()).length, 0)
  assert.equal((await pool.query('SELECT 1 FROM appointments WHERE id = $1', [id])).rowCount, 1, 'un appuntamento già fissato non si cancella')
  await pool.query(`DELETE FROM appointments WHERE web_nonce IS NOT NULL OR id = $1`, [id])
})
