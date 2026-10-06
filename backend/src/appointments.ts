// Appuntamenti dei pazienti, con link di conferma personale da inviare su WhatsApp.

import { randomBytes } from 'node:crypto'
import { LINK_DAYS_AFTER } from '../../shared/appointments.ts'
import { addDays, isValidISO, today } from '../../shared/dates.ts'
import type { Appointment, AppointmentInput, AppointmentStatus, ScheduledAppointment } from '../../shared/types.ts'
import { decrypt, encrypt } from './dataCrypto.ts'
import { pool } from './db.ts'
import { checkDoctor } from './doctors.ts'

export class AppointmentError extends Error {}

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/
const MAX_RANGE_DAYS = 62

const COLUMNS = `a.id, a.day, to_char(a.start_time, 'HH24:MI') AS time, a.duration_min AS duration,
  a.patient_name AS "patientName", a.patient_phone AS "patientPhone", a.service_id AS "serviceId",
  coalesce(s.name, a.service_name) AS "serviceName", s.category AS "serviceCategory", s.color AS "serviceColor",
  a.doctor_id AS "doctorId", d.name AS "doctorName", d.color AS "doctorColor",
  a.prev_day AS "prevDay", to_char(a.prev_time, 'HH24:MI') AS "prevTime", a.reschedule_at AS "rescheduleAt",
  a.notes, a.token,
  a.sent_at AS "sentAt", a.send_count AS "sendCount", a.last_sent_at AS "lastSentAt",
  a.call_count AS "callCount", a.last_call_at AS "lastCallAt",
  a.confirmed_at AS "confirmedAt", a.confirmed_via AS "confirmedVia", a.no_show_at AS "noShowAt",
  a.created_by AS "createdBy", a.created_at AS "createdAt", a.updated_at AS "updatedAt"`
const FROM = 'appointments a LEFT JOIN services s ON s.id = a.service_id LEFT JOIN doctors d ON d.id = a.doctor_id'

