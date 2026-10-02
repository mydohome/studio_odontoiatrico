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
  /** Colore del badge negli appuntamenti (#rrggbb); vuoto = colore della categoria. */
  color?: string | null
}

/** Riga compatta: data, id prestazione, quantità. */
export interface RecordRow {
  d: string
  s: string
  q: number
  /** Di cui da appuntamenti confermati (solo nelle statistiche, non nelle registrazioni a mano). */
  a?: number
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

/** Stato della conferma di un appuntamento. */
export type AppointmentStatus = 'da-inviare' | 'inviato' | 'confermato-link' | 'confermato-manuale' | 'da-riprogrammare'

export interface Appointment {
  id: number
  /** Giorno (YYYY-MM-DD) e ora di inizio (HH:MM), ora locale dello studio. Vuoti se da riprogrammare. */
  day: string | null
  time: string | null
  /** Durata in minuti. */
  duration: number
  patientName: string
  patientPhone: string
  serviceId: string | null
  /** Nome della prestazione (resta anche se la prestazione viene eliminata dall'elenco). */
  serviceName: string
  /** Categoria e colore del badge della prestazione (null se non specificata o eliminata). */
  serviceCategory: string | null
  serviceColor: string | null
  /** Da riprogrammare: data e ora che aveva e da quando aspetta una nuova data. */
  prevDay: string | null
  prevTime: string | null
  rescheduleAt: string | null
  notes: string
  /** Codice segreto del link di conferma. */
  token: string
  status: AppointmentStatus
  sentAt: string | null
  /** Quante volte è stato preparato il messaggio (primo invio e solleciti) e quando l'ultima. */
  sendCount: number
  lastSentAt: string | null
  /** Chiamate senza risposta. */
  callCount: number
  lastCallAt: string | null
  confirmedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type AppointmentInput = Pick<Appointment, 'duration' | 'patientName' | 'patientPhone' | 'serviceId' | 'notes'> & { day: string; time: string }

/** Appuntamento con data e ora (tutti tranne quelli da riprogrammare). */
export type ScheduledAppointment = Appointment & { day: string; time: string }

/** Dati visibili al paziente nella pagina di conferma (link senza accesso). */
export interface PublicAppointment {
  studio: { name: string; phone: string; address: string; logoType: string; logoVersion: number; flyerStyle: 'smile' | 'mint' }
  /** Solo il nome di battesimo del paziente. */
  firstName: string
  day: string
  time: string
  duration: number
  serviceName: string
  confirmed: boolean
  confirmedAt: string | null
  /** Appuntamento già passato: non si può più confermare. */
  past: boolean
  /** Fuso orario dello studio (es. Europe/Rome), per l'evento di calendario. */
  timeZone: string
}
