// Funzioni condivise per gli appuntamenti: numero WhatsApp e testo del messaggio.

import { addDays, formatLongDay } from './dates.ts'

/** Giorni dopo l'appuntamento in cui il link di conferma funziona ancora; poi non mostra più nulla. */
export const LINK_DAYS_AFTER = 3

/** Ultimo giorno di validità del link di un appuntamento (YYYY-MM-DD). */
export const linkExpiry = (day: string) => addDays(day, LINK_DAYS_AFTER)

/**
 * Numero nel formato richiesto da wa.me (solo cifre, con prefisso internazionale).
 * Senza prefisso si assume l'Italia (+39). Restituisce null se il numero non è utilizzabile.
 */
export function whatsAppNumber(phone: string, countryCode = '39'): string | null {
  let p = phone.trim().replace(/[\s./()-]/g, '')
  if (!/^\+?\d+$/.test(p)) return null
  if (p.startsWith('+')) p = p.slice(1)
  else if (p.startsWith('00')) p = p.slice(2)
  else if (!(p.startsWith(countryCode) && p.length > 10)) p = countryCode + p
  return p.length >= 8 && p.length <= 15 ? p : null
}

/** Ora di fine "HH:MM" dato inizio e durata in minuti. */
export function endTime(time: string, duration: number): string {
  const [h, m] = time.split(':').map(Number)
  const t = Math.min(24 * 60 - 1, h * 60 + m + duration)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface MessageInput {
  studioName: string
  studioPhone: string
  address: string
  patientName: string
  day: string
  time: string
  serviceName: string
  confirmUrl: string
}

/**
 * Riepilogo dell'appuntamento per WhatsApp. Le icone sono solo emoji del 2010 (Unicode 6.0),
 * presenti su qualsiasi telefono; *grassetto* solo per il nome dello studio e per la richiesta
 * di conferma, così il messaggio resta pulito anche dove WhatsApp sottolinea date e numeri.
 */
export function whatsAppMessage(m: MessageInput): string {
  const lines = [
    `*${m.studioName.trim()}*`,
    'Promemoria appuntamento',
    '',
    `Gentile ${m.patientName.trim()},`,
    'le ricordiamo il suo prossimo appuntamento:',
    '',
    `📅 ${formatLongDay(m.day)}`,
    `⏰ Ore ${m.time}`,
  ]
  if (m.serviceName.trim()) lines.push(`📋 ${m.serviceName.trim()}`)
  if (m.address.trim()) lines.push(`📍 ${m.address.trim()}`)
  lines.push(
    '',
    '👉 *Confermi la sua presenza* da questo link:',
    m.confirmUrl,
    "Dalla stessa pagina può aggiungere l'appuntamento al calendario del telefono.",
    '',
    m.studioPhone.trim()
      ? `📞 Per spostarlo o annullarlo risponda a questo messaggio o chiami lo ${m.studioPhone.trim()}.`
      : '📞 Per spostarlo o annullarlo risponda a questo messaggio.',
    '',
    'A presto!',
  )
  return lines.join('\n')
}

/** Link wa.me che apre la chat con il paziente e il messaggio già scritto (telefoni e app). */
export function whatsAppLink(phone: string, text: string): string | null {
  const n = whatsAppNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null
}

/**
 * Chat con il paziente senza testo. Dal computer WhatsApp (app e Web) sostituisce con «�» le emoji
 * del messaggio passato nel link: il messaggio si incolla dagli appunti, dove resta intatto.
 */
export function whatsAppChatLink(phone: string): string | null {
  const n = whatsAppNumber(phone)
  return n ? `https://wa.me/${n}` : null
}

/** Stessa chat, vuota, in WhatsApp Web (anche lì il messaggio si incolla dagli appunti). */
export function whatsAppWebChatLink(phone: string): string | null {
  const n = whatsAppNumber(phone)
  return n ? `https://web.whatsapp.com/send?phone=${n}` : null
}

/** Titolo, descrizione e luogo dell'evento di calendario dell'appuntamento. */
export function appointmentEventText(m: { studioName: string; studioPhone: string; address: string; serviceName: string }) {
  const description = [
    m.serviceName.trim(),
    m.studioPhone.trim() ? `Per spostare o annullare: ${m.studioPhone.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return { title: `Appuntamento - ${m.studioName.trim()}`, description, location: m.address.trim() }
}
