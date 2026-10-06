import pg from 'pg'
import { DEFAULT_SERVICES } from '../../shared/catalog.ts'
import { today } from '../../shared/dates.ts'
import type { DoctorRecordRow, RecordRow, Service } from '../../shared/types.ts'

// Le date SQL vengono restituite come stringhe YYYY-MM-DD (niente conversioni di fuso orario).
pg.types.setTypeParser(1082, (v: string) => v)
// numeric → number
pg.types.setTypeParser(1700, (v: string) => Number(v))

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://studio:studio@localhost:5432/studio',
  max: 5,
})

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id        text PRIMARY KEY,
      name      text NOT NULL UNIQUE,
      category  text NOT NULL,
      price     numeric(10,2),
      active    boolean NOT NULL DEFAULT true,
      sort      integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS records (
      day        date NOT NULL,
      service_id text NOT NULL REFERENCES services(id) ON DELETE CASCADE ON UPDATE CASCADE,
      qty        integer NOT NULL CHECK (qty > 0),
      PRIMARY KEY (day, service_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   text PRIMARY KEY,
      value text NOT NULL
    );
  `)
  // Colore dei badge negli appuntamenti (prima di inserire le prestazioni predefinite, che lo usano).
  await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS color text')
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM services')
  if (rows[0].n === 0) await insertServices(DEFAULT_SERVICES)
  // Igiene orale verde scuro anche nelle installazioni esistenti (una volta sola: poi decide lo studio).
  if (!(await getSetting('badgeColorsInit'))) {
    await pool.query(`UPDATE services SET color = '#166534' WHERE id = 'igiene' AND color IS NULL`)
    await setSetting('badgeColorsInit', '1')
  }
}

async function insertServices(list: Service[]) {
  for (const s of list) {
    await pool.query(
      'INSERT INTO services (id, name, category, price, active, sort, color) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [s.id, s.name, s.category, s.price, s.active, s.sort, s.color ?? null],
    )
  }
}

export async function listServices(): Promise<Service[]> {
  const { rows } = await pool.query('SELECT id, name, category, price, active, sort, color FROM services ORDER BY sort, name')
  return rows
}

export async function listRecords(from?: string, to?: string): Promise<RecordRow[]> {
  const { rows } = await pool.query(
    `SELECT day AS d, service_id AS s, qty AS q FROM records
     WHERE ($1::date IS NULL OR day >= $1) AND ($2::date IS NULL OR day <= $2)
     ORDER BY day`,
    [from ?? null, to ?? null],
  )
  return rows
}

/**
 * Prestazioni degli appuntamenti confermati fino a oggi (esclusi i pazienti non presentati): nelle statistiche contano come quelle
 * registrate a mano. Calcolate al volo, così spostamenti, annullamenti e conferme tolte si
 * riflettono subito senza dover tenere allineate due tabelle.
 */
export async function listAppointmentRecords(from?: string, to?: string): Promise<RecordRow[]> {
  const { rows } = await pool.query(
    `SELECT day AS d, service_id AS s, count(*)::int AS q FROM appointments
     WHERE confirmed_at IS NOT NULL AND no_show_at IS NULL AND service_id IS NOT NULL AND day IS NOT NULL AND day <= $3
       AND ($1::date IS NULL OR day >= $1) AND ($2::date IS NULL OR day <= $2)
     GROUP BY day, service_id ORDER BY day`,
    [from ?? null, to ?? null, today()],
  )
  return rows
}

/**
 * Come listAppointmentRecords, ma per medico: serve alle statistiche per medico (le registrazioni a
 * mano non hanno un medico, quindi non compaiono qui).
 */
export async function listDoctorRecords(from?: string, to?: string): Promise<DoctorRecordRow[]> {
  const { rows } = await pool.query(
    `SELECT day AS d, service_id AS s, doctor_id AS doc, count(*)::int AS q FROM appointments
     WHERE confirmed_at IS NOT NULL AND no_show_at IS NULL AND service_id IS NOT NULL AND day IS NOT NULL AND day <= $3
       AND ($1::date IS NULL OR day >= $1) AND ($2::date IS NULL OR day <= $2)
     GROUP BY day, service_id, doctor_id ORDER BY day`,
    [from ?? null, to ?? null, today()],
  )
  return rows
}

/** Registrazioni a mano + appuntamenti confermati, per giorno e prestazione (a = di cui da appuntamenti). */
export async function listStatRecords(from?: string, to?: string): Promise<RecordRow[]> {
  const [manual, appts] = await Promise.all([listRecords(from, to), listAppointmentRecords(from, to)])
  const byKey = new Map<string, RecordRow>()
  for (const r of manual) byKey.set(`${r.d}|${r.s}`, { ...r })
  for (const r of appts) {
    const k = `${r.d}|${r.s}`
    const cur = byKey.get(k)
    if (cur) {
      cur.q += r.q
      cur.a = r.q
    } else byKey.set(k, { d: r.d, s: r.s, q: r.q, a: r.q })
  }
  return [...byKey.values()].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0))
}

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key])
  return rows[0]?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value],
  )
}

/**
 * Scrive le quantità di più giornate in una transazione.
 * mode 'replace': i giorni presenti vengono sostituiti; 'sum': le quantità vengono sommate.
 */
export async function writeDays(
  days: Map<string, Map<string, number>>,
  mode: 'replace' | 'sum',
): Promise<number> {
  const client = await pool.connect()
  let written = 0
  try {
    await client.query('BEGIN')
    for (const [day, items] of days) {
      if (mode === 'replace') await client.query('DELETE FROM records WHERE day = $1', [day])
      const ids: string[] = []
      const qtys: number[] = []
      for (const [sid, q] of items) {
        if (q > 0) {
          ids.push(sid)
          qtys.push(q)
        }
      }
      if (!ids.length) continue
      await client.query(
        `INSERT INTO records (day, service_id, qty)
         SELECT $1::date, u.s, u.q FROM unnest($2::text[], $3::int[]) AS u(s, q)
         ON CONFLICT (day, service_id) DO UPDATE SET qty = records.qty + EXCLUDED.qty`,
        [day, ids, qtys],
      )
      written += ids.length
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return written
}
