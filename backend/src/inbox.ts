// Lato gestionale della «inbox» delle richieste web. Il container pubblico «booking» scrive soltanto nello
// schema `inbox` (richieste sigillate con la chiave pubblica) con un utente PostgreSQL che non vede nient'altro;
// qui si crea quello schema, si pubblicano le impostazioni che la pagina pubblica deve leggere e si
// importano le richieste nell'agenda, ricontrollandole una per una.

import type { KeyObject } from 'node:crypto'
import { MAX_PENDING, parseBooking } from './bookingCore.ts'
import { getSetting, pool } from './db.ts'
import { encrypt, loadedDataKey } from './dataCrypto.ts'
import { inboxKeys, open } from './inboxCrypto.ts'
import { newToken } from './appointments.ts'

export const INBOX_ROLE = 'booking_inbox'
export const INBOX_INTERVAL_MS = 10_000
const BATCH = 20
const REQUEST_RETENTION_DAYS = 30

/** Password dell'utente del container pubblico: lettere, cifre, - e _ (finisce in un URL e in un comando SQL). */
export const inboxPassword = (): string | null => {
  const p = process.env.BOOKING_DB_PASSWORD ?? ''
  return /^[A-Za-z0-9_-]{16,128}$/.test(p) ? p : null
}

let keys: ReturnType<typeof inboxKeys> | null = null
const getKeys = (): { privateKey: KeyObject; publicRaw: Buffer } | null => {
  if (keys) return keys
  const dk = loadedDataKey()
  if (!dk) return null
  keys = inboxKeys(dk)
  return keys
}

