import type { CategoryId, Service } from './types.ts'

/** Categoria delle prestazioni: modificabile dallo studio in Impostazioni. */
export interface Category {
  id: CategoryId
  label: string
  /** Colore del badge delle prestazioni negli appuntamenti (#rrggbb). */
  badge: string
  /** Posizione nella tavolozza dei grafici (1–8): resta fissa anche se la categoria cambia nome o posto. */
  slot: number
  sort: number
}

export interface CategoryInfo extends Category {
  /** Variabile CSS del colore nei grafici. */
  color: string
}

/** Colori dei grafici disponibili (--series-1 … --series-8). */
export const SERIES_SLOTS = 8

/**
 * Categorie iniziali. Per queste esistono testi pronti di campagne e volantini (scelti dall'id, quindi
 * validi anche se la categoria viene rinominata); le categorie aggiunte dallo studio usano testi generici.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'prevenzione', label: 'Prevenzione e igiene', badge: '#0e7490', slot: 1, sort: 1 },
  { id: 'diagnostica', label: 'Diagnostica', badge: '#4b5563', slot: 2, sort: 2 },
  { id: 'conservativa', label: 'Conservativa ed endodonzia', badge: '#1d4ed8', slot: 3, sort: 3 },
  { id: 'estetica', label: 'Estetica', badge: '#a16207', slot: 4, sort: 4 },
  { id: 'ortodonzia', label: 'Ortodonzia', badge: '#c0168c', slot: 5, sort: 5 },
  { id: 'chirurgia', label: 'Chirurgia e implantologia', badge: '#b91c1c', slot: 6, sort: 6 },
  { id: 'protesi', label: 'Protesi', badge: '#4d7c0f', slot: 7, sort: 7 },
  { id: 'pedodonzia', label: 'Pedodonzia', badge: '#c2410c', slot: 8, sort: 8 },
]

/**
 * Categorie in uso, nell'ordine scelto dallo studio. Sono un elenco condiviso aggiornato con
 * setCategories (dal server all'avvio e dopo ogni modifica, dal browser a ogni caricamento dei dati):
 * così tutte le schede e i calcoli leggono le stesse categorie senza doverle passare ovunque.
 */
export const CATEGORIES: CategoryInfo[] = []
export const CATEGORY_BY_ID: Record<CategoryId, CategoryInfo> = {}

export function setCategories(list: Category[]): void {
  const sorted = [...list].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  CATEGORIES.splice(0, CATEGORIES.length, ...sorted.map((c) => ({ ...c, color: `var(--series-${((c.slot - 1) % SERIES_SLOTS) + 1})` })))
  for (const k of Object.keys(CATEGORY_BY_ID)) delete CATEGORY_BY_ID[k]
  for (const c of CATEGORIES) CATEGORY_BY_ID[c.id] = c
}

setCategories(DEFAULT_CATEGORIES)

/** Dati della categoria; per un id sconosciuto (mai atteso) una categoria neutra, invece di un errore. */
export function categoryInfo(id: CategoryId): CategoryInfo {
  return CATEGORY_BY_ID[id] ?? { id, label: 'Senza categoria', badge: '#6b7280', slot: 0, sort: 0, color: 'var(--text-3)' }
}

/** Colore del badge: quello della prestazione, altrimenti quello della sua categoria. */
export function badgeColor(category: string | null | undefined, color?: string | null): string {
  return color || (category && CATEGORY_BY_ID[category]?.badge) || '#6b7280'
}

/** Colore dei grafici per una nuova categoria: il meno usato (a parità, il primo). */
export function freeSlot(list: Pick<Category, 'slot'>[]): number {
  const used = Array<number>(SERIES_SLOTS).fill(0)
  for (const c of list) if (c.slot >= 1 && c.slot <= SERIES_SLOTS) used[c.slot - 1]++
  return used.indexOf(Math.min(...used)) + 1
}

export const DEFAULT_SERVICES: Service[] = [
  { id: 'igiene', name: 'Igiene orale', category: 'prevenzione', price: 80, active: true, sort: 1, color: '#166534' },
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
