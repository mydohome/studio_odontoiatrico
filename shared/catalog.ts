import type { CategoryId, Service } from './types.ts'

export interface CategoryInfo {
  id: CategoryId
  label: string
  /** Variabile CSS del colore (ordine categoriale fisso). */
  color: string
}

// L'ordine definisce lo slot colore: non riordinare.
export const CATEGORIES: CategoryInfo[] = [
  { id: 'prevenzione', label: 'Prevenzione e igiene', color: 'var(--series-1)' },
  { id: 'diagnostica', label: 'Diagnostica', color: 'var(--series-2)' },
  { id: 'conservativa', label: 'Conservativa ed endodonzia', color: 'var(--series-3)' },
  { id: 'estetica', label: 'Estetica', color: 'var(--series-4)' },
  { id: 'ortodonzia', label: 'Ortodonzia', color: 'var(--series-5)' },
  { id: 'chirurgia', label: 'Chirurgia e implantologia', color: 'var(--series-6)' },
  { id: 'protesi', label: 'Protesi', color: 'var(--series-7)' },
  { id: 'pedodonzia', label: 'Pedodonzia', color: 'var(--series-8)' },
]

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryInfo>

export const DEFAULT_SERVICES: Service[] = [
  { id: 'igiene', name: 'Igiene orale', category: 'prevenzione', price: 80, active: true, sort: 1 },
  { id: 'visita-controllo', name: 'Visita di controllo', category: 'prevenzione', price: 50, active: true, sort: 2 },
  { id: 'prima-visita', name: 'Prima visita', category: 'prevenzione', price: 60, active: true, sort: 3 },
  { id: 'ortopanoramica', name: 'Ortopanoramica', category: 'diagnostica', price: 50, active: true, sort: 4 },
  { id: 'rx-endorale', name: 'RX endorale', category: 'diagnostica', price: 20, active: true, sort: 5 },
  { id: 'tac-cone-beam', name: 'TAC Cone Beam', category: 'diagnostica', price: 120, active: true, sort: 6 },
  { id: 'otturazione', name: 'Otturazione', category: 'conservativa', price: 110, active: true, sort: 7 },
  { id: 'devitalizzazione', name: 'Devitalizzazione', category: 'conservativa', price: 300, active: true, sort: 8 },
  { id: 'sbiancamento', name: 'Sbiancamento', category: 'estetica', price: 300, active: true, sort: 9 },
  { id: 'faccette', name: 'Faccette estetiche', category: 'estetica', price: 600, active: true, sort: 10 },
  { id: 'apparecchio-fisso', name: 'Apparecchio ortodontico fisso', category: 'ortodonzia', price: 1500, active: true, sort: 11 },
  { id: 'allineatori', name: 'Allineatori trasparenti', category: 'ortodonzia', price: 2500, active: true, sort: 12 },
  { id: 'estrazione', name: 'Estrazione', category: 'chirurgia', price: 120, active: true, sort: 13 },
  { id: 'impianto', name: 'Impianto', category: 'chirurgia', price: 1200, active: true, sort: 14 },
  { id: 'corona', name: 'Corona / capsula', category: 'protesi', price: 700, active: true, sort: 15 },
  { id: 'protesi-mobile', name: 'Protesi mobile', category: 'protesi', price: 1000, active: true, sort: 16 },
  { id: 'sigillature', name: 'Sigillature', category: 'pedodonzia', price: 30, active: true, sort: 17 },
  { id: 'visita-pedodontica', name: 'Visita pedodontica', category: 'pedodonzia', price: 40, active: true, sort: 18 },
]