export async function migrateInbox(): Promise<void> {
  const password = inboxPassword()
  if (!password) {
    console.warn('BOOKING_DB_PASSWORD mancante o non valida: le richieste web restano chiuse (esegui ./studio update).')
    return
  }
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS inbox;
    CREATE TABLE IF NOT EXISTS inbox.requests (
      id         serial PRIMARY KEY,
      nonce      text NOT NULL,
      sealed     text NOT NULL,
      slot       text NOT NULL,
      consent    text NOT NULL,
      ip_hash    text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- Codici già usati: restano un'ora (oltre la validità massima), anche dopo l'importazione della richiesta.
    CREATE TABLE IF NOT EXISTS inbox.nonces (nonce text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS inbox.hits (ip_hash text NOT NULL, at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS inbox_hits_ip ON inbox.hits (ip_hash, at);
    CREATE TABLE IF NOT EXISTS inbox.config (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${INBOX_ROLE}') THEN
        CREATE ROLE ${INBOX_ROLE} LOGIN;
      END IF;
    END $$;
  `)
  // La password si riapplica a ogni avvio: segue il .env.
  const { rows } = await pool.query(`SELECT format('ALTER ROLE ${INBOX_ROLE} WITH LOGIN PASSWORD %L CONNECTION LIMIT 5', $1::text) AS q`, [password])
  await pool.query(rows[0].q)
  const db = (await pool.query('SELECT current_database() AS d')).rows[0].d as string
  const qdb = `"${db.replace(/"/g, '""')}"`
  await pool.query(`
    ALTER ROLE ${INBOX_ROLE} SET search_path = inbox;
    ALTER ROLE ${INBOX_ROLE} SET statement_timeout = '5s';
    REVOKE ALL ON SCHEMA public FROM ${INBOX_ROLE};
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${INBOX_ROLE};
    REVOKE ALL ON DATABASE ${qdb} FROM ${INBOX_ROLE};
    GRANT CONNECT ON DATABASE ${qdb} TO ${INBOX_ROLE};
    REVOKE ALL ON ALL TABLES IN SCHEMA inbox FROM ${INBOX_ROLE};
    GRANT USAGE ON SCHEMA inbox TO ${INBOX_ROLE};
    GRANT INSERT ON inbox.requests TO ${INBOX_ROLE};
    GRANT SELECT (id) ON inbox.requests TO ${INBOX_ROLE};
    GRANT USAGE ON SEQUENCE inbox.requests_id_seq TO ${INBOX_ROLE};
    GRANT SELECT, INSERT ON inbox.nonces, inbox.hits TO ${INBOX_ROLE};
    GRANT SELECT ON inbox.config TO ${INBOX_ROLE};
  `)
}

/** Impostazioni che la pagina pubblica può leggere; il solo fatto che siano aggiornate vale come «il gestionale è attivo». */
export async function publishInbox(info: { enabled: boolean; studioName: string; phone: string }): Promise<void> {
  if (!inboxPassword()) return
  const k = getKeys()
  const privacyUrl = (await getSetting('bookingPrivacyUrl')) ?? ''
  const pending = (await pool.query('SELECT count(*)::int AS n FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL')).rows[0].n as number
  const values: Record<string, string> = {
    enabled: String(info.enabled && !!k && !!privacyUrl),
    studioName: info.studioName,
    phone: info.phone,
    privacyUrl,
    pubkey: k ? k.publicRaw.toString('base64url') : '',
    pending: String(pending),
  }
  for (const [key, value] of Object.entries(values)) {
    await pool.query(
      `INSERT INTO inbox.config (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    )
  }
}

/** Sposta le richieste dalla inbox all'agenda. Restituisce quante ne ha importate. */
export async function importInbox(): Promise<number> {
  const k = getKeys()
  if (!k || !inboxPassword()) return 0
  const client = await pool.connect()
  let imported = 0
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'SELECT id, nonce, sealed, slot, consent, created_at FROM inbox.requests ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED',
      [BATCH],
    )
    let pending = (await client.query('SELECT count(*)::int AS n FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL')).rows[0].n as number
    for (const r of rows) {
      // Ogni richiesta si ricontrolla come se arrivasse da fuori: il container pubblico non è un'autorità.
      let parsed: ReturnType<typeof parseBooking> | null = null
      const text = open(k.privateKey, r.sealed, r.nonce)
      if (text !== null && /^v1 /.test(r.consent) && /^[A-Za-z0-9_-]{32}$/.test(r.nonce)) {
        try {
          parsed = parseBooking({ ...JSON.parse(text), slot: r.slot, consent: true })
        } catch {
          parsed = null
        }
      }
      if (parsed && pending < MAX_PENDING) {
        const ins = await client.query(
          `INSERT INTO appointments (day, start_time, duration_min, patient_name, patient_phone, notes, token, created_by,
             web_request_at, web_slot, web_nonce, web_consent, web_ip_hash)
           VALUES (NULL, NULL, 30, $1, $2, $3, $4, NULL, $5, $6, $7, $8, NULL)
           ON CONFLICT DO NOTHING`,
          [
            encrypt(`${parsed.name} ${parsed.surname}`, 'patient_name'),
            encrypt(parsed.phone, 'patient_phone'),
            encrypt(parsed.message, 'notes'),
            newToken(),
            r.created_at,
            parsed.slot,
            r.nonce,
            r.consent.slice(0, 400),
          ],
        )
        if (ins.rowCount) {
          imported++
          pending++
        }
      } else {
        console.warn(`Richiesta web ${r.id} scartata (${parsed ? 'troppe richieste in attesa' : 'non valida'})`)
      }
      await client.query('DELETE FROM inbox.requests WHERE id = $1', [r.id])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return imported
}

/** Pulizia della inbox: codici e contatori scaduti, richieste rimaste ferme oltre 30 giorni. */
export async function purgeInbox(): Promise<void> {
  if (!inboxPassword()) return
  await pool.query(`DELETE FROM inbox.nonces WHERE at < now() - interval '1 hour'`)
  await pool.query(`DELETE FROM inbox.hits WHERE at < now() - interval '1 day'`)
  await pool.query(`DELETE FROM inbox.requests WHERE created_at < now() - make_interval(days => $1)`, [REQUEST_RETENTION_DAYS])
}
