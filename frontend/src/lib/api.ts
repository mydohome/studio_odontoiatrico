import type {
  CampaignResponse,
  CustomCampaign,
  CustomCampaignInput,
  ImportResult,
  RecordRow,
  Service,
} from '../../../shared/types.ts'

export interface AppSettings {
  studioName: string
  /** Mostra prezzi e fatturato stimato nelle viste. */
  showPrices: boolean
  /** Telefono / WhatsApp dello studio (volantini). */
  phone: string
  /** Indirizzo dello studio (volantini). */
  address: string
  /** Nome del dottore (volantini). */
  doctorName: string
  /** Logo dei volantini: pronto oppure caricato ("custom"). */
  logoType: 'famiglia' | 'dente' | 'cuore' | 'linea' | 'custom'
  /** Versione del logo caricato, 0 se non c'è. */
  logoVersion: number
  /** Modello grafico dei volantini: "Smile" (colorato) o "Tech" (pulito, tecnologico). */
  flyerStyle: 'smile' | 'tech'
}

export interface SessionUser {
  username: string
  email: string | null
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Chiamato quando il server risponde 401 (sessione scaduta). */
export let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown, raw?: Blob, rawType?: string): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (raw) {
    headers['content-type'] = rawType || 'application/octet-stream'
    payload = raw
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' })
  if (!res.ok) {
    let msg = `Errore ${res.status}`
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* risposta non JSON */
    }
    if (res.status === 401 && !url.endsWith('/login')) onUnauthorized()
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  me: () => request<{ authenticated: boolean; user: SessionUser | null; hasUsers: boolean }>('GET', '/api/me'),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: SessionUser }>('POST', '/api/login', { username, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/logout', {}),

  settings: () => request<AppSettings>('GET', '/api/settings'),
  saveSettings: (changes: Partial<AppSettings>) => request<AppSettings>('PUT', '/api/settings', changes),
  uploadLogo: (file: File) =>
    request<AppSettings>('PUT', '/api/logo', undefined, file, /^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) ? file.type : 'image/png'),
  deleteLogo: () => request<AppSettings>('DELETE', '/api/logo'),

  services: () => request<Service[]>('GET', '/api/services'),
  createService: (s: Partial<Service>) => request<Service>('POST', '/api/services', s),
  updateService: (id: string, s: Partial<Service>) => request<Service>('PUT', `/api/services/${encodeURIComponent(id)}`, s),
  deleteService: (id: string) =>
    request<{ deleted: boolean; deactivated: boolean }>('DELETE', `/api/services/${encodeURIComponent(id)}`),

  records: (from?: string, to?: string) => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    return request<RecordRow[]>('GET', `/api/records?${q}`)
  },
  day: (date: string) => request<{ date: string; items: Record<string, number> }>('GET', `/api/days/${date}`),
  saveDay: (date: string, items: Record<string, number>) =>
    request<{ date: string; items: Record<string, number> }>('PUT', `/api/days/${date}`, { items }),
  deleteAll: () => request<{ ok: boolean }>('DELETE', '/api/records?confirm=ELIMINA'),

  campaigns: (months = 12) => request<CampaignResponse>('GET', `/api/campaigns?months=${months}`),

  customCampaigns: (from?: string, to?: string) => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    return request<CustomCampaign[]>('GET', `/api/custom-campaigns?${q}`)
  },
  createCustomCampaign: (c: CustomCampaignInput) => request<CustomCampaign>('POST', '/api/custom-campaigns', c),
  updateCustomCampaign: (id: number, c: CustomCampaignInput) =>
    request<CustomCampaign>('PUT', `/api/custom-campaigns/${id}`, c),
  saveCustomFlyer: (id: number, flyer: object | null) =>
    request<CustomCampaign>('PUT', `/api/custom-campaigns/${id}/flyer`, { flyer }),
  deleteCustomCampaign: (id: number) => request<{ ok: boolean }>('DELETE', `/api/custom-campaigns/${id}`),

  importExcel: (file: File, mode: 'replace' | 'sum') =>
    request<ImportResult>('POST', `/api/excel/import?mode=${mode}`, undefined, file),
  demo: () => request<{ days: number; imported: number }>('POST', '/api/demo', {}),
}

export const TEMPLATE_URL = '/api/excel/template'
export const EXPORT_URL = '/api/excel/export'
