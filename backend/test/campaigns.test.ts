import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SERVICES } from '../../shared/catalog.ts'
import { addDays } from '../../shared/dates.ts'
import type { RecordRow } from '../../shared/types.ts'
import { buildCampaigns } from '../src/campaigns.ts'
import { parseDateCell } from '../src/excel.ts'

const services = DEFAULT_SERVICES

/** Genera righe giornaliere deterministiche; qty(serviceId, date) restituisce la quantità. */
function rows(from: string, to: string, qty: (s: string, d: string) => number): RecordRow[] {
  const out: RecordRow[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const s of services) {
      const q = qty(s.id, d)
      if (q > 0) out.push({ d, s: s.id, q })
    }
  }
  return out
}

test('senza dati: solo campagne di calendario, affidabilità nulla', () => {
  const r = buildCampaigns(services, [], '2026-09-15', 12)
  assert.equal(r.confidence, 'nessuna')
  assert.equal(r.months.length, 12)
  assert.equal(r.months[0].month, '2026-09')
  for (const m of r.months) {
    assert.ok(m.campaigns.length >= 1)
    assert.ok(m.campaigns.every((c) => c.type === 'calendario'))
  }
})

test('rileva un calo reale rispetto all\'anno precedente', () => {
  // Volume costante, ma negli ultimi 3 mesi l'implantologia crolla.
  const data = rows('2024-06-01', '2026-08-31', (s, d) => {
    if (s === 'impianto') return d >= '2026-06-01' ? 1 : 3
    return s === 'igiene' ? 4 : 1
  })
  const r = buildCampaigns(services, data, '2026-09-10', 3)
  const trend = r.months[0].campaigns.find((c) => c.type === 'trend' && c.category === 'chirurgia')
  assert.ok(trend, 'attesa una campagna di riattivazione per la chirurgia')
})

test('nessun falso trend con dati stabili', () => {
  const data = rows('2024-06-01', '2026-08-31', () => 2)
  const r = buildCampaigns(services, data, '2026-09-10', 12)
  assert.equal(r.confidence, 'alta')
  for (const m of r.months) assert.ok(!m.campaigns.some((c) => c.type === 'trend' || c.type === 'conversione'))
})

test('mese di chiusura: non tutte le categorie risultano "in calo"', () => {
  // Agosto con attività ridotta al 30% per tutte le categorie.
  const data = rows('2024-01-01', '2026-08-31', (s, d) => {
    const base = s === 'igiene' ? 5 : 2
    return d.slice(5, 7) === '08' ? Math.round(base * 0.3) : base
  })
  const r = buildCampaigns(services, data, '2026-09-10', 12)
  const aug = r.months.find((m) => m.month === '2027-08')!
  assert.ok(aug.activity < 0.85)
  assert.ok(!aug.campaigns.some((c) => c.type === 'calo' && c.score >= 90))
})

test('picco stagionale genera cross-selling', () => {
  // Pedodonzia raddoppia a settembre.
  const data = rows('2024-01-01', '2026-08-31', (s, d) => {
    if (s === 'visita-pedodontica') return d.slice(5, 7) === '09' ? 4 : 1
    return 2
  })
  const r = buildCampaigns(services, data, '2026-08-10', 2)
  const sep = r.months[1]
  assert.equal(sep.month, '2026-09')
  assert.ok(sep.campaigns.some((c) => c.type === 'crosssell'))
})

test('parseDateCell interpreta i formati comuni', () => {
  assert.equal(parseDateCell('15/03/2026'), '2026-03-15')
  assert.equal(parseDateCell('5.3.26'), '2026-03-05')
  assert.equal(parseDateCell('2026-03-15'), '2026-03-15')
  assert.equal(parseDateCell(new Date(Date.UTC(2026, 2, 15))), '2026-03-15')
  assert.equal(parseDateCell(46096), '2026-03-15')
  assert.equal(parseDateCell('31/02/2026'), null)
  assert.equal(parseDateCell('ciao'), null)
})
