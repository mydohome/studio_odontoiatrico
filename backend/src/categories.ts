// Categorie delle prestazioni, modificabili in Impostazioni: nome, colore del badge e ordine.
// Le categorie iniziali conservano l'id anche se rinominate, così mantengono i testi pronti di
// campagne e volantini; quelle aggiunte dallo studio usano testi generici.

import type { FastifyInstance } from 'fastify'
import { DEFAULT_CATEGORIES, freeSlot, OLD_BADGE_COLORS, setCategories, type Category } from '../../shared/catalog.ts'
import { slugify } from '../../shared/slug.ts'
import { getSetting, pool, setSetting } from './db.ts'

class CategoryError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export async function migrateCategories(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id    text PRIMARY KEY,
      label text NOT NULL UNIQUE,
      badge text NOT NULL,
      slot  integer NOT NULL,
      sort  integer NOT NULL
    )
  `)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM categories')
  if (rows[0].n === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await pool.query('INSERT INTO categories (id, label, badge, slot, sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
        c.id, c.label, c.badge, c.slot, c.sort,
      ])
    }
  }
  // Nuovi colori delle categorie (rosso, verde e viola sono dei medici): una volta sola e senza
  // toccare quelle che lo studio ha già personalizzato.
  if (!(await getSetting('categoryColorsV2'))) {
    for (const c of DEFAULT_CATEGORIES) {
      const old = OLD_BADGE_COLORS[c.id]
      if (old) await pool.query('UPDATE categories SET badge = $2 WHERE id = $1 AND badge = $3', [c.id, c.badge, old])
    }
    await setSetting('categoryColorsV2', '1')
  }
  await loadCategories()
}

export async function listCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>('SELECT id, label, badge, slot, sort FROM categories ORDER BY sort, label')
  return rows
}

/** Rilegge le categorie e aggiorna l'elenco condiviso usato da campagne, export e validazioni. */
async function loadCategories(): Promise<Category[]> {
  const list = await listCategories()
  setCategories(list)
  return list
}

/** Quante prestazioni e campagne personalizzate usano la categoria (non si può eliminare se usata). */
async function usage(id: string): Promise<{ services: number; campaigns: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM services WHERE category = $1) AS services,
            (SELECT count(*)::int FROM custom_campaigns WHERE category = $1) AS campaigns`,
    [id],
  )
  return rows[0]
}

function parseBody(b: { label?: unknown; badge?: unknown }) {
  const label = String(b.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!label) throw new CategoryError('Nome della categoria obbligatorio')
  const badge = String(b.badge ?? '').toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(badge)) throw new CategoryError('Colore non valido (formato #rrggbb)')
  return { label, badge }
}

const duplicate = (e: unknown) => {
  if ((e as { code?: string }).code === '23505') return new CategoryError('Esiste già una categoria con questo nome', 409)
  return e
}

export function registerCategories(app: FastifyInstance) {
  app.get('/api/categories', async () => listCategories())

  app.post('/api/categories', async (req) => {
    const c = parseBody((req.body ?? {}) as Record<string, unknown>)
    const list = await listCategories()
    // Gli id finiscono anche come chiavi dei grafici: non devono coincidere con quelle riservate.
    const slug = slugify(c.label, 'categoria')
    const base = ['key', 'label', 'full', 'total'].includes(slug) ? `${slug}-cat` : slug
    let id = base
    for (let i = 2; list.some((x) => x.id === id); i++) id = `${base}-${i}`
    const sort = Math.max(0, ...list.map((x) => x.sort)) + 1
    try {
      await pool.query('INSERT INTO categories (id, label, badge, slot, sort) VALUES ($1,$2,$3,$4,$5)', [id, c.label, c.badge, freeSlot(list), sort])
    } catch (e) {
      throw duplicate(e)
    }
    return loadCategories()
  })

  app.put('/api/categories/:id', async (req) => {
    const { id } = req.params as { id: string }
    const c = parseBody((req.body ?? {}) as Record<string, unknown>)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const old = await client.query('SELECT badge FROM categories WHERE id = $1 FOR UPDATE', [id])
      if (!old.rows[0]) throw new CategoryError('Categoria non trovata', 404)
      await client.query('UPDATE categories SET label = $2, badge = $3 WHERE id = $1', [id, c.label, c.badge])
      // Cambiando il colore della categoria lo prendono anche le sue prestazioni: quelle con un
      // colore proprio tornano a seguire la categoria.
      if (old.rows[0].badge !== c.badge) await client.query('UPDATE services SET color = NULL WHERE category = $1', [id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw duplicate(e)
    } finally {
      client.release()
    }
    return loadCategories()
  })

  // Nuovo ordine: elenco completo degli id.
  app.put('/api/categories-order', async (req) => {
    const ids = (req.body as { ids?: unknown })?.ids
    const list = await listCategories()
    if (!Array.isArray(ids) || ids.length !== list.length || new Set(ids).size !== ids.length || !list.every((c) => ids.includes(c.id))) {
      throw new CategoryError('Ordine non valido')
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const [i, id] of ids.entries()) await client.query('UPDATE categories SET sort = $2 WHERE id = $1', [id, i + 1])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    return loadCategories()
  })

  app.delete('/api/categories/:id', async (req) => {
    const { id } = req.params as { id: string }
    const u = await usage(id)
    if (u.services || u.campaigns) {
      const what = [
        u.services && `${u.services} ${u.services === 1 ? 'prestazione' : 'prestazioni'}`,
        u.campaigns && `${u.campaigns} ${u.campaigns === 1 ? 'campagna' : 'campagne'}`,
      ].filter(Boolean)
      throw new CategoryError(`Categoria usata da ${what.join(' e ')}: spostale prima in un'altra categoria.`, 409)
    }
    if ((await listCategories()).length <= 1) throw new CategoryError('Serve almeno una categoria')
    const r = await pool.query('DELETE FROM categories WHERE id = $1', [id])
    if (!r.rowCount) throw new CategoryError('Categoria non trovata', 404)
    return loadCategories()
  })
}
