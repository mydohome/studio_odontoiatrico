import { addDays, fromISO } from '../../shared/dates.ts'
import type { CategoryId, Service } from '../../shared/types.ts'

// Stagionalità indicativa (moltiplicatori per mese) usata solo per i dati dimostrativi.
const SEASON: Record<CategoryId, number[]> = {
  prevenzione: [1.2, 1.1, 1.0, 1.0, 1.0, 1.1, 0.9, 0.4, 1.2, 1.3, 1.1, 0.8],
  diagnostica: [1.1, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.4, 1.1, 1.2, 1.1, 0.8],
  conservativa: [1.0, 1.1, 1.1, 1.0, 1.0, 0.9, 0.8, 0.5, 1.0, 1.1, 1.2, 1.0],
  estetica: [0.7, 1.0, 1.1, 1.3, 1.5, 1.4, 1.0, 0.5, 0.8, 0.8, 0.8, 1.2],
  ortodonzia: [0.9, 0.9, 0.9, 1.0, 1.0, 1.3, 1.3, 0.8, 1.4, 1.1, 0.9, 0.7],
  chirurgia: [1.2, 1.1, 1.0, 1.0, 0.9, 0.8, 0.7, 0.3, 1.0, 1.1, 1.2, 1.1],
  protesi: [1.1, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7, 0.3, 1.0, 1.1, 1.3, 1.2],
  pedodonzia: [0.9, 0.9, 0.9, 0.9, 0.9, 1.2, 1.1, 0.4, 1.6, 1.3, 1.0, 0.8],
}

// Media giornaliera per prestazione (giornata piena).
const BASE: Record<string, number> = {
  igiene: 5, 'visita-controllo': 4, 'prima-visita': 1.2, ortopanoramica: 1.5, 'rx-endorale': 2.5,
  'tac-cone-beam': 0.3, otturazione: 3, devitalizzazione: 0.8, sbiancamento: 0.5, faccette: 0.15,
  'apparecchio-fisso': 0.2, allineatori: 0.25, estrazione: 0.9, impianto: 0.4, corona: 0.5,
  'protesi-mobile': 0.15, sigillature: 0.8, 'visita-pedodontica': 0.9,
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

/** Campiona da una Poisson con media lambda (Knuth). */
function poisson(lambda: number, rand: () => number) {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > L)
  return k - 1
}

export function generateDemo(services: Service[], from: string, to: string) {
  const rand = rng(42)
  const days = new Map<string, Map<string, number>>()
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const date = fromISO(d)
    const dow = date.getDay()
    const month = date.getMonth()
    if (dow === 0) continue
    if (month === 7 && date.getDate() >= 8 && date.getDate() <= 23) continue // chiusura estiva
    if (month === 11 && date.getDate() >= 24 && date.getDate() <= 31) continue // festività
    const dayFactor = dow === 6 ? 0.4 : 1
    const items = new Map<string, number>()
    for (const s of services) {
      const base = BASE[s.id] ?? 0.5
      const q = poisson(base * dayFactor * SEASON[s.category][month], rand)
      if (q > 0) items.set(s.id, q)
    }
    days.set(d, items)
  }
  return days
}
