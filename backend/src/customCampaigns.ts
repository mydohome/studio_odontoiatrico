// Campagne personalizzate create dall'utente.

import { CATEGORIES } from '../../shared/catalog.ts'
import { isValidISO } from '../../shared/dates.ts'
import type { CategoryId, CustomCampaign, CustomCampaignInput } from '../../shared/types.ts'
import { pool } from './db.ts'

export class CampaignError extends Error {}

const CAT_IDS = new Set<string>(CATEGORIES.map((c) => c.id))
const MAX_FLYER_BYTES = 20_000

const COLUMNS = `id, category, title, offer, target, channels, date_from AS "dateFrom", date_to AS "dateTo",
  notes, flyer, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`

export async function migrateCustomCampaigns(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_campaigns (
      id          serial PRIMARY KEY,
      category    text NOT NULL,
      title       text NOT NULL,
      offer       text NOT NULL DEFAULT '',
      target      text NOT NULL DEFAULT '',
      channels    text[] NOT NULL DEFAULT '{}',
      date_from   date NOT NULL,
      date_to     date NOT NULL CHECK (date_to >= date_from),
      notes       text NOT NULL DEFAULT '',
      flyer       jsonb,
      created_by  text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS custom_campaigns_period ON custom_campaigns (date_from, date_to);
  `)
}

const text = (v: unknown, field: string, max: number, required = false): string => {
  const s = String(v ?? '').trim()
  if (required && !s) throw new CampaignError(`${field} obbligatorio`)
  if (s.length > max) throw new CampaignError(`${field} troppo lungo (massimo ${max} caratteri)`)
  return s
}

export function parseInput(body: unknown): CustomCampaignInput {
  const b = (body ?? {}) as Record<string, unknown>
  const category = String(b.category ?? '')
  if (!CAT_IDS.has(category)) throw new CampaignError('Categoria non valida')
  const dateFrom = String(b.dateFrom ?? '')
  const dateTo = String(b.dateTo ?? '')
  if (!isValidISO(dateFrom) || !isValidISO(dateTo)) throw new CampaignError('Periodo non valido')
  if (dateTo < dateFrom) throw new CampaignError('La data di fine è precedente a quella di inizio')
  const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000
  if (days > 366) throw new CampaignError('Il periodo non può superare un anno')
  const rawChannels = Array.isArray(b.channels) ? b.channels : []
  const channels = [...new Set(rawChannels.map((c) => String(c).trim()).filter(Boolean))]
  if (channels.length > 10 || channels.some((c) => c.length > 40)) throw new CampaignError('Canali non validi')
  return {
    category: category as CategoryId,
    title: text(b.title, 'Titolo', 80, true),
    offer: text(b.offer, 'Offerta', 300),
    target: text(b.target, 'Target', 200),
    channels,
    dateFrom,
    dateTo,
    notes: text(b.notes, 'Note', 2000),
  }
}

export function parseFlyer(v: unknown): Record<string, unknown> | null {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new CampaignError('Dati del volantino non validi')
  if (JSON.stringify(v).length > MAX_FLYER_BYTES) throw new CampaignError('Dati del volantino troppo grandi')
  return v as Record<string, unknown>
}

/** Campagne che si sovrappongono al periodo indicato (tutte se non indicato). */
export async function listCustomCampaigns(from?: string, to?: string): Promise<CustomCampaign[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM custom_campaigns
     WHERE ($1::date IS NULL OR date_to >= $1) AND ($2::date IS NULL OR date_from <= $2)
     ORDER BY date_from, id`,
    [from ?? null, to ?? null],
  )
  return rows
}

export async function createCustomCampaign(input: CustomCampaignInput, user: string | null): Promise<CustomCampaign> {
  const { rows } = await pool.query(
    `INSERT INTO custom_campaigns (category, title, offer, target, channels, date_from, date_to, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
    [input.category, input.title, input.offer, input.target, input.channels, input.dateFrom, input.dateTo, input.notes, user],
  )
  return rows[0]
}

export async function updateCustomCampaign(id: number, input: CustomCampaignInput): Promise<CustomCampaign> {
  const { rows } = await pool.query(
    `UPDATE custom_campaigns SET category=$2, title=$3, offer=$4, target=$5, channels=$6, date_from=$7, date_to=$8,
       notes=$9, updated_at=now() WHERE id=$1 RETURNING ${COLUMNS}`,
    [id, input.category, input.title, input.offer, input.target, input.channels, input.dateFrom, input.dateTo, input.notes],
  )
  if (!rows[0]) throw new CampaignError('Campagna non trovata')
  return rows[0]
}

export async function saveCustomFlyer(id: number, flyer: Record<string, unknown> | null): Promise<CustomCampaign> {
  const { rows } = await pool.query(
    `UPDATE custom_campaigns SET flyer=$2, updated_at=now() WHERE id=$1 RETURNING ${COLUMNS}`,
    [id, flyer === null ? null : JSON.stringify(flyer)],
  )
  if (!rows[0]) throw new CampaignError('Campagna non trovata')
  return rows[0]
}

export async function deleteCustomCampaign(id: number): Promise<void> {
  const r = await pool.query('DELETE FROM custom_campaigns WHERE id=$1', [id])
  if (!r.rowCount) throw new CampaignError('Campagna non trovata')
}
