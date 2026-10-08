import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmUntil, endTime, nextWorkday, whatsAppLink, whatsAppMessage, whatsAppNumber, whatsAppWebLink } from '../../shared/appointments.ts'
import { buildIcs, googleCalendarUrl, icsStamp, zonedToUtc } from '../../shared/calendar.ts'
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
  assert.match(msg, /^\*DentalCapri srl\*\nPromemoria appuntamento\n/)
  assert.match(msg, /Gentile Mario Rossi,/)
  assert.match(msg, /📅 Lunedì 5 ottobre 2026\n⏰ Ore 10:30\n📋 Igiene professionale\n📍 Via Roma 12, Capri/)
  assert.match(msg, /\nhttps:\/\/studio\.example\.it\/c\/abc\n/)
  assert.match(msg, /calendario del telefono/)
  assert.match(msg, /chiami lo 081 837 1234/)
  // Solo emoji di Unicode 6.0 (2010): nessuna icona recente che un telefono vecchio non mostrerebbe.
  const emoji = [...msg].filter((c) => /\p{Extended_Pictographic}/u.test(c))
  assert.deepEqual([...new Set(emoji)], ['📅', '⏰', '📋', '📍', '👉', '📞'])
  assert.ok(!msg.includes('🦷'))
  const link = whatsAppLink('333 1234567', msg)!
  assert.ok(link.startsWith('https://wa.me/393331234567?text='))
  assert.equal(decodeURIComponent(link.split('text=')[1]), msg)
  assert.equal(whatsAppLink('333 1234567'), 'https://wa.me/393331234567')
  assert.equal(whatsAppWebLink('333 1234567'), 'https://web.whatsapp.com/send?phone=393331234567')
  assert.ok(whatsAppWebLink('333 1234567', 'ciao')!.endsWith('&text=ciao'))
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

test('calendario: ora di Roma convertita in UTC, con ora legale e solare', () => {
  assert.equal(icsStamp(zonedToUtc('2026-10-02', '10:30', 'Europe/Rome')), '20261002T083000Z') // legale, +2
  assert.equal(icsStamp(zonedToUtc('2026-12-15', '10:30', 'Europe/Rome')), '20261215T093000Z') // solare, +1
  // Giorno del cambio d'ora (25 ottobre 2026, alle 3 si torna alle 2).
  assert.equal(icsStamp(zonedToUtc('2026-10-25', '09:00', 'Europe/Rome')), '20261025T080000Z')
  assert.equal(icsStamp(zonedToUtc('2026-03-29', '09:00', 'Europe/Rome')), '20260329T070000Z')
})

test('calendario: file .ics valido, con testi protetti e righe divise', () => {
  const start = zonedToUtc('2026-10-02', '10:30', 'Europe/Rome')
  const ics = buildIcs(
    {
      uid: 'abc@studio',
      start,
      end: start + 30 * 60_000,
      title: 'Appuntamento - Studio Rossi, Bianchi; & C.',
      description: 'Igiene orale\nPer spostare o annullare: 081 837 1234',
      location: 'Via Roma 12, 80073 Capri (NA) — scala B, secondo piano, citofono "Studio dentistico Rossi"',
    },
    Date.UTC(2026, 9, 1, 12),
  )
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.match(ics, /\r\nDTSTART:20261002T083000Z\r\nDTEND:20261002T090000Z\r\n/)
  assert.match(ics, /SUMMARY:Appuntamento - Studio Rossi\\, Bianchi\\; & C\./)
  assert.match(ics, /DESCRIPTION:Igiene orale\\nPer spostare/)
  assert.match(ics, /TRIGGER:-P1D/)
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
  // Le righe divise si ricompongono nel testo originale.
  const unfolded = ics.replace(/\r\n /g, '')
  assert.match(unfolded, /LOCATION:Via Roma 12\\, 80073 Capri \(NA\) — scala B\\, secondo piano\\, citofono "Studio dentistico Rossi"\r\n/)
})

