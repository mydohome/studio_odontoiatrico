// Limite ai tentativi di accesso.
// - nome utente + IP: pochi tentativi (chi prova password da un indirizzo si ferma presto);
// - IP: un tetto agli errori anche cambiando nome utente;
// - nome utente: un tetto più largo contro chi prova da tanti indirizzi diversi. Gli IP da cui
//   l'utente è già entrato non lo subiscono: un attacco non chiude fuori lo studio.
// Ogni tentativo viene contato quando inizia (non quando fallisce): così anche le richieste in
// parallelo rientrano nel limite. Le voci scadute vengono eliminate: inventare nomi utente non
// azzera i contatori degli altri.

export interface LimiterOptions {
  /** Finestra di conteggio in millisecondi. */
  windowMs: number
  /** Tentativi per nome utente dallo stesso IP nella finestra. */
  perUserIp: number
  /** Tentativi per nome utente da IP mai usati con successo da quell'utente. */
  perUser: number
  /** Errori per indirizzo IP nella finestra (qualsiasi nome utente). */
  perIp: number
  /** Per quanto si ricorda un IP da cui l'utente è entrato (millisecondi). */
  knownIpMs?: number
  /** Numero massimo di voci in memoria per tabella (oltre si eliminano le più vecchie). */
  maxEntries?: number
}

interface Entry {
  n: number
  since: number
}

export class LoginLimiter {
  private pairs = new Map<string, Entry>()
  private users = new Map<string, Entry>()
  private ips = new Map<string, Entry>()
  private known = new Map<string, number>()
  private opts: LimiterOptions
  constructor(opts: LimiterOptions) {
    this.opts = opts
  }

  private expired(e: Entry, now: number) {
    return now - e.since >= this.opts.windowMs
  }

  /** Secondi da attendere se la voce ha raggiunto il limite, altrimenti 0. */
  private blocked(map: Map<string, Entry>, key: string, max: number, now: number): number {
    const e = map.get(key)
    if (!e || this.expired(e, now)) return 0
    return e.n >= max ? Math.max(1, Math.ceil((e.since + this.opts.windowMs - now) / 1000)) : 0
  }

  private count(map: Map<string, Entry>, key: string, now: number) {
    const e = map.get(key)
    if (e && !this.expired(e, now)) {
      e.n++
      return
    }
    map.delete(key)
    this.prune(map, now)
    map.set(key, { n: 1, since: now })
  }

  private prune(map: Map<string, Entry | number>, now: number) {
    const max = this.opts.maxEntries ?? 10000
    if (map.size < max) return
    for (const [k, e] of map) {
      if (typeof e === 'number' ? e <= now : this.expired(e, now)) map.delete(k)
    }
    // Ancora troppe: si eliminano le più vecchie (ordine di inserimento).
    for (const k of map.keys()) {
      if (map.size < max) break
      map.delete(k)
    }
  }

  private isKnown(pair: string, now: number) {
    const until = this.known.get(pair)
    return until !== undefined && until > now
  }

  /** Registra un tentativo. Restituisce 0 se è consentito, altrimenti i secondi da attendere. */
  attempt(username: string, ip: string, now = Date.now()): number {
    const user = username.trim().toLowerCase()
    const pair = `${user}\n${ip}`
    const known = this.isKnown(pair, now)
    const wait =
      this.blocked(this.ips, ip, this.opts.perIp, now) ||
      this.blocked(this.pairs, pair, this.opts.perUserIp, now) ||
      (known ? 0 : this.blocked(this.users, user, this.opts.perUser, now))
    if (wait) return wait
    this.count(this.ips, ip, now)
    this.count(this.pairs, pair, now)
    if (!known) this.count(this.users, user, now)
    return 0
  }

  /**
   * Accesso riuscito: il tentativo non conta (più persone dello studio dietro lo stesso IP), la
   * coppia nome utente + IP riparte da zero e l'IP diventa "conosciuto" per quell'utente.
   */
  success(username: string, ip: string, now = Date.now()) {
    const user = username.trim().toLowerCase()
    const pair = `${user}\n${ip}`
    const wasKnown = this.isKnown(pair, now)
    this.pairs.delete(pair)
    const e = this.ips.get(ip)
    if (e && e.n > 0) e.n--
    const u = this.users.get(user)
    if (!wasKnown && u && u.n > 0) u.n--
    this.known.delete(pair)
    this.prune(this.known as Map<string, Entry | number>, now)
    this.known.set(pair, now + (this.opts.knownIpMs ?? 30 * 86400000))
  }
}
