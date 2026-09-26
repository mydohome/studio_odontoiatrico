// Gestione utenti da riga di comando (usata da manage-users.sh e setup.sh).
//
//   node src/cli.ts list [--json]
//   node src/cli.ts create <utente> [--email <email>]          password letta da stdin
//   node src/cli.ts update <utente> [--username <nuovo>] [--email <email> | --no-email]
//   node src/cli.ts passwd <utente>                            password letta da stdin
//   node src/cli.ts delete <utente>
//   node src/cli.ts exists <utente>                            exit 0 se esiste, 1 se no
//
// La password viene letta dallo standard input (prima riga), così non compare mai
// tra gli argomenti dei processi.

import { migrate, pool } from './db.ts'
import {
  checkPassword,
  createUser,
  deleteUser,
  findUser,
  listUsers,
  migrateUsers,
  setPassword,
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

const fmtDate = (v: string | Date | null) =>
  v ? new Date(v).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'

async function main(argv: string[]): Promise<number> {
  const [cmd, name, ...rest] = argv
  await migrate()
  await migrateUsers()

  switch (cmd) {
    case 'list': {
      const users = await listUsers()
      if (name === '--json' || rest.includes('--json')) {
        console.log(JSON.stringify(users.map(({ sessionVersion: _v, ...u }) => u)))
        return 0
      }
      if (!users.length) {
        console.log('Nessun utente configurato.')
        return 0
      }
      const rows = users.map((u) => [u.username, u.email ?? '—', fmtDate(u.createdAt), fmtDate(u.lastLogin)])
      const head = ['UTENTE', 'EMAIL', 'CREATO', 'ULTIMO ACCESSO']
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
    default:
      console.error('Comandi: list | create | update | passwd | delete | exists')
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
