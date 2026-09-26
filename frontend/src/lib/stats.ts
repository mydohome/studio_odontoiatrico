import { CATEGORIES } from '../../../shared/catalog.ts'
import {
  addDays,
  addMonths,
  daysInMonth,
  formatDay,
  formatMonth,
  formatWeek,
  fromISO,
  MONTHS_SHORT,
  monthKey,
  startOfWeek,
  WEEKDAYS_SHORT,
} from '../../../shared/dates.ts'
import type { CategoryId, RecordRow, Service } from '../../../shared/types.ts'

export type PeriodType = 'giorno' | 'settimana' | 'mese'

export interface Period {
  start: string
  end: string
  label: string
  short: string
}

export function periodOf(type: PeriodType, anchor: string): Period {
  if (type === 'giorno') {
    const d = fromISO(anchor)
    return { start: anchor, end: anchor, label: formatDay(anchor), short: `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}` }
  }
  if (type === 'settimana') {
    const s = startOfWeek(anchor)
    const d = fromISO(s)
    return { start: s, end: addDays(s, 6), label: formatWeek(s), short: `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` }
  }
  const ym = monthKey(anchor)
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`,
    label: formatMonth(ym),
    short: `${MONTHS_SHORT[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`,
  }
}

export function shiftAnchor(type: PeriodType, anchor: string, n: number): string {
  if (type === 'giorno') return addDays(anchor, n)
  if (type === 'settimana') return addDays(startOfWeek(anchor), 7 * n)
  return `${addMonths(monthKey(anchor), n)}-01`
}

/** Periodi consecutivi che terminano con quello dell'ancora. */
export function periodsEndingAt(type: PeriodType, anchor: string, count: number): Period[] {
  const out: Period[] = []
  for (let i = count - 1; i >= 0; i--) out.push(periodOf(type, shiftAnchor(type, anchor, -i)))
  return out
}

export interface Aggregate {
  total: number
  revenue: number
  workedDays: number
  byService: Map<string, number>
  byCategory: Map<CategoryId, number>
}

export function aggregate(records: RecordRow[], services: Service[], p: Period): Aggregate {
  const svc = new Map(services.map((s) => [s.id, s]))
  const byService = new Map<string, number>()
  const byCategory = new Map<CategoryId, number>()
  const days = new Set<string>()
  let total = 0
  let revenue = 0
  for (const r of records) {
    if (r.d < p.start || r.d > p.end) continue
    const s = svc.get(r.s)
    if (!s) continue
    total += r.q
    revenue += r.q * (s.price ?? 0)
    days.add(r.d)
    byService.set(r.s, (byService.get(r.s) ?? 0) + r.q)
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + r.q)
  }
  return { total, revenue, workedDays: days.size, byService, byCategory }
}

/** Serie per il grafico dell'andamento, una colonna per categoria. */
export function trendSeries(records: RecordRow[], services: Service[], periods: Period[]) {
  return periods.map((p) => {
    const a = aggregate(records, services, p)
    const row: Record<string, number | string> = { key: p.start, label: p.short, full: p.label, total: a.total }
    for (const c of CATEGORIES) row[c.id] = a.byCategory.get(c.id) ?? 0
    return row
  })
}

export const eur = (n: number) =>
  n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export const fmt = (n: number, digits = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: digits })

export function delta(cur: number, prev: number): number | null {
  if (!prev) return null
  return cur / prev - 1
}
