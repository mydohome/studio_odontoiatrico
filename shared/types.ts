export type CategoryId =
  | 'prevenzione'
  | 'diagnostica'
  | 'conservativa'
  | 'estetica'
  | 'ortodonzia'
  | 'chirurgia'
  | 'protesi'
  | 'pedodonzia'

export interface Service {
  id: string
  name: string
  category: CategoryId
  /** Prezzo medio indicativo, usato per stimare il fatturato (opzionale). */
  price: number | null
  active: boolean
  sort: number
}

/** Riga compatta: data, id prestazione, quantità. */
export interface RecordRow {
  d: string
  s: string
  q: number
}

export type CampaignType = 'calo' | 'richiamo' | 'conversione' | 'trend' | 'crosssell' | 'calendario' | 'personalizzata'

export interface CampaignSuggestion {
  id: string
  type: CampaignType
  category: CategoryId
  title: string
  offer: string
  target: string
  channels: string[]
  /** Punteggio di convenienza 0–100. */
  score: number
  reasons: string[]
}

export interface CategoryForecast {
  category: CategoryId
  /** Volume atteso nel mese. */
  expected: number
  /** Media mensile storica (destagionalizzata). */
  average: number
  /** Indice stagionale del mese (1 = mese medio). */
  index: number
}

export interface MonthPlan {
  month: string
  /** Attività complessiva attesa dello studio (1 = mese medio, <0.85 = chiusure/ferie). */
  activity: number
  campaigns: CampaignSuggestion[]
  forecast: CategoryForecast[]
}

export interface CampaignResponse {
  generatedAt: string
  historyMonths: number
  confidence: 'nessuna' | 'bassa' | 'media' | 'alta'
  months: MonthPlan[]
  seasonality: { category: CategoryId; index: number[]; observations: number[] }[]
}

export interface ImportResult {
  rows: number
  days: number
  imported: number
  errors: string[]
}

/** Campagna creata dall'utente (non generata dall'algoritmo). */
export interface CustomCampaign {
  id: number
  category: CategoryId
  title: string
  offer: string
  target: string
  channels: string[]
  /** Periodo della campagna (YYYY-MM-DD), anche su più mesi. */
  dateFrom: string
  dateTo: string
  notes: string
  /** Testi del volantino salvati dall'editor (struttura del frontend). */
  flyer: Record<string, unknown> | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type CustomCampaignInput = Pick<
  CustomCampaign,
  'category' | 'title' | 'offer' | 'target' | 'channels' | 'dateFrom' | 'dateTo' | 'notes'
>
