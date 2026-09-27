// Logo dello studio caricato dall'utente (salvato nel database, sopravvive agli aggiornamenti).

import { pool } from './db.ts'

export class LogoError extends Error {}

export const MAX_LOGO_BYTES = 1024 * 1024
export const LOGO_TYPES = ['famiglia', 'dente', 'cuore', 'linea', 'custom'] as const
export type LogoType = (typeof LOGO_TYPES)[number]

export async function migrateBranding(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      key        text PRIMARY KEY,
      mime       text NOT NULL,
      data       bytea NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** Riconosce il formato dal contenuto (non dall'estensione o dall'intestazione dichiarata). */
export function detectImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  const head = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/** Un SVG caricato non deve contenere script, gestori di eventi o riferimenti esterni. */
function checkSvg(buf: Buffer) {
  const text = buf.toString('utf8')
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(text)) {
    throw new LogoError('Il file SVG contiene script o elementi non consentiti.')
  }
  if (/(href|src)\s*=\s*["']\s*(https?:|\/\/)/i.test(text)) {
    throw new LogoError('Il file SVG fa riferimento a risorse esterne: incorpora le immagini nel file.')
  }
}

export async function saveLogo(buf: Buffer): Promise<{ mime: string; version: number }> {
  if (!buf.length) throw new LogoError('File vuoto.')
  if (buf.length > MAX_LOGO_BYTES) throw new LogoError('Il logo supera 1 MB: riducilo e riprova.')
  const mime = detectImage(buf)
  if (!mime) throw new LogoError('Formato non supportato: usa PNG, JPG, WebP o SVG.')
  if (mime === 'image/svg+xml') checkSvg(buf)
  const { rows } = await pool.query(
    `INSERT INTO assets (key, mime, data) VALUES ('logo', $1, $2)
     ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()
     RETURNING extract(epoch FROM updated_at) * 1000 AS v`,
    [mime, buf],
  )
  return { mime, version: Math.round(Number(rows[0].v)) }
}

export async function getLogo(): Promise<{ mime: string; data: Buffer; version: number } | null> {
  const { rows } = await pool.query(
    `SELECT mime, data, extract(epoch FROM updated_at) * 1000 AS v FROM assets WHERE key = 'logo'`,
  )
  return rows[0] ? { mime: rows[0].mime, data: rows[0].data, version: Math.round(Number(rows[0].v)) } : null
}

export async function logoVersion(): Promise<number> {
  const { rows } = await pool.query(`SELECT extract(epoch FROM updated_at) * 1000 AS v FROM assets WHERE key = 'logo'`)
  return rows[0] ? Math.round(Number(rows[0].v)) : 0
}

export async function deleteLogo(): Promise<void> {
  await pool.query(`DELETE FROM assets WHERE key = 'logo'`)
}
