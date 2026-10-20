// Prove sul database vero (PostgreSQL): si eseguono solo con TEST_DATABASE_URL impostata, es.
//   TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test
// Usa un database di prova: crea le tabelle e CANCELLA tutte le carte fidelity che contiene.

import assert from 'node:assert/strict'
import { test } from 'node:test'

const URL = process.env.TEST_DATABASE_URL
const opts = { skip: URL ? false : 'TEST_DATABASE_URL non impostata' }

test('fidelity card su database: token, timbri, attesa, completamento, annullamento, pagina pubblica', opts, async (t) => {
  process.env.DATABASE_URL = URL
  process.env.DATA_KEY = 'a'.repeat(64)
  process.env.CARD_BASE_URL = 'https://carte.studio.test'
  const { migrate, pool } = await import('../src/db.ts')
  const { loadDataKey } = await import('../src/dataCrypto.ts')
  const L = await import('../src/loyalty.ts')
  loadDataKey()
  await migrate()
  await L.migrateLoyalty()
  t.after(() => pool.end())
  // Parte sempre da zero (le carte di prove precedenti sul database di prova vengono tolte).
  await pool.query('DELETE FROM loyalty_cards')

  const studio = { name: 'Studio Prova', phone: '02 1234567', address: 'Via Roma 1', logoType: 'famiglia', logoVersion: 0, flyerStyle: 'smile' as const }
  const H = 3_600_000
  const program = await L.getProgram()
  assert.equal(program.stampsRequired, 10)
  assert.equal(program.cooldownHours, 12)

  // --- creazione: dati cifrati, token solo come impronta + cifrato, link sul dominio delle carte
  const card = await L.createCard({ name: 'Maria Grazia Rossi', phone: '333 1234567' }, 'tester')
  assert.match(card.url ?? '', /^https:\/\/carte\.studio\.test\/f\/[A-Za-z0-9_-]{32}$/)
  const token = card.url!.split('/f/')[1]
  const raw = (await pool.query('SELECT * FROM loyalty_cards WHERE id = $1', [card.id])).rows[0]
  assert.ok(raw.holder_name.startsWith('v1:') && raw.holder_phone.startsWith('v1:') && raw.token_enc.startsWith('v1:'))
  assert.equal(raw.token_hash, L.tokenHash(token))
  assert.ok(!JSON.stringify(raw).includes(token), 'il token in chiaro non è nel database')
  assert.ok(!JSON.stringify(raw).includes('Rossi'))
  assert.equal(card.stamps, 0)
  assert.equal(card.status, 'attiva')

  // --- attesa tra due timbri
  const t0 = Date.now()
  const s1 = await L.addStamp(card.id, 'anna', {}, t0)
  assert.equal(s1.card.stamps, 1)
  assert.equal(s1.stamp.by, 'anna')
  await assert.rejects(L.addStamp(card.id, 'anna', {}, t0 + 11 * H), /già dato di recente/)
  await L.addStamp(card.id, 'bruno', {}, t0 + 12 * H)
  // correzione dello staff (force): salta l'attesa
  await L.addStamp(card.id, 'anna', { force: true, note: 'timbro dimenticato' }, t0 + 12 * H + 1000)
  assert.equal((await L.getDetail(card.id)).stamps, 3)

  // --- due scansioni insieme: ne passa una sola
  const c2 = await L.createCard({ name: 'Luca Bianchi' }, 'tester')
  const both = await Promise.allSettled([L.addStamp(c2.id, 'a', {}, Date.now()), L.addStamp(c2.id, 'b', {}, Date.now())])
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await L.getDetail(c2.id)).stamps, 1)

  // --- completamento al decimo timbro, poi blocco
  let at = t0 + 25 * H
  let last
  for (let i = 4; i <= 10; i++) {
    last = await L.addStamp(card.id, 'anna', {}, at)
    at += 12 * H
  }
  assert.equal(last!.completed, true)
  assert.equal(last!.card.status, 'completata')
  await assert.rejects(L.addStamp(card.id, 'anna', {}, at + 100 * H), /già completa/)

  // --- annullamento: torna attiva e si può rimettere il timbro; lo storico conserva chi e quando
  const done = await L.getDetail(card.id)
  const lastStamp = done.history.find((s) => !s.voidedAt)!
  const voided = await L.voidStamp(card.id, lastStamp.id, 'bruno')
  assert.equal(voided.stamps, 9)
  assert.equal(voided.status, 'attiva')
  assert.equal(voided.history.find((s) => s.id === lastStamp.id)!.voidedBy, 'bruno')
  await assert.rejects(L.voidStamp(card.id, lastStamp.id, 'bruno'), /già annullato/)
  const again = await L.addStamp(card.id, 'anna', {}, at + 200 * H)
  assert.equal(again.card.status, 'completata')

  // --- pagina pubblica: solo il minimo
  const pub = await L.publicCard(token, studio)
  assert.ok(pub)
  assert.deepEqual(Object.keys(pub!).sort(), ['completedAt', 'expiresOn', 'firstName', 'lastStampAt', 'reward', 'shortCode', 'stamps', 'stampsRequired', 'status', 'studio'])
  assert.equal(pub!.firstName, 'Maria')
  assert.ok(!JSON.stringify(pub).includes('Rossi') && !JSON.stringify(pub).includes('333'))
  assert.equal(pub!.stamps, 10)

  // --- stessa risposta (null) per token sconosciuto, malformato o carta disattivata
  assert.equal(await L.publicCard(L.newToken(), studio), null)
  assert.equal(await L.publicCard('troppo-corto', studio), null)
  await L.setDisabled(card.id, true, 'anna')
  assert.equal(await L.publicCard(token, studio), null)
  await assert.rejects(L.addStamp(card.id, 'anna', { force: true }, at + 300 * H), /disattivata/)
  await L.setDisabled(card.id, false, 'anna')
  assert.ok(await L.publicCard(token, studio))

  // --- nuovo link: il vecchio non vale più
  const re = await L.regenerateLink(card.id)
  const token2 = re.url!.split('/f/')[1]
  assert.notEqual(token2, token)
  assert.equal(await L.publicCard(token, studio), null)
  assert.ok(await L.publicCard(token2, studio))

  // --- scanner: indirizzo, token o codice breve; dominio sbagliato rifiutato
  const c3 = await L.createCard({ name: 'Anna Neri' }, 'tester')
  const t3 = c3.url!.split('/f/')[1]
  await assert.rejects(L.scanStamp(`https://altro.example/f/${t3}`, 'x'), /non riconosciuto/)
  assert.equal((await L.scanStamp(`https://carte.studio.test/f/${t3}`, 'x')).card.stamps, 1)
  await assert.rejects(L.scanStamp(t3, 'x'), /già dato di recente/)
  await assert.rejects(L.scanStamp(c3.shortCode, 'x'), /già dato di recente/)
  await assert.rejects(L.scanStamp('K7QMX2PD', 'x'), /non trovata|non riconosciuto/)

  // --- elenco: ricerca per nome, telefono e codice breve
  assert.equal((await L.listCards('maria rossi', '')).length, 1)
  assert.equal((await L.listCards('rossi maria', '')).length, 1)
  assert.equal((await L.listCards('3331234', '')).length, 1)
  assert.equal((await L.listCards(c3.shortCode.toLowerCase(), '')).length, 1)
  assert.ok((await L.listCards('', 'completata')).some((c) => c.id === card.id))
  assert.equal((await L.listCards('zzzz', '')).length, 0)

  // --- validazione
  await assert.rejects(L.createCard({ name: '' }, 'x'), /obbligatorio/)
  await assert.rejects(L.createCard({ name: 'A', phone: 'abc' }, 'x'), /telefono/i)
  await assert.rejects(L.updateProgram({ name: 'x', reward: 'y', stampsRequired: 0, cooldownHours: 12 }), /Timbri richiesti/)
})
