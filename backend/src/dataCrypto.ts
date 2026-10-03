// Cifratura dei dati personali dei pazienti (nome, telefono, note) prima di salvarli nel database.
// AES-256-GCM con la chiave DATA_KEY del .env, che non sta nel database né nei backup: chi ottiene
// un dump, un backup o l'accesso a PostgreSQL vede solo testo cifrato.
// Formato salvato: "v1:" + base64url(IV 12 byte | tag 16 byte | testo cifrato).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getSetting, pool, setSetting } from './db.ts'

const PREFIX = 'v1:'
const ENCRYPTED_RE = /^v1:[A-Za-z0-9_-]{38,}$/
const CHECK_KEY = 'dataKeyCheck'
const CHECK_TEXT = 'studio-odontoiatrico'

export class DataKeyError extends Error {}

let KEY: Buffer | null = null

/** Chiave da 32 byte: 64 caratteri esadecimali (come la genera setup.sh) oppure base64. */
export function parseDataKey(raw: string | undefined): Buffer | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const key = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, /[-_]/.test(s) ? 'base64url' : 'base64')
  if (key.length !== 32) throw new DataKeyError('DATA_KEY non valida: servono 32 byte (64 caratteri esadecimali, es. openssl rand -hex 32)')
  return key
}

export const isEncrypted = (v: string) => ENCRYPTED_RE.test(v)

/** Il campo (es. "patient_name") entra nella cifratura: un valore non si può spostare in un'altra colonna. */
export function encryptWith(key: Buffer, plain: string, field: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(field))
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')
}

export function decryptWith(key: Buffer, value: string, field: string): string {
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64url')
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  d.setAAD(Buffer.from(field))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

/** Senza chiave i dati restano in chiaro (installazioni non ancora aggiornate). */
export const encrypt = (plain: string, field: string) => (KEY ? encryptWith(KEY, plain, field) : plain)

export function decrypt(value: string, field: string): string {
  if (!isEncrypted(value)) return value
  if (!KEY) throw new DataKeyError('Dati cifrati ma DATA_KEY non impostata')
  return decryptWith(KEY, value, field)
}

/** La chiave è quella del valore di controllo salvato nelle impostazioni (anche di un backup)? */
export function keyMatchesCheck(key: Buffer, check: string): boolean {
  try {
    return isEncrypted(check) && decryptWith(key, check, CHECK_KEY) === CHECK_TEXT
  } catch {
    return false
  }
}

/** Campi cifrati della tabella appuntamenti. */
export const PATIENT_FIELDS = ['patient_name', 'patient_phone', 'notes'] as const

/**
 * All'avvio: controlla che DATA_KEY sia quella con cui sono stati cifrati i dati (altrimenti si
 * fermerebbe tutto con dati illeggibili o, peggio, cifrati con due chiavi diverse) e cifra gli
 * appuntamenti ancora in chiaro.
 */
export async function initDataCrypto(): Promise<{ encrypted: number; enabled: boolean }> {
  const key = parseDataKey(process.env.DATA_KEY)
  KEY = key
  const check = await getSetting(CHECK_KEY)
  const sample = await pool.query(`SELECT patient_name FROM appointments WHERE patient_name LIKE 'v1:%' LIMIT 1`)
  const encryptedSample: string | undefined = sample.rows[0]?.patient_name

  if (!key) {
    if (check || encryptedSample) {
      throw new DataKeyError(
        'I dati dei pazienti sono cifrati ma DATA_KEY non è impostata: rimetti nel .env la chiave usata finora (DATA_KEY=...) e riavvia.',
      )
    }
    console.warn('DATA_KEY non impostata: i dati dei pazienti sono salvati in chiaro. Esegui ./update.sh per generarla.')
    return { encrypted: 0, enabled: false }
  }

  // Verifica sul valore di controllo oppure, se manca, su un appuntamento già cifrato.
  let ok = true
  try {
    if (check) ok = keyMatchesCheck(key, check)
    else if (encryptedSample && isEncrypted(encryptedSample)) decryptWith(key, encryptedSample, 'patient_name')
  } catch {
    ok = false
  }
  if (!ok) {
    throw new DataKeyError(
      'DATA_KEY non corrisponde alla chiave con cui sono stati cifrati i dati dei pazienti: rimetti nel .env la chiave originale e riavvia.',
    )
  }
  if (!check) await setSetting(CHECK_KEY, encryptWith(key, CHECK_TEXT, CHECK_KEY))

  // Appuntamenti in chiaro (creati prima dell'aggiornamento o ripristinati da un backup vecchio).
  const client = await pool.connect()
  let encrypted = 0
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, ${PATIENT_FIELDS.join(', ')} FROM appointments
       WHERE ${PATIENT_FIELDS.map((f) => `${f} NOT LIKE 'v1:%'`).join(' OR ')} FOR UPDATE`,
    )
    for (const r of rows) {
      const values = PATIENT_FIELDS.map((f) => (isEncrypted(r[f]) ? r[f] : encryptWith(key, r[f], f)))
      await client.query(
        `UPDATE appointments SET ${PATIENT_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [r.id, ...values],
      )
      encrypted++
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  if (encrypted) console.log(`Dati dei pazienti cifrati: ${encrypted} appuntamenti.`)
  return { encrypted, enabled: true }
}