test('calendario: link di Google Calendar', () => {
  const start = zonedToUtc('2026-10-02', '10:30', 'Europe/Rome')
  const url = new URL(googleCalendarUrl({ start, end: start + 1800_000, title: 'Appuntamento', description: 'x', location: 'Capri' }))
  assert.equal(url.hostname, 'calendar.google.com')
  assert.equal(url.searchParams.get('dates'), '20261002T083000Z/20261002T090000Z')
  assert.equal(url.searchParams.get('action'), 'TEMPLATE')
})

const msgInput = {
  studioName: 'Studio Dentistico Sorriso',
  studioPhone: '02 1234567',
  address: 'Via Roma 1, 20100 Milano',
  patientName: 'Mario Rossi',
  day: '2026-10-05',
  time: '12:30',
  serviceName: 'Visita di controllo',
  confirmUrl: 'https://studio.esempio.it/c/abc',
}

test('messaggio senza icone: solo lettere (anche accentate) e asterischi', () => {
  const msg = whatsAppMessage({ ...msgInput, day: '2026-10-02' }, { icons: false })
  assert.match(msg, /^\*Studio Dentistico Sorriso\* - Promemoria appuntamento\n/)
  assert.match(msg, /\*Data:\* Venerdì 2 ottobre 2026\n\*Ora:\* 12:30\n\*Prestazione:\* Visita di controllo\n\*Indirizzo:\* Via Roma 1, 20100 Milano/)
  // Niente caratteri oltre il Latin-1: arrivano intatti anche dal computer.
  for (const c of msg) assert.ok(c.codePointAt(0)! <= 0xff, `carattere ${c} (U+${c.codePointAt(0)!.toString(16)})`)
})

test('sollecito: "di domani", "di oggi" o il giorno', () => {
  const r = (day: string) => whatsAppMessage({ ...msgInput, day }, { reminder: true, today: '2026-10-02' })
  assert.match(r('2026-10-03'), /non abbiamo ancora ricevuto la conferma del suo appuntamento di domani:/)
  assert.match(r('2026-10-02'), /appuntamento di oggi:/)
  assert.match(r('2026-10-05'), /appuntamento di lunedì 5 ottobre:/)
  assert.match(r('2026-10-05'), /\*La preghiamo di confermare\* da questo link:/)
  assert.match(r('2026-10-05'), /^\*Studio Dentistico Sorriso\*\nConferma appuntamento\n/)
})

test('prossimo giorno lavorativo: il venerdì e il fine settimana portano al lunedì', () => {
  assert.equal(nextWorkday('2026-10-01'), '2026-10-02') // giovedì → venerdì
  assert.equal(nextWorkday('2026-10-02'), '2026-10-05') // venerdì → lunedì
  assert.equal(nextWorkday('2026-10-03'), '2026-10-05') // sabato → lunedì
  assert.equal(nextWorkday('2026-10-04'), '2026-10-05') // domenica → lunedì
})

test('Da confermare: oggi più i 2 giorni lavorativi successivi', () => {
  assert.equal(confirmUntil('2026-10-05'), '2026-10-07') // lunedì → mercoledì
  assert.equal(confirmUntil('2026-10-01'), '2026-10-05') // giovedì → lunedì
  assert.equal(confirmUntil('2026-10-02'), '2026-10-06') // venerdì → martedì
  assert.equal(confirmUntil('2026-10-03'), '2026-10-06') // sabato → martedì
})

test('medico dell\'appuntamento: facoltativo e numerico', () => {
  const base = { day: '2026-10-06', time: '09:00', duration: 30, patientName: 'Mario Rossi', patientPhone: '333 1234567' }
  assert.equal(parseAppointment(base).doctorId, null)
  assert.equal(parseAppointment({ ...base, doctorId: '' }).doctorId, null)
  assert.equal(parseAppointment({ ...base, doctorId: 2 }).doctorId, 2)
  assert.equal(parseAppointment({ ...base, doctorId: '3' }).doctorId, 3)
  assert.throws(() => parseAppointment({ ...base, doctorId: 'x' }), /Medico non valido/)
  assert.throws(() => parseAppointment({ ...base, doctorId: 1.5 }), /Medico non valido/)
})
