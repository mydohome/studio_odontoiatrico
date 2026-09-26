import { Info, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Tooth } from '../components/Tooth.tsx'
import { api, type SessionUser } from '../lib/api.ts'

export default function Login({ hasUsers, onLogin }: { hasUsers: boolean; onLogin: (u: SessionUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.login(username, password)
      onLogin(r.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-logo">
            <Tooth size={20} />
          </span>
          Accesso allo studio
        </div>
        {!hasUsers && (
          <div className="alert alert-warn">
            <Info size={18} style={{ flex: 'none' }} />
            <span>
              Nessun utente configurato. Sul server esegui <code>./manage-users.sh create</code>.
            </span>
          </div>
        )}
        <label className="small muted" htmlFor="usr">
          Nome utente
        </label>
        <input
          id="usr"
          className="input"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="small muted" htmlFor="pwd">
          Password
        </label>
        <input
          id="pwd"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !username.trim() || !password}>
          <Lock size={16} /> Entra
        </button>
      </form>
    </div>
  )
}
