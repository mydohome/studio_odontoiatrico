import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endTime, whatsAppLink, whatsAppMessage, whatsAppNumber } from '../../shared/appointments.ts'
import { AppointmentError, newToken, parseAppointment, TOKEN_RE } from '../src/appointments.ts'

const base = { day: '2026-10-05', time: '10:30', duration: 30, patientName: '  Mario   Rossi ', patientPhone: '333 123 4567' }

test('appuntamento: normalizza i campi validi', () => {
  const a = parseAppointment({ ...base, serviceId: '', notes: '  allergico\nalla penicillina ' })
  assert.equal(a.patientName, 'Mario Rossi')
  assert.equal(a.serviceId, null)
  assert.equal(a.notes, 'allergico\nalla penicillina')
  assert.equal(parseAppointment({ ...base, duration: undefined }).duration, 30)
})

test('appuntamento: rifiuta dati non validi', () => {
  const bad = [
    { ...base, day: '2026-02-30' },
    { ...base, time: '24:00' },
    { ...base, time: '9:30' },
    { ...base, duration: 0 },
    { ...base, duration: 15.5 },
    { ...base, patientName: '  ' },
    { ...base, patientPhone: 'chiamare' },
    { ...base, patientPhone: '12' },
    { ...base, notes: 'x'.repeat(1001) },
  ]
  for (const b of bad) assert.throws(() => parseAppointment(b), AppointmentError, JSON.stringify(b))
})

test('link di conferma: codice casuale di 24 caratteri sicuri negli URL', () => {
  const a = newToken()
  assert.match(a, TOKEN_RE)
  assert.notEqual(a, newToken())
})

test('numero WhatsApp: prefisso italiano quando manca', () => {
  assert.equal(whatsAppNumber('333 123 4567'), '393331234567')
  assert.equal(whatsAppNumber('+39 333 123 4567'), '393331234567')
  assert.equal(whatsAppNumber('0039 333.123.4567'), '393331234567')
  assert.equal(whatsAppNumber('393331234567'), '393331234567')
  // Cellulare TIM che inizia per 393: senza prefisso è comunque italiano.
  assert.equal(whatsAppNumber('393 1234567'), '393931234567')
  assert.equal(whatsAppNumber('081 837 1234'), '390818371234')
  assert.equal(whatsAppNumber('+44 7700 900123'), '447700900123')
  assert.equal(whatsAppNumber('chiama'), null)
  assert.equal(whatsAppNumber('12'), null)
})

test('messaggio WhatsApp: riepilogo con data, ora, prestazione e link', () => {
  const msg = whatsAppMessage({
    studioName: 'DentalCapri srl',
    studioPhone: '081 837 1234',
    address: 'Via Roma 12, Capri',
    patientName: 'Mario Rossi',
    day: '2026-10-05',
    time: '10:30',
    serviceName: 'Igiene professionale',
    confirmUrl: 'https://studio.example.it/c/abc',
  })
  assert.match(msg, /^Gentile Mario Rossi,/)
  assert.match(msg, /\*DentalCapri srl\*/)
  assert.match(msg, /\*Lunedì 5 ottobre 2026\*/)
  assert.match(msg, /\*Ore 10:30\*/)
  assert.match(msg, /Igiene professionale/)
  assert.match(msg, /\nhttps:\/\/studio\.example\.it\/c\/abc\n/)
  assert.match(msg, /chiami lo 081 837 1234/)
  const link = whatsAppLink('333 1234567', msg)!
  assert.ok(link.startsWith('https://wa.me/393331234567?text='))
  assert.equal(decodeURIComponent(link.split('text=')[1]), msg)
})

test('ora di fine', () => {
  assert.equal(endTime('10:30', 45), '11:15')
  assert.equal(endTime('23:50', 30), '23:59')
})

test('link di conferma: valido fino a 3 giorni dopo l\'appuntamento', async () => {
  const { linkExpiry, LINK_DAYS_AFTER } = await import('../../shared/appointments.ts')
  assert.equal(LINK_DAYS_AFTER, 3)
  assert.equal(linkExpiry('2026-10-30'), '2026-11-02')
})
