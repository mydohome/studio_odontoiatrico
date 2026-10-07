// Sicurezza dell'account, per l'utente collegato: verifica in due passaggi, codici di recupero,
// durata delle sessioni e disconnessione degli altri dispositivi.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { LoginLimiter } from './loginLimiter.ts'
import { setSetting } from './db.ts'
import { normalizeRecovery, otpauthUrl } from './totp.ts'
import {
  checkTotp,
  confirmPassword,
  countWithoutTotp,
  disableTotp,
  enableTotp,
  endSessionsById,
  getUserById,
  pendingSecret,
  recoveryLeft,
  regenerateRecovery,
  startTotpSetup,
  useRecoveryCode,
  type User,
} from './users.ts'

class SecurityError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export interface SecurityDeps {
  sessionUser: (req: FastifyRequest) => Promise<User | null>
  setSession: (reply: FastifyReply, req: FastifyRequest, user: User) => Promise<void>
  securitySettings: () => Promise<{ require2fa: boolean; sessionDays: number }>
  forgetSecuritySettings: () => void
  clientIp: (req: FastifyRequest) => string
  limiter: LoginLimiter
  totpLimiter: LoginLimiter
  studioName: () => Promise<string>
}

/** Giorni di durata della sessione tra cui scegliere (0 = nessuna scadenza). */
export const SESSION_CHOICES = [1, 7, 30, 90, 0]

export function registerSecurity(app: FastifyInstance, d: SecurityDeps) {
  const me = async (req: FastifyRequest): Promise<User> => {
    const u = await d.sessionUser(req)
    if (!u) throw new SecurityError('Accesso richiesto', 401)
    return u
  }

  /** Operazioni delicate: si richiede di nuovo la password (con lo stesso limite dei tentativi dell'accesso). */
  const askPassword = async (req: FastifyRequest, reply: FastifyReply, user: User, password: unknown) => {
    const wait = d.limiter.attempt(user.username, d.clientIp(req))
    if (wait) {
      reply.header('retry-after', String(wait))
      throw new SecurityError(`Troppi tentativi: riprova tra ${Math.ceil(wait / 60)} minuti.`, 429)
    }
    if (!(await confirmPassword(user.id, String(password ?? '')))) throw new SecurityError('Password errata.', 403)
    d.limiter.success(user.username, d.clientIp(req))
  }

  /** Codice dell'app o di recupero (per disattivare la verifica). */
  const askCode = async (req: FastifyRequest, reply: FastifyReply, user: User, code: unknown) => {
    const wait = d.totpLimiter.attempt(user.username, d.clientIp(req))
    if (wait) {
      reply.header('retry-after', String(wait))
      throw new SecurityError(`Troppi tentativi: riprova tra ${Math.ceil(wait / 60)} minuti.`, 429)
    }
    const c = String(code ?? '').trim()
    const ok = /^[\d\s]{6,7}$/.test(c) ? await checkTotp(user.id, c) : normalizeRecovery(c).length === 12 && (await useRecoveryCode(user.id, c))
    if (!ok) throw new SecurityError('Codice non corretto.', 403)
    d.totpLimiter.success(user.username, d.clientIp(req))
  }

  const state = async (user: User) => {
    const s = await d.securitySettings()
    return {
      totpEnabled: !!user.totpEnabledAt,
      recoveryLeft: user.totpEnabledAt ? await recoveryLeft(user.id) : 0,
      require2fa: s.require2fa,
      sessionDays: s.sessionDays,
      sessionChoices: SESSION_CHOICES,
      // Quanti utenti non hanno ancora la verifica (chi, all'obbligo, dovrà associare l'app al prossimo accesso).
      withoutTotp: await countWithoutTotp(),
    }
  }

  app.get('/api/security', async (req) => state(await me(req)))

  // 1. Si chiede la password e si genera il segreto da inquadrare con l'app.
  app.post('/api/security/2fa/setup', async (req, reply) => {
    const user = await me(req)
    await askPassword(req, reply, user, (req.body as { password?: string } | null)?.password)
    const secret = await startTotpSetup(user.id)
    return { secret, otpauth: otpauthUrl(user.username, await d.studioName(), secret) }
  })

  // 2. Il primo codice dell'app conferma l'associazione: solo allora la verifica si attiva.
  app.post('/api/security/2fa/enable', async (req, reply) => {
    const user = await me(req)
    const wait = d.totpLimiter.attempt(user.username, d.clientIp(req))
    if (wait) {
      reply.header('retry-after', String(wait))
      throw new SecurityError(`Troppi tentativi: riprova tra ${Math.ceil(wait / 60)} minuti.`, 429)
    }
    if (!(await pendingSecret(user.id))) throw new SecurityError('Ricomincia: genera di nuovo il QR code.')
    const recoveryCodes = await enableTotp(user.id, String((req.body as { code?: string } | null)?.code ?? ''))
    d.totpLimiter.success(user.username, d.clientIp(req))
    return { recoveryCodes, ...(await state((await getUserById(user.id))!)) }
  })

  app.post('/api/security/2fa/recovery', async (req, reply) => {
    const user = await me(req)
    await askPassword(req, reply, user, (req.body as { password?: string } | null)?.password)
    return { recoveryCodes: await regenerateRecovery(user.id) }
  })

  app.post('/api/security/2fa/disable', async (req, reply) => {
    const user = await me(req)
    const b = (req.body ?? {}) as { password?: string; code?: string }
    if (!user.totpEnabledAt) throw new SecurityError('La verifica in due passaggi non è attiva.')
    if ((await d.securitySettings()).require2fa) {
      throw new SecurityError("La verifica è obbligatoria per tutti: togli prima l'obbligo.", 409)
    }
    await askPassword(req, reply, user, b.password)
    await askCode(req, reply, user, b.code)
    // Disattivare chiude le sessioni: questo dispositivo ne riceve una nuova.
    const fresh = await disableTotp(user.id)
    await d.setSession(reply, req, fresh)
    return state(fresh)
  })

  // Disconnette tutti gli altri dispositivi (ad esempio dopo un furto o uno smarrimento).
  app.post('/api/security/logout-others', async (req, reply) => {
    const user = await me(req)
    const fresh = await endSessionsById(user.id)
    await d.setSession(reply, req, fresh)
    return { ok: true }
  })

  app.put('/api/security/settings', async (req) => {
    const user = await me(req)
    const b = (req.body ?? {}) as { require2fa?: unknown; sessionDays?: unknown }
    if (b.require2fa !== undefined) {
      if (typeof b.require2fa !== 'boolean') throw new SecurityError('Valore non valido.')
      // Chi lo impone deve averla già attiva: altrimenti si chiuderebbe fuori da solo.
      if (b.require2fa && !user.totpEnabledAt) throw new SecurityError('Attiva prima la verifica in due passaggi sul tuo account.', 409)
      await setSetting('require2fa', b.require2fa ? 'true' : 'false')
    }
    if (b.sessionDays !== undefined) {
      if (!SESSION_CHOICES.includes(Number(b.sessionDays))) throw new SecurityError('Durata non valida.')
      await setSetting('sessionDays', String(Number(b.sessionDays)))
    }
    d.forgetSecuritySettings()
    return state((await getUserById(user.id))!)
  })
}
