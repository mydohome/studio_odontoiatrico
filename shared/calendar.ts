// Evento di calendario per l'appuntamento: file .ics (iPhone, Outlook, calendari Android) e link
// di Google Calendar. Gli orari sono convertiti in UTC dal fuso dello studio, così l'evento è
// corretto anche con l'ora legale e su telefoni impostati su un altro fuso.

/** Istante UTC (ms) corrispondente a giorno e ora locali nel fuso indicato (es. Europe/Rome). */
export function zonedToUtc(day: string, time: string, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  // Differenza tra l'ora "da orologio" nel fuso e l'UTC, nell'istante t.
  const offset = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t
  }
  let t = wall - offset(wall)
  t = wall - offset(t) // seconda passata: corretta anche a cavallo del cambio dell'ora
  return t
}

/** 20261002T103000Z */
export const icsStamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** Righe lunghe divise a 75 byte, come richiede il formato iCalendar (senza spezzare i caratteri). */
function fold(line: string): string {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}

export interface CalendarEvent {
  uid: string
  start: number
  end: number
  title: string
  description: string
  location: string
}

export function buildIcs(e: CalendarEvent, now = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio odontoiatrico//Appuntamenti//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(e.start)}`,
    `DTEND:${icsStamp(e.end)}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    // Promemoria il giorno prima e due ore prima.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(e.title)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(e.title)}`,
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Link "aggiungi a Google Calendar" (apre l'app su Android o il sito). */
export function googleCalendarUrl(e: Omit<CalendarEvent, 'uid'>): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsStamp(e.start)}/${icsStamp(e.end)}`,
    details: e.description,
    location: e.location,
  })
  return `https://calendar.google.com/calendar/render?${q}`
}
