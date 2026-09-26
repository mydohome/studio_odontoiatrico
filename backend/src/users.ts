import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { pool } from './db.ts'

export interface User {
  id: number
  username: string
  email: string | null
  createdAt: string
  lastLogin: string | null
  sessionVersion: number
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

const COLUMNS = `id, username, email, created_at AS "createdAt", last_login AS "lastLogin", session_version AS "sessionVersion"`

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
