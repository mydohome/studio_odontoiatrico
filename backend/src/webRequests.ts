// Modulo Richieste web, lato gestionale: impostazioni (indirizzo dell'informativa), contatore, pulizia.
// La pagina pubblica e le sue rotte stanno in un container separato («booking»: bookingApp.ts) che scrive
// solo nella inbox; l'importazione nell'agenda è in inbox.ts. Il modulo si elimina come descritto nel README
// (sezione "Richieste web").
//
// - Il codice del modulo è firmato (HMAC) e senza stato: scade in 10 minuti e vale una sola volta.
// - Nome, telefono e testo sono cifrati come i dati dei pazienti. L'IP non si salva in chiaro.
// - Le richieste non gestite si cancellano dopo 30 giorni.

import type { FastifyInstance } from 'fastify'
import { WebRequestError } from './bookingCore.ts'
import { getSetting, pool, setSetting } from './db.ts'

const RETENTION_DAYS = 30
const IP_RETENTION_DAYS = 7

export function bookingBaseUrl(): string | null {
  const raw = (process.env.BOOKING_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    return /^https?:$/.test(new URL(raw).protocol) ? raw : null
  } catch {
    return null
  }
}

/** Cancella le richieste non gestite dopo 30 giorni e le impronte IP dopo 7. */
export async function purgeWebRequests(): Promise<void> {
  await pool.query(`DELETE FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL AND web_request_at < now() - make_interval(days => $1)`, [RETENTION_DAYS])
  await pool.query(`UPDATE appointments SET web_ip_hash = NULL WHERE web_ip_hash IS NOT NULL AND web_request_at < now() - make_interval(days => $1)`, [IP_RETENTION_DAYS])
}

export const PRIVACY_KEY = 'bookingPrivacyUrl'

function normalizePrivacyUrl(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new WebRequestError("Indirizzo dell'informativa non valido (es. https://www.studio.it/privacy)")
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new WebRequestError("L'indirizzo dell'informativa deve iniziare con https://")
  if (s.length > 300) throw new WebRequestError('Indirizzo troppo lungo')
  return u.toString()
}

export interface WebRequestsDeps {
  /** Ripubblica le impostazioni per la pagina pubblica (dopo una modifica). */
  publish: () => Promise<void>
}

export function registerWebRequests(app: FastifyInstance, d: WebRequestsDeps) {
  // Richiedono l'accesso: lo controlla l'hook globale del server.
  app.get('/api/web-requests/info', async () => ({ baseUrl: bookingBaseUrl(), privacyUrl: (await getSetting(PRIVACY_KEY)) ?? '' }))
  app.put('/api/web-requests/info', async (req) => {
    const url = normalizePrivacyUrl((req.body as { privacyUrl?: unknown } | null)?.privacyUrl)
    await setSetting(PRIVACY_KEY, url)
    await d.publish().catch((e) => app.log.error(e))
    return { baseUrl: bookingBaseUrl(), privacyUrl: url }
  })
  app.get('/api/web-requests/count', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL')
    return { count: rows[0].n as number }
  })
}
