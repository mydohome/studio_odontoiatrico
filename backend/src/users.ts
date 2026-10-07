import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { decrypt, encrypt } from './dataCrypto.ts'
import { pool } from './db.ts'
import { hashRecovery, newRecoveryCode, newSecret, RECOVERY_COUNT, verifyTotp } from './totp.ts'

export interface User {
  id: number
  username: string
  email: string | null
  createdAt: string
  lastLogin: string | null
  sessionVersion: number
  /** Quando è stata attivata la verifica in due passaggi (null = non attiva). */
  totpEnabledAt: string | null
}

export class UserError extends Error {}

// Parametri scrypt: ~16 MB di memoria e poche decine di ms per verifica.
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scrypt(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// Hash fittizio: si verifica comunque una password quando l'utente non esiste,
// così i tempi di risposta non rivelano quali nomi utente sono validi.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))

// ---------- Validazione ----------

export function normalizeUsername(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(s)) {
    throw new UserError('Nome utente non valido: 3–32 caratteri tra lettere, numeri, punto, trattino e trattino basso.')
  }
  return s
}

export function normalizeEmail(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new UserError('Email non valida.')
  return s.toLowerCase()
}

export function checkPassword(v: unknown): string {
  const s = String(v ?? '')
  if (s.length < 8) throw new UserError('La password deve avere almeno 8 caratteri.')
  if (s.length > 200) throw new UserError('La password è troppo lunga (massimo 200 caratteri).')
  return s
}

// ---------- Accesso ai dati ----------

const COLUMNS = `id, username, email, created_at AS "createdAt", last_login AS "lastLogin", session_version AS "sessionVersion", totp_enabled_at AS "totpEnabledAt"`

export async function migrateUsers(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              serial PRIMARY KEY,
      username        text NOT NULL,
      email           text,
      password_hash   text NOT NULL,
      session_version integer NOT NULL DEFAULT 1,
      created_at      timestamptz NOT NULL DEFAULT now(),
      last_login      timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
    -- Verifica in due passaggi: segreto (cifrato), segreto in attesa di conferma, ultimo codice usato
    -- (non vale due volte) e impronte dei codici di recupero.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
  `)
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users ORDER BY lower(username)`)
  return rows
}

export async function countUsers(): Promise<number> {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users')
  return rows[0].n
}

