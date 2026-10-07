// Gestione utenti da riga di comando (usata da manage-users.sh e setup.sh).
//
//   node src/cli.ts list [--json]
//   node src/cli.ts create <utente> [--email <email>]          password letta da stdin
//   node src/cli.ts update <utente> [--username <nuovo>] [--email <email> | --no-email]
//   node src/cli.ts passwd <utente>                            password letta da stdin
//   node src/cli.ts delete <utente>
//   node src/cli.ts exists <utente>                            exit 0 se esiste, 1 se no
//   node src/cli.ts 2fa-start <utente>                         mostra il QR code per associare l'app
//   node src/cli.ts 2fa-confirm <utente>                       primo codice dell'app da stdin: attiva e mostra i codici di recupero
//   node src/cli.ts 2fa-reset <utente>                         toglie la verifica in due passaggi (chiude le sessioni)
//   node src/cli.ts 2fa-require on|off                         obbligo della verifica per tutti
//   node src/cli.ts logout <utente> | logout-all               chiude le sessioni su tutti i dispositivi
//
// La password viene letta dallo standard input (prima riga), così non compare mai
// tra gli argomenti dei processi.

import QRCode from 'qrcode'
import { getSetting, migrate, pool, setSetting } from './db.ts'
import { loadDataKey } from './dataCrypto.ts'
import { otpauthUrl } from './totp.ts'
import {
  checkPassword,
  createUser,
  deleteUser,
  disableTotp,
  enableTotp,
  endSessions,
  findUser,
  listUsers,
  migrateUsers,
  setPassword,
  startTotpSetup,
  updateUser,
  UserError,
} from './users.ts'

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new UserError(`Manca il valore di ${name}`)
  return v
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) throw new UserError('La password va passata sullo standard input.')
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const pw = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]
  return checkPassword(pw)
}

async function readLine(): Promise<string> {
  if (process.stdin.isTTY) throw new UserError('Il codice va passato sullo standard input.')
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0].trim()
}

const fmtDate = (v: string | Date | null) =>
  v ? new Date(v).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'

async function main(argv: string[]): Promise<number> {
  const [cmd, name, ...rest] = argv
  await migrate()
  await migrateUsers()
  // I segreti della verifica in due passaggi sono cifrati con DATA_KEY come i dati dei pazienti.
  loadDataKey()

  switch (cmd) {
    case 'list': {
      const users = await listUsers()
      if (name === '--json' || rest.includes('--json')) {
        console.log(JSON.stringify(users.map(({ sessionVersion: _v, totpEnabledAt, ...u }) => ({ ...u, totp: !!totpEnabledAt }))))
        return 0
      }
      if (!users.length) {
        console.log('Nessun utente configurato.')
        return 0
      }
      const rows = users.map((u) => [u.username, u.email ?? '—', u.totpEnabledAt ? 'sì' : 'no', fmtDate(u.createdAt), fmtDate(u.lastLogin)])
      const head = ['UTENTE', 'EMAIL', '2FA', 'CREATO', 'ULTIMO ACCESSO']
      const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
      const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join('   ')
      console.log(line(head))
      for (const r of rows) console.log(line(r))
      return 0
    }
    case 'exists':
      if (!name) throw new UserError('Indica il nome utente.')
      return (await findUser(name)) ? 0 : 1
    case 'create': {
      if (!name) throw new UserError('Indica il nome utente.')
      const user = await createUser(name, flag(rest, '--email') ?? null, await readPassword())
      console.log(`Utente "${user.username}" creato.`)
      return 0
    }
    case 'update': {
      if (!name) throw new UserError('Indica il nome utente.')
      const changes: { username?: string; email?: string | null } = {}
      const nu = flag(rest, '--username')
      if (nu !== undefined) changes.username = nu
      if (rest.includes('--no-email')) changes.email = null
      else {
        const em = flag(rest, '--email')
        if (em !== undefined) changes.email = em
      }
      if (!Object.keys(changes).length) throw new UserError('Nessuna modifica indicata.')
      const user = await updateUser(name, changes)
      console.log(`Utente "${user.username}" aggiornato.`)
      return 0
    }
    case 'passwd': {
      if (!name) throw new UserError('Indica il nome utente.')
      await setPassword(name, await readPassword())
      console.log(`Password di "${name}" aggiornata: le sessioni aperte sono state chiuse.`)
      return 0
    }
    case 'delete': {
      if (!name) throw new UserError('Indica il nome utente.')
      await deleteUser(name)
      console.log(`Utente "${name}" eliminato.`)
      return 0
    }
    case '2fa-start': {
      if (!name) throw new UserError('Indica il nome utente.')
      const user = await findUser(name)
      if (!user) throw new UserError(`Utente "${name}" non trovato.`)
      const secret = await startTotpSetup(user.id)
      const url = otpauthUrl(user.username, (await getSetting('studioName')) ?? 'Studio Odontoiatrico', secret)
      console.log(await QRCode.toString(url, { type: 'terminal', small: true }))
      console.log(`Segreto (da digitare nell'app se non si può inquadrare): ${secret.replace(/(.{4})/g, '$1 ').trim()}`)
      console.log(`Indirizzo: ${url}`)
      return 0
    }
    case '2fa-confirm': {
      if (!name) throw new UserError('Indica il nome utente.')
      const user = await findUser(name)
      if (!user) throw new UserError(`Utente "${name}" non trovato.`)
      const codes = await enableTotp(user.id, await readLine())
      console.log(`Verifica in due passaggi attivata per "${user.username}".`)
      console.log('\nCodici di recupero (ognuno vale una volta sola; consegnali all\'utente, non verranno mostrati di nuovo):')
      for (const c of codes) console.log(`  ${c}`)
      return 0
    }
    case '2fa-reset': {
      if (!name) throw new UserError('Indica il nome utente.')
      const user = await findUser(name)
      if (!user) throw new UserError(`Utente "${name}" non trovato.`)
      await disableTotp(user.id)
      console.log(`Verifica in due passaggi di "${user.username}" tolta: le sue sessioni sono state chiuse.`)
      if ((await getSetting('require2fa')) === 'true') console.log("L'obbligo è attivo: dovrà associare di nuovo l'app al prossimo accesso.")
      return 0
    }
    case '2fa-require': {
      if (name !== 'on' && name !== 'off') throw new UserError('Usa: 2fa-require on | off')
      await setSetting('require2fa', name === 'on' ? 'true' : 'false')
      console.log(name === 'on' ? 'Verifica in due passaggi obbligatoria per tutti (entro pochi secondi).' : 'Verifica in due passaggi non più obbligatoria.')
      return 0
    }
    case 'logout': {
      if (!name) throw new UserError('Indica il nome utente.')
      await endSessions(name)
      console.log(`"${name}" è stato disconnesso da tutti i dispositivi.`)
      return 0
    }
    case 'logout-all': {
      const n = await endSessions()
      console.log(`${n} utenti disconnessi da tutti i dispositivi.`)
      return 0
    }
    default:
      console.error('Comandi: list | create | update | passwd | delete | exists | 2fa-start | 2fa-confirm | 2fa-reset | 2fa-require | logout | logout-all')
      return 2
  }
}

main(process.argv.slice(2))
  .then(async (code) => {
    await pool.end()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error(e instanceof UserError ? e.message : `Errore: ${(e as Error).message}`)
    await pool.end().catch(() => {})
    process.exit(e instanceof UserError ? 1 : 3)
  })
