// Medici dello studio: ognuno ha un colore che contraddistingue i suoi appuntamenti nell'agenda.

import type { FastifyInstance } from 'fastify'
import type { Doctor } from '../../shared/types.ts'
import { getSetting, pool, setSetting } from './db.ts'

class DoctorError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** Medici di partenza (da rinominare in Impostazioni): una volta sola, poi decide lo studio. */
const STARTERS = [
  { name: 'Dott. Viola', color: '#7e22ce' },
  { name: 'Dott. Verde', color: '#15803d' },
  { name: 'Dott. Rosso', color: '#dc2626' },
]

export async function migrateDoctors(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id     serial PRIMARY KEY,
      name   text NOT NULL UNIQUE,
      color  text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      sort   integer NOT NULL DEFAULT 0
    )
  `)
  if (!(await getSetting('doctorsInit'))) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM doctors')
    if (rows[0].n === 0) {
      for (const [i, d] of STARTERS.entries()) {
        await pool.query('INSERT INTO doctors (name, color, sort) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [d.name, d.color, i + 1])
      }
    }
    await setSetting('doctorsInit', '1')
  }
}

export async function listDoctors(): Promise<Doctor[]> {
  const { rows } = await pool.query('SELECT id, name, color, active, sort FROM doctors ORDER BY sort, name')
  return rows
}

function parseBody(b: Record<string, unknown>) {
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!name) throw new DoctorError('Nome del medico obbligatorio')
  const color = String(b.color ?? '').toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new DoctorError('Colore non valido (formato #rrggbb)')
  return { name, color, active: b.active !== false }
}

const duplicate = (e: unknown) =>
  (e as { code?: string }).code === '23505' ? new DoctorError('Esiste già un medico con questo nome', 409) : e

/** Controlla che il medico di un appuntamento esista (e sia attivo, salvo che sia già quello assegnato). */
export async function checkDoctor(id: number | null, current: number | null = null): Promise<void> {
  if (id === null || id === current) return
  const { rows } = await pool.query('SELECT active FROM doctors WHERE id = $1', [id])
  if (!rows[0]) throw new DoctorError('Medico sconosciuto')
  if (!rows[0].active) throw new DoctorError('Il medico scelto non è attivo')
}

export function registerDoctors(app: FastifyInstance) {
  app.get('/api/doctors', async () => listDoctors())

  app.post('/api/doctors', async (req) => {
    const d = parseBody((req.body ?? {}) as Record<string, unknown>)
    try {
      await pool.query('INSERT INTO doctors (name, color, active, sort) VALUES ($1,$2,$3,(SELECT coalesce(max(sort),0)+1 FROM doctors))', [d.name, d.color, d.active])
    } catch (e) {
      throw duplicate(e)
    }
    return listDoctors()
  })

  app.put('/api/doctors/:id', async (req) => {
    const id = Number((req.params as { id: string }).id)
    const d = parseBody((req.body ?? {}) as Record<string, unknown>)
    try {
      const r = await pool.query('UPDATE doctors SET name=$2, color=$3, active=$4 WHERE id=$1', [id, d.name, d.color, d.active])
      if (!r.rowCount) throw new DoctorError('Medico non trovato', 404)
    } catch (e) {
      throw duplicate(e)
    }
    return listDoctors()
  })

  // Con appuntamenti si disattiva (lo storico mantiene nome e colore); altrimenti si elimina.
  app.delete('/api/doctors/:id', async (req) => {
    const id = Number((req.params as { id: string }).id)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1', [id])
    if (rows[0].n > 0) {
      await pool.query('UPDATE doctors SET active = false WHERE id = $1', [id])
      return { deleted: false, deactivated: true, doctors: await listDoctors() }
    }
    const r = await pool.query('DELETE FROM doctors WHERE id = $1', [id])
    if (!r.rowCount) throw new DoctorError('Medico non trovato', 404)
    return { deleted: true, deactivated: false, doctors: await listDoctors() }
  })
}