export async function findUser(username: string): Promise<User | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users WHERE lower(username) = lower($1)`, [username])
  return rows[0] ?? null
}

export async function getUserById(id: number): Promise<User | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])
  return rows[0] ?? null
}

function uniqueViolation(e: unknown) {
  return (e as { code?: string }).code === '23505'
}

export async function createUser(username: string, email: string | null, password: string): Promise<User> {
  const u = normalizeUsername(username)
  const em = normalizeEmail(email)
  const hash = await hashPassword(checkPassword(password))
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [u, em, hash],
    )
    return rows[0]
  } catch (e) {
    if (uniqueViolation(e)) throw new UserError(`Esiste già un utente "${u}".`)
    throw e
  }
}

/** Modifica nome utente e/o email. `email: null` la rimuove, `undefined` la lascia invariata. */
export async function updateUser(
  username: string,
  changes: { username?: string; email?: string | null },
): Promise<User> {
  const user = await findUser(username)
  if (!user) throw new UserError(`Utente "${username}" non trovato.`)
  const newName = changes.username !== undefined ? normalizeUsername(changes.username) : user.username
  const newEmail = changes.email !== undefined ? normalizeEmail(changes.email) : user.email
  try {
    const { rows } = await pool.query(`UPDATE users SET username = $2, email = $3 WHERE id = $1 RETURNING ${COLUMNS}`, [
      user.id,
      newName,
      newEmail,
    ])
    return rows[0]
  } catch (e) {
    if (uniqueViolation(e)) throw new UserError(`Esiste già un utente "${newName}".`)
    throw e
  }
}

/** Cambia la password e chiude tutte le sessioni aperte dell'utente. */
export async function setPassword(username: string, password: string): Promise<void> {
  const user = await findUser(username)
  if (!user) throw new UserError(`Utente "${username}" non trovato.`)
  const hash = await hashPassword(checkPassword(password))
  await pool.query('UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1', [
    user.id,
    hash,
  ])
}

export async function deleteUser(username: string): Promise<void> {
  const user = await findUser(username)
  if (!user) throw new UserError(`Utente "${username}" non trovato.`)
  if ((await countUsers()) <= 1) {
    throw new UserError("Non puoi eliminare l'unico utente: creane prima un altro, altrimenti nessuno potrebbe più accedere.")
  }
  await pool.query('DELETE FROM users WHERE id = $1', [user.id])
}

/** Controlla la password di un utente già collegato (senza toccare l'ultimo accesso). */
export async function confirmPassword(id: number, password: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [id])
  return verifyPassword(String(password ?? ''), rows[0]?.password_hash ?? (await getDummyHash()))
}

/** Verifica le credenziali; restituisce l'utente oppure null. */
export async function authenticate(username: string, password: string): Promise<User | null> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
    [String(username ?? '').trim()],
  )
  const row = rows[0] as (User & { passwordHash: string }) | undefined
  const ok = await verifyPassword(String(password ?? ''), row?.passwordHash ?? (await getDummyHash()))
  if (!row || !ok) return null
  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [row.id])
  const { passwordHash: _omit, ...user } = row
  return user
}


// ---------- Sessioni ----------

/** Chiude tutte le sessioni (e i dispositivi «ricordati») di un utente, o di tutti. Restituisce quanti utenti. */
export async function endSessions(username?: string): Promise<number> {
  if (username === undefined) {
    const r = await pool.query('UPDATE users SET session_version = session_version + 1')
    return r.rowCount ?? 0
  }
  const user = await findUser(username)
  if (!user) throw new UserError(`Utente "${username}" non trovato.`)
  await pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [user.id])
  return 1
}

/** Chiude le sessioni di un utente e restituisce l'utente aggiornato (per riemettere quella corrente). */
export async function endSessionsById(id: number): Promise<User> {
  const { rows } = await pool.query(`UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING ${COLUMNS}`, [id])
  if (!rows[0]) throw new UserError('Utente non trovato.')
  return rows[0]
}

// ---------- Verifica in due passaggi ----------

interface TotpRow {
  totp_secret: string | null
  totp_pending: string | null
  totp_last_step: string | null
  recovery_codes: string[]
}

async function totpRow(id: number): Promise<TotpRow> {
  const { rows } = await pool.query('SELECT totp_secret, totp_pending, totp_last_step, recovery_codes FROM users WHERE id = $1', [id])
  if (!rows[0]) throw new UserError('Utente non trovato.')
  return rows[0]
}

/** Nuovo segreto in attesa di conferma (si attiva solo con un primo codice giusto). */
export async function startTotpSetup(id: number): Promise<string> {
  const user = await getUserById(id)
  if (!user) throw new UserError('Utente non trovato.')
  if (user.totpEnabledAt) throw new UserError('La verifica in due passaggi è già attiva.')
  const secret = newSecret()
  await pool.query('UPDATE users SET totp_pending = $2 WHERE id = $1', [id, encrypt(secret, 'totp_secret')])
  return secret
}

/** Segreto in attesa di conferma (per mostrarlo di nuovo), se c'è. */
export async function pendingSecret(id: number): Promise<string | null> {
  const r = await totpRow(id)
  return r.totp_pending ? decrypt(r.totp_pending, 'totp_secret') : null
}

const newRecoverySet = () => Array.from({ length: RECOVERY_COUNT }, newRecoveryCode)

async function saveRecovery(id: number, codes: string[]) {
  await pool.query('UPDATE users SET recovery_codes = $2::jsonb WHERE id = $1', [id, JSON.stringify(codes.map(hashRecovery))])
}

/** Conferma l'associazione con il primo codice dell'app: attiva la verifica e restituisce i codici di recupero. */
export async function enableTotp(id: number, code: string, nowMs = Date.now()): Promise<string[]> {
  const r = await totpRow(id)
  if (!r.totp_pending) throw new UserError("Nessuna associazione in corso: ricomincia dall'inizio.")
  const step = verifyTotp(decrypt(r.totp_pending, 'totp_secret'), code, nowMs)
  if (step === null) throw new UserError("Il codice non è corretto. Controlla l'ora del telefono e riprova con quello attuale.")
  const codes = newRecoverySet()
  await pool.query(
    `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2,
       recovery_codes = $3::jsonb WHERE id = $1`,
    [id, step, JSON.stringify(codes.map(hashRecovery))],
  )
  return codes
}

/** Codice dell'app per l'accesso. Lo stesso codice non vale due volte (nemmeno da due richieste insieme). */
export async function checkTotp(id: number, code: string, nowMs = Date.now()): Promise<boolean> {
  const r = await totpRow(id)
  if (!r.totp_secret) return false
  const last = r.totp_last_step === null ? -1 : Number(r.totp_last_step)
  const step = verifyTotp(decrypt(r.totp_secret, 'totp_secret'), code, nowMs, last)
  if (step === null) return false
  const u = await pool.query('UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)', [id, step])
  return u.rowCount === 1
}

/** Codice di recupero (monouso): se è giusto viene tolto dall'elenco. */
export async function useRecoveryCode(id: number, code: string): Promise<boolean> {
  const h = hashRecovery(code)
  // Tolto con un solo comando: due richieste insieme non possono usarlo entrambe.
  const r = await pool.query(
    `UPDATE users SET recovery_codes = recovery_codes - $2::text
     WHERE id = $1 AND recovery_codes ? $2::text`,
    [id, h],
  )
  return r.rowCount === 1
}

export async function recoveryLeft(id: number): Promise<number> {
  const r = await totpRow(id)
  return Array.isArray(r.recovery_codes) ? r.recovery_codes.length : 0
}

/** Nuovi codici di recupero (quelli vecchi smettono di valere). */
export async function regenerateRecovery(id: number): Promise<string[]> {
  const user = await getUserById(id)
  if (!user?.totpEnabledAt) throw new UserError('La verifica in due passaggi non è attiva.')
  const codes = newRecoverySet()
  await saveRecovery(id, codes)
  return codes
}

/** Toglie la verifica in due passaggi e chiude le sessioni (anche i dispositivi «ricordati»). */
export async function disableTotp(id: number): Promise<User> {
  const { rows } = await pool.query(
    `UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
       recovery_codes = '[]'::jsonb, session_version = session_version + 1
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  )
  if (!rows[0]) throw new UserError('Utente non trovato.')
  return rows[0]
}

/** Utenti che hanno la verifica attiva, per sapere se qualcuno resterebbe fuori con l'obbligo. */
export async function countWithoutTotp(): Promise<number> {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE totp_enabled_at IS NULL')
  return rows[0].n
}
