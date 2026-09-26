import { Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Tooth } from '../components/Tooth.tsx'
import { api } from '../lib/api.ts'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onLogin()
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
        <label className="small muted" htmlFor="pwd">
          Password
        </label>
        <input
          id="pwd"
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password}>
          <Lock size={16} /> Entra
        </button>
      </form>
    </div>
  )
}