export async function migrateAppointments(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id            serial PRIMARY KEY,
      day           date NOT NULL,
      start_time    time NOT NULL,
      duration_min  integer NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
      patient_name  text NOT NULL,
      patient_phone text NOT NULL,
      service_id    text REFERENCES services(id) ON DELETE SET NULL ON UPDATE CASCADE,
      service_name  text NOT NULL DEFAULT '',
      notes         text NOT NULL DEFAULT '',
      token         text NOT NULL UNIQUE,
      sent_at       timestamptz,
      confirmed_at  timestamptz,
      confirmed_via text CHECK (confirmed_via IN ('link', 'manuale')),
      created_by    text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS appointments_day ON appointments (day, start_time);
    -- Solleciti: quante volte è stato preparato il messaggio e quante chiamate senza risposta.
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 0;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS call_count integer NOT NULL DEFAULT 0;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS last_call_at timestamptz;
    UPDATE appointments SET send_count = 1, last_sent_at = sent_at WHERE sent_at IS NOT NULL AND send_count = 0;
    -- Da riprogrammare: niente data né ora, si ricorda quelle precedenti.
    ALTER TABLE appointments ALTER COLUMN day DROP NOT NULL;
    ALTER TABLE appointments ALTER COLUMN start_time DROP NOT NULL;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS prev_day date;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS prev_time time;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reschedule_at timestamptz;
    CREATE INDEX IF NOT EXISTS appointments_reschedule ON appointments (reschedule_at) WHERE day IS NULL;
    -- Non presentato: segnato dallo studio dal giorno dell'appuntamento.
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS no_show_at timestamptz;
    -- Medico che esegue la prestazione.
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_id integer REFERENCES doctors(id) ON DELETE SET NULL;
  `)
}

type Row = Omit<Appointment, 'status'> & { confirmedVia: 'link' | 'manuale' | null }

function statusOf(r: Row): AppointmentStatus {
  if (r.day === null) return 'da-riprogrammare'
  if (r.noShowAt) return 'non-presentato'
  if (r.confirmedAt) return r.confirmedVia === 'manuale' ? 'confermato-manuale' : 'confermato-link'
  return r.sentAt ? 'inviato' : 'da-inviare'
}

function toAppointment(r: Row): Appointment {
  const { confirmedVia: _via, ...rest } = r
  return {
    ...rest,
    patientName: decrypt(r.patientName, 'patient_name'),
    patientPhone: decrypt(r.patientPhone, 'patient_phone'),
    notes: decrypt(r.notes, 'notes'),
    status: statusOf(r),
  }
}

/** Nome, telefono e note come vanno salvati (cifrati se DATA_KEY è impostata). */
const sealed = (input: AppointmentInput) => [
  encrypt(input.patientName, 'patient_name'),
  encrypt(input.patientPhone, 'patient_phone'),
  encrypt(input.notes, 'notes'),
]

const text = (v: unknown, field: string, max: number, required = false): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (required && !s) throw new AppointmentError(`${field} obbligatorio`)
  if (s.length > max) throw new AppointmentError(`${field} troppo lungo (massimo ${max} caratteri)`)
  return s
}

export function parseAppointment(body: unknown): AppointmentInput {
  const b = (body ?? {}) as Record<string, unknown>
  const day = String(b.day ?? '')
  if (!isValidISO(day)) throw new AppointmentError('Data non valida')
  const time = String(b.time ?? '')
  const tm = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!tm) throw new AppointmentError('Ora non valida')
  const duration = Number(b.duration ?? 30)
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw new AppointmentError('Durata non valida (da 5 minuti a 8 ore)')
  const patientPhone = text(b.patientPhone, 'Telefono', 20, true)
  if (!/^\+?[0-9 ./()-]{6,20}$/.test(patientPhone) || patientPhone.replace(/\D/g, '').length < 6) {
    throw new AppointmentError('Numero di telefono non valido')
  }
  const serviceId = b.serviceId === null || b.serviceId === undefined || b.serviceId === '' ? null : String(b.serviceId)
  const doctorId = b.doctorId === null || b.doctorId === undefined || b.doctorId === '' ? null : Number(b.doctorId)
  if (doctorId !== null && !Number.isInteger(doctorId)) throw new AppointmentError('Medico non valido')
  // Note interne su più righe: si mantengono gli a capo.
  const notes = String(b.notes ?? '').trim()
  if (notes.length > 1000) throw new AppointmentError('Note troppo lunghe (massimo 1000 caratteri)')
  return {
    day,
    time,
    duration,
    patientName: text(b.patientName, 'Nome del paziente', 80, true),
    patientPhone,
    serviceId,
    doctorId,
    notes,
  }
}

/** Codice del link di conferma: 18 byte casuali (144 bit), impossibile da indovinare. */
export const newToken = () => randomBytes(18).toString('base64url')

async function serviceName(id: string | null): Promise<string> {
  if (!id) return ''
  const { rows } = await pool.query('SELECT name FROM services WHERE id=$1', [id])
  if (!rows[0]) throw new AppointmentError('Prestazione sconosciuta')
  return rows[0].name
}

async function getById(id: number): Promise<Appointment> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.id=$1`, [id])
  if (!rows[0]) throw new AppointmentError('Appuntamento non trovato')
  return toAppointment(rows[0])
}

export async function listAppointments(from: string, to: string): Promise<Appointment[]> {
  if (to < from) throw new AppointmentError('Periodo non valido')
  if (addDays(from, MAX_RANGE_DAYS) < to) throw new AppointmentError(`Periodo troppo lungo (massimo ${MAX_RANGE_DAYS} giorni)`)
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE a.day BETWEEN $1 AND $2 ORDER BY a.day, a.start_time, a.id`,
    [from, to],
  )
  return rows.map(toAppointment)
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const MAX_SEARCH_RESULTS = 30

/**
 * Ricerca per paziente (nome e cognome, anche parti e in qualsiasi ordine; oppure il telefono) in tutti
 * gli appuntamenti. I nomi sono cifrati: si filtrano qui, dopo averli decifrati. Risultati: prima i
 * prossimi (dal più vicino), poi quelli da riprogrammare, poi i passati (dal più recente).
 */
export async function searchAppointments(query: string): Promise<Appointment[]> {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const digits = query.replace(/\D/g, '')
  if (!words.length || words.join('').length < 2) return []
  const { rows } = await pool.query('SELECT id, day, start_time, patient_name, patient_phone FROM appointments')
  const t = today()
  const hits: { id: number; day: string | null; time: string | null }[] = []
  for (const r of rows) {
    const name = fold(decrypt(r.patient_name, 'patient_name'))
    const byName = words.every((w) => name.includes(w))
    const byPhone = digits.length >= 4 && decrypt(r.patient_phone, 'patient_phone').replace(/\D/g, '').includes(digits)
    if (byName || byPhone) hits.push({ id: r.id, day: r.day, time: r.start_time })
  }
  const rank = (h: { day: string | null }) => (h.day === null ? 1 : h.day >= t ? 0 : 2)
  hits.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return (a.day! + (a.time ?? '')).localeCompare(b.day! + (b.time ?? ''))
    if (ra === 2) return (b.day! + (b.time ?? '')).localeCompare(a.day! + (a.time ?? ''))
    return a.id - b.id
  })
  const ids = hits.slice(0, MAX_SEARCH_RESULTS).map((h) => h.id)
  if (!ids.length) return []
  const full = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.id = ANY($1)`, [ids])
  const byId = new Map(full.rows.map((r) => [r.id as number, toAppointment(r)]))
  return ids.map((id) => byId.get(id)).filter((a): a is Appointment => !!a)
}

