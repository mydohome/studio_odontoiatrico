// Appuntamenti dei pazienti, con link di conferma personale da inviare su WhatsApp.

import { randomBytes } from 'node:crypto'
import { LINK_DAYS_AFTER } from '../../shared/appointments.ts'
import { addDays, isValidISO, today } from '../../shared/dates.ts'
import type { Appointment, AppointmentInput, AppointmentStatus } from '../../shared/types.ts'
import { pool } from './db.ts'

export class AppointmentError extends Error {}

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/
const MAX_RANGE_DAYS = 62

const COLUMNS = `a.id, a.day, to_char(a.start_time, 'HH24:MI') AS time, a.duration_min AS duration,
  a.patient_name AS "patientName", a.patient_phone AS "patientPhone", a.service_id AS "serviceId",
  coalesce(s.name, a.service_name) AS "serviceName", a.notes, a.token,
  a.sent_at AS "sentAt", a.confirmed_at AS "confirmedAt", a.confirmed_via AS "confirmedVia",
  a.created_by AS "createdBy", a.created_at AS "createdAt", a.updated_at AS "updatedAt"`
const FROM = 'appointments a LEFT JOIN services s ON s.id = a.service_id'

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
  `)
}

type Row = Omit<Appointment, 'status'> & { confirmedVia: 'link' | 'manuale' | null }

function statusOf(r: Row): AppointmentStatus {
  if (r.confirmedAt) return r.confirmedVia === 'manuale' ? 'confermato-manuale' : 'confermato-link'
  return r.sentAt ? 'inviato' : 'da-inviare'
}

function toAppointment(r: Row): Appointment {
  const { confirmedVia: _via, ...rest } = r
  return { ...rest, status: statusOf(r) }
}

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

/** Pazienti degli ultimi due anni (nome e telefono più recente), per il completamento automatico. */
export async function listPatients(): Promise<{ name: string; phone: string }[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(patient_name)) patient_name AS name, patient_phone AS phone
     FROM appointments WHERE day >= $1
     ORDER BY lower(patient_name), day DESC, start_time DESC LIMIT 2000`,
    [addDays(today(), -730)],
  )
  return rows
}

export async function createAppointment(input: AppointmentInput, user: string | null): Promise<Appointment> {
  const name = await serviceName(input.serviceId)
  const { rows } = await pool.query(
    `INSERT INTO appointments (day, start_time, duration_min, patient_name, patient_phone, service_id, service_name, notes, token, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [input.day, input.time, input.duration, input.patientName, input.patientPhone, input.serviceId, name, input.notes, newToken(), user],
  )
  return getById(rows[0].id)
}

/**
 * Se cambiano giorno, ora o telefono la conferma e l'invio non valgono più: il paziente deve
 * ricevere il nuovo riepilogo e confermare di nuovo (il link resta lo stesso).
 */
export async function updateAppointment(id: number, input: AppointmentInput): Promise<Appointment> {
  const name = await serviceName(input.serviceId)
  const { rowCount } = await pool.query(
    `UPDATE appointments SET
       sent_at = CASE WHEN day <> $2 OR start_time <> $3::time OR patient_phone <> $6 THEN NULL ELSE sent_at END,
       confirmed_at = CASE WHEN day <> $2 OR start_time <> $3::time THEN NULL ELSE confirmed_at END,
       confirmed_via = CASE WHEN day <> $2 OR start_time <> $3::time THEN NULL ELSE confirmed_via END,
       day = $2, start_time = $3, duration_min = $4, patient_name = $5, patient_phone = $6,
       service_id = $7, service_name = $8, notes = $9, updated_at = now()
     WHERE id = $1`,
    [id, input.day, input.time, input.duration, input.patientName, input.patientPhone, input.serviceId, name, input.notes],
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
  const r = await pool.query('UPDATE appointments SET sent_at = coalesce(sent_at, now()) WHERE id=$1', [id])
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

// ---------- Pagina pubblica di conferma ----------

/** Appuntamento del link, se il link è ancora valido (fino a 3 giorni dopo l'appuntamento). */
export async function findByToken(token: string): Promise<Appointment | null> {
  if (!TOKEN_RE.test(token)) return null
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.token=$1 AND a.day >= $2`, [
    token,
    addDays(today(), -LINK_DAYS_AFTER),
  ])
  return rows[0] ? toAppointment(rows[0]) : null
}

/** Conferma dal link: vale una volta sola e solo fino al giorno dell'appuntamento. */
export async function confirmByToken(token: string): Promise<Appointment | null> {
  if (!TOKEN_RE.test(token)) return null
  await pool.query(
    `UPDATE appointments SET confirmed_at = now(), confirmed_via = 'link'
     WHERE token=$1 AND confirmed_at IS NULL AND day >= $2`,
    [token, today()],
  )
  return findByToken(token)
}
