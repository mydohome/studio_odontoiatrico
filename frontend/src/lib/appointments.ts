import type { Appointment, AppointmentStatus, ScheduledAppointment } from '../../../shared/types.ts'
import { whatsAppMessage } from '../../../shared/appointments.ts'
import { today } from '../../../shared/dates.ts'
import type { AppSettings } from './api.ts'

export const STATUS: Record<AppointmentStatus, { label: string; short: string; cls: string }> = {
  'confermato-link': { label: 'Confermato dal paziente (link)', short: 'Confermato · link', cls: 'st-link' },
  'confermato-manuale': { label: 'Confermato dallo studio', short: 'Confermato · studio', cls: 'st-manual' },
  inviato: { label: 'Messaggio inviato, in attesa di conferma', short: 'In attesa', cls: 'st-sent' },
  'da-inviare': { label: 'Messaggio non ancora inviato', short: 'Da inviare', cls: 'st-new' },
  'da-riprogrammare': { label: 'Da riprogrammare: il paziente deve spostare l\'appuntamento', short: 'Da riprogrammare', cls: 'st-resched' },
}

export const STATUS_ORDER: AppointmentStatus[] = ['confermato-link', 'confermato-manuale', 'inviato', 'da-inviare', 'da-riprogrammare']

/** Indirizzo da usare nei link: quello impostato, altrimenti quello con cui si usa l'app. */
export function publicBase(settings: AppSettings): string {
  return (settings.publicUrl || window.location.origin).replace(/\/+$/, '')
}

/** Il link funziona per il paziente solo se l'indirizzo è raggiungibile da Internet. */
export function linkWarning(settings: AppSettings): string | null {
  if (settings.publicUrl) return null
  const { hostname, protocol } = window.location
  const local =
    hostname === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.endsWith('.local') ||
    !hostname.includes('.')
  if (local) return `Il link usa l'indirizzo ${window.location.origin}, che il paziente probabilmente non può aprire. Imposta l'indirizzo pubblico dell'app in Impostazioni → Studio.`
  if (protocol !== 'https:') return `Il link usa http senza HTTPS: alcuni telefoni lo segnalano come non sicuro. Conviene impostare l'indirizzo https in Impostazioni → Studio.`
  return null
}

export const confirmUrl = (settings: AppSettings, a: Pick<Appointment, 'token'>) => `${publicBase(settings)}/c/${a.token}`

/** In attesa: il messaggio è già stato preparato almeno una volta ma la conferma non è arrivata. */
export const needsReminder = (a: Appointment) => a.status === 'inviato' && a.sendCount > 0

export function messageFor(settings: AppSettings, a: ScheduledAppointment, opt: { icons?: boolean; reminder?: boolean } = {}): string {
  return whatsAppMessage(
    {
      studioName: settings.studioName,
      studioPhone: settings.phone,
      address: settings.address,
      patientName: a.patientName,
      day: a.day,
      time: a.time,
      serviceName: a.serviceName,
      confirmUrl: confirmUrl(settings, a),
    },
    { icons: opt.icons ?? true, reminder: opt.reminder ?? needsReminder(a), today: today() },
  )
}

export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export const fromMinutes = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`

/** Appuntamenti dello stesso giorno che si sovrappongono all'intervallo indicato. */
export function overlapping(list: ScheduledAppointment[], day: string, time: string, duration: number, exceptId?: number) {
  const s = toMinutes(time)
  const e = s + duration
  return list.filter((a) => a.id !== exceptId && a.day === day && toMinutes(a.time) < e && toMinutes(a.time) + a.duration > s)
}

/**
 * Colonne per gli appuntamenti sovrapposti: ogni gruppo di appuntamenti che si accavallano
 * viene diviso in corsie affiancate.
 */
export function layoutLanes(list: ScheduledAppointment[]): Map<number, { lane: number; lanes: number }> {
  const out = new Map<number, { lane: number; lanes: number }>()
  const sorted = [...list].sort((a, b) => toMinutes(a.time) - toMinutes(b.time) || b.duration - a.duration)
  let group: { a: ScheduledAppointment; lane: number }[] = []
  let groupEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1))
    for (const g of group) out.set(g.a.id, { lane: g.lane, lanes })
    group = []
  }
  for (const a of sorted) {
    const s = toMinutes(a.time)
    if (s >= groupEnd) {
      flush()
      groupEnd = -1
    }
    const used = new Set(group.filter((g) => toMinutes(g.a.time) + g.a.duration > s).map((g) => g.lane))
    let lane = 0
    while (used.has(lane)) lane++
    group.push({ a, lane })
    groupEnd = Math.max(groupEnd, s + a.duration)
  }
  flush()
  return out
}

/** Ha data e ora (non è da riprogrammare). */
export const isScheduled = (a: Appointment): a is ScheduledAppointment => a.day !== null && a.time !== null