/** Pazienti degli ultimi due anni (nome e telefono più recente), per il completamento automatico. */
// I nomi sono cifrati: si raggruppano qui, dopo averli decifrati, e non nel database.
export async function listPatients(): Promise<{ name: string; phone: string }[]> {
  const { rows } = await pool.query(
    `SELECT patient_name, patient_phone FROM appointments WHERE day >= $1 ORDER BY day DESC, start_time DESC`,
    [addDays(today(), -730)],
  )
  const byName = new Map<string, { name: string; phone: string }>()
  for (const r of rows) {
    const name = decrypt(r.patient_name, 'patient_name')
    const k = name.toLowerCase()
    if (!byName.has(k)) byName.set(k, { name, phone: decrypt(r.patient_phone, 'patient_phone') })
  }
  return [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 2000)
    .map(([, p]) => p)
}

export async function createAppointment(input: AppointmentInput, user: string | null): Promise<Appointment> {
  const name = await serviceName(input.serviceId)
  await checkDoctor(input.doctorId)
  const [pn, pp, notes] = sealed(input)
  const { rows } = await pool.query(
    `INSERT INTO appointments (day, start_time, duration_min, patient_name, patient_phone, service_id, service_name, notes, token, created_by, doctor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [input.day, input.time, input.duration, pn, pp, input.serviceId, name, notes, newToken(), user, input.doctorId],
  )
  return getById(rows[0].id)
}

/**
 * Se cambiano giorno, ora o telefono la conferma e l'invio non valgono più: il paziente deve
 * ricevere il nuovo riepilogo e confermare di nuovo (il link resta lo stesso).
 */
// Cambio di data o ora (anche da "da riprogrammare", dove sono vuote) e cambio di telefono
// ($10: il telefono salvato è cifrato, quindi il confronto si fa qui e non nel database).
const MOVED = 'day IS DISTINCT FROM $2::date OR start_time IS DISTINCT FROM $3::time'
const CHANGED = `${MOVED} OR $10::boolean`

export async function updateAppointment(id: number, input: AppointmentInput): Promise<Appointment> {
  const name = await serviceName(input.serviceId)
  const before = await getById(id)
  const phoneChanged = before.patientPhone !== input.patientPhone
  await checkDoctor(input.doctorId, before.doctorId)
  const [pn, pp, notes] = sealed(input)
  const { rowCount } = await pool.query(
    `UPDATE appointments SET
       sent_at = CASE WHEN ${CHANGED} THEN NULL ELSE sent_at END,
       send_count = CASE WHEN ${CHANGED} THEN 0 ELSE send_count END,
       last_sent_at = CASE WHEN ${CHANGED} THEN NULL ELSE last_sent_at END,
       call_count = CASE WHEN ${CHANGED} THEN 0 ELSE call_count END,
       last_call_at = CASE WHEN ${CHANGED} THEN NULL ELSE last_call_at END,
       confirmed_at = CASE WHEN ${MOVED} THEN NULL ELSE confirmed_at END,
       confirmed_via = CASE WHEN ${MOVED} THEN NULL ELSE confirmed_via END,
       no_show_at = CASE WHEN ${MOVED} THEN NULL ELSE no_show_at END,
       day = $2, start_time = $3, duration_min = $4, patient_name = $5, patient_phone = $6,
       service_id = $7, service_name = $8, notes = $9, doctor_id = $11, updated_at = now(),
       prev_day = NULL, prev_time = NULL, reschedule_at = NULL
     WHERE id = $1`,
    [id, input.day, input.time, input.duration, pn, pp, input.serviceId, name, notes, phoneChanged, input.doctorId],
  )
  if (!rowCount) throw new AppointmentError('Appuntamento non trovato')
  return getById(id)
}

export async function deleteAppointment(id: number): Promise<void> {
  const r = await pool.query('DELETE FROM appointments WHERE id=$1', [id])
  if (!r.rowCount) throw new AppointmentError('Appuntamento non trovato')
}

/** Messaggio WhatsApp preparato (aperto o copiato). */
export async function markSent(id: number): Promise<Appointment> {
  const r = await pool.query(
    'UPDATE appointments SET sent_at = coalesce(sent_at, now()), send_count = send_count + 1, last_sent_at = now() WHERE id=$1',
    [id],
  )
  if (!r.rowCount) throw new AppointmentError('Appuntamento non trovato')
  return getById(id)
}

/**
 * Da riprogrammare: il paziente deve spostare l'appuntamento. Toglie data e ora (lo slot si libera
 * nel calendario e il link di conferma smette di funzionare) e ricorda quelle precedenti.
 */
export async function setToReschedule(id: number): Promise<Appointment> {
  const r = await pool.query(
    `UPDATE appointments SET prev_day = day, prev_time = start_time, day = NULL, start_time = NULL,
       reschedule_at = now(), sent_at = NULL, send_count = 0, last_sent_at = NULL, call_count = 0, last_call_at = NULL,
       confirmed_at = NULL, confirmed_via = NULL, no_show_at = NULL, updated_at = now()
     WHERE id = $1 AND day IS NOT NULL`,
    [id],
  )
  if (!r.rowCount) {
    await getById(id) // "non trovato" se non esiste; altrimenti è già da riprogrammare
  }
  return getById(id)
}

/** Appuntamenti da riprogrammare, dal più vecchio. */
export async function listToReschedule(): Promise<Appointment[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.day IS NULL ORDER BY a.reschedule_at, a.id`)
  return rows.map(toAppointment)
}

