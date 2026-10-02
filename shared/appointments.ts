// Funzioni condivise per gli appuntamenti: numero WhatsApp e testo del messaggio.

import { formatLongDay } from './dates.ts'

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
 * Riepilogo dell'appuntamento per WhatsApp: *grassetto* per data e ora, link di conferma
 * personale, istruzioni per spostarlo.
 */
export function whatsAppMessage(m: MessageInput): string {
  const day = formatLongDay(m.day)
  const lines = [
    `Gentile ${m.patientName.trim()},`,
    `le ricordiamo il suo appuntamento presso *${m.studioName.trim()}*:`,
    '',
    `📅 *${day}*`,
    `🕘 *Ore ${m.time}*`,
  ]
  if (m.serviceName.trim()) lines.push(`🦷 ${m.serviceName.trim()}`)
  if (m.address.trim()) lines.push(`📍 ${m.address.trim()}`)
  lines.push('', '✅ Per confermare la sua presenza apra questo link:', m.confirmUrl, '')
  lines.push(
    m.studioPhone.trim()
      ? `Per spostare o annullare l'appuntamento risponda a questo messaggio o chiami lo ${m.studioPhone.trim()}.`
      : `Per spostare o annullare l'appuntamento risponda a questo messaggio.`,
  )
  lines.push('A presto!')
  return lines.join('\n')
}

/** Link wa.me che apre la chat con il paziente e il messaggio già scritto. */
export function whatsAppLink(phone: string, text: string): string | null {
  const n = whatsAppNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null
}
