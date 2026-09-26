import type { CampaignResponse, ImportResult, RecordRow, Service } from '../../../shared/types.ts'

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

async function request<T>(method: string, url: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (raw) {
    headers['content-type'] = 'application/octet-stream'
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
  me: () => request<{ authRequired: boolean; authenticated: boolean }>('GET', '/api/me'),
  login: (password: string) => request<{ ok: boolean }>('POST', '/api/login', { password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/logout', {}),

  settings: () => request<{ studioName: string }>('GET', '/api/settings'),
  saveSettings: (studioName: string) => request<{ studioName: string }>('PUT', '/api/settings', { studioName }),

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

  importExcel: (file: File, mode: 'replace' | 'sum') =>
    request<ImportResult>('POST', `/api/excel/import?mode=${mode}`, undefined, file),
  demo: () => request<{ days: number; imported: number }>('POST', '/api/demo', {}),
}

export const TEMPLATE_URL = '/api/excel/template'
export const EXPORT_URL = '/api/excel/export'