/** Chiamata al paziente senza risposta (per sapere chi è già stato cercato). */
export async function markCalled(id: number): Promise<Appointment> {
  const r = await pool.query('UPDATE appointments SET call_count = call_count + 1, last_call_at = now() WHERE id=$1', [id])
  if (!r.rowCount) throw new AppointmentError('Appuntamento non trovato')
  return getById(id)
}

/** Conferma registrata dallo studio (es. il paziente ha telefonato) oppure annullata. */
export async function setManualConfirmation(id: number, confirmed: boolean): Promise<Appointment> {
  const r = await pool.query(
    confirmed
      ? `UPDATE appointments SET confirmed_at = coalesce(confirmed_at, now()), confirmed_via = coalesce(confirmed_via, 'manuale') WHERE id=$1`
      : `UPDATE appointments SET confirmed_at = NULL, confirmed_via = NULL WHERE id=$1`,
    [id],
  )
  if (!r.rowCount) throw new AppointmentError('Appuntamento non trovato')
  return getById(id)
}

/** Non presentato (o annullamento): solo dal giorno dell'appuntamento in poi. */
export async function setNoShow(id: number, noShow: boolean): Promise<Appointment> {
  if (noShow) {
    const r = await pool.query(
      'UPDATE appointments SET no_show_at = coalesce(no_show_at, now()) WHERE id = $1 AND day IS NOT NULL AND day <= $2',
      [id, today()],
    )
    if (!r.rowCount) {
      await getById(id) // "non trovato" se non esiste
      throw new AppointmentError("Si può segnare «non presentato» solo dal giorno dell'appuntamento.")
    }
  } else {
    const r = await pool.query('UPDATE appointments SET no_show_at = NULL WHERE id = $1', [id])
    if (!r.rowCount) throw new AppointmentError('Appuntamento non trovato')
  }
  return getById(id)
}

// ---------- Pagina pubblica di conferma ----------

/**
 * Appuntamento del link, se il link è ancora valido (fino a 3 giorni dopo l'appuntamento).
 * Quelli da riprogrammare (senza data) non hanno un link valido finché non ricevono la nuova data.
 */
export async function findByToken(token: string): Promise<ScheduledAppointment | null> {
  if (!TOKEN_RE.test(token)) return null
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.token=$1 AND a.day >= $2`, [
    token,
    addDays(today(), -LINK_DAYS_AFTER),
  ])
  return rows[0] ? (toAppointment(rows[0]) as ScheduledAppointment) : null
}

/** Conferma dal link: vale una volta sola e solo fino al giorno dell'appuntamento. */
export async function confirmByToken(token: string): Promise<ScheduledAppointment | null> {
  if (!TOKEN_RE.test(token)) return null
  await pool.query(
    `UPDATE appointments SET confirmed_at = now(), confirmed_via = 'link'
     WHERE token=$1 AND confirmed_at IS NULL AND day >= $2`,
    [token, today()],
  )
  return findByToken(token)
}
