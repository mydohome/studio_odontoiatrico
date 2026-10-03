// Tutte le date sono gestite come stringhe locali YYYY-MM-DD per evitare problemi di fuso orario.

export const MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
export const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
export const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): string {
  return toISO(new Date())
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Lunedì della settimana che contiene la data. */
export function startOfWeek(iso: string): string {
  const d = fromISO(iso)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return toISO(d)
}

/** Chiave mese YYYY-MM */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthIndex(ym: string): number {
  return Number(ym.slice(5, 7)) - 1
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function formatDay(iso: string): string {
  const d = fromISO(iso)
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

export function formatMonth(ym: string): string {
  return `${MONTHS[monthIndex(ym)]} ${ym.slice(0, 4)}`
}

export function formatWeek(startIso: string): string {
  const end = addDays(startIso, 6)
  const s = fromISO(startIso)
  const e = fromISO(end)
  const sameMonth = s.getMonth() === e.getMonth()
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`
    : `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`
}

export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return toISO(fromISO(s)) === s
}

/** "Lunedì 5 ottobre 2026" */
export function formatLongDay(iso: string): string {
  const d = fromISO(iso)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`
}
