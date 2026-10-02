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

export interface MessageOptions {
  /**
   * Con le icone (emoji del 2010, presenti su qualsiasi telefono). Senza icone il messaggio usa
   * solo lettere, anche accentate, e asterischi: arriva intatto anche quando WhatsApp per computer
   * riceve il testo già scritto dal link (con le icone le sostituirebbe con «�»).
   */
  icons?: boolean
  /** Sollecito: la conferma non è ancora arrivata. */
  reminder?: boolean
  /** Giorno di oggi (YYYY-MM-DD), per scrivere "di oggi" / "di domani" nel sollecito. */
  today?: string
}

/** "di oggi", "di domani" oppure "di lunedì 5 ottobre". */
function whenWords(day: string, today?: string): string {
  if (today && day === today) return 'di oggi'
  if (today && day === addDays(today, 1)) return 'di domani'
  const long = formatLongDay(day)
  return `di ${long.charAt(0).toLowerCase()}${long.slice(1).replace(/ \d{4}$/, '')}`
}

/** Riepilogo dell'appuntamento per WhatsApp, con o senza icone, primo invio o sollecito. */
export function whatsAppMessage(m: MessageInput, opt: MessageOptions = {}): string {
  const icons = opt.icons ?? true
  const studio = m.studioName.trim()
  const lines = icons ? [`*${studio}*`, opt.reminder ? 'Conferma appuntamento' : 'Promemoria appuntamento'] : [`*${studio}* - ${opt.reminder ? 'Conferma appuntamento' : 'Promemoria appuntamento'}`]
  lines.push('', `Gentile ${m.patientName.trim()},`)
  lines.push(
    opt.reminder
      ? `non abbiamo ancora ricevuto la conferma del suo appuntamento ${whenWords(m.day, opt.today)}:`
      : 'le ricordiamo il suo prossimo appuntamento:',
    '',
  )
  const row = (icon: string, label: string, value: string) => lines.push(icons ? `${icon} ${value}` : `*${label}:* ${value}`)
  row('📅', 'Data', formatLongDay(m.day))
  row('⏰', 'Ora', icons ? `Ore ${m.time}` : m.time)
  if (m.serviceName.trim()) row('📋', 'Prestazione', m.serviceName.trim())
  if (m.address.trim()) row('📍', 'Indirizzo', m.address.trim())
  lines.push(
    '',
    `${icons ? '👉 ' : ''}*${opt.reminder ? 'La preghiamo di confermare' : 'Confermi la sua presenza'}* da questo link:`,
    m.confirmUrl,
    "Dalla stessa pagina può aggiungere l'appuntamento al calendario del telefono.",
    '',
    `${icons ? '📞 ' : ''}${
      m.studioPhone.trim()
        ? `Per spostarlo o annullarlo risponda a questo messaggio o chiami lo ${m.studioPhone.trim()}.`
        : 'Per spostarlo o annullarlo risponda a questo messaggio.'
    }`,
    '',
    opt.reminder ? 'Grazie, a presto!' : 'A presto!',
  )
  return lines.join('\n')
}

/**
 * Prossimo giorno lavorativo dopo `day` (sabato e domenica esclusi): il venerdì è il lunedì.
 * Serve a capire quali appuntamenti vanno confermati per tempo.
 */
export function nextWorkday(day: string): string {
  let d = addDays(day, 1)
  for (;;) {
    const [y, mo, dd] = d.split('-').map(Number)
    const dow = new Date(y, mo - 1, dd).getDay()
    if (dow !== 0 && dow !== 6) return d
    d = addDays(d, 1)
  }
}

/**
 * Chat con il paziente su wa.me (app sul telefono o sul computer), con il messaggio già scritto
 * se `text` è indicato. Attenzione: da computer WhatsApp sostituisce con «�» le emoji del testo
 * ricevuto dal link, per cui lì si usa il messaggio senza icone oppure lo si incolla.
 */
export function whatsAppLink(phone: string, text?: string): string | null {
  const n = whatsAppNumber(phone)
  if (!n) return null
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`
}

/** Stessa chat in WhatsApp Web. */
export function whatsAppWebLink(phone: string, text?: string): string | null {
  const n = whatsAppNumber(phone)
  if (!n) return null
  return `https://web.whatsapp.com/send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ''}`
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
