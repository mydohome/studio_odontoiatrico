import { Info, Lock } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Tooth } from '../components/Tooth.tsx'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { StudioLogo } from '../flyer/shapes.tsx'
import { api, type SessionUser, type StudioBrand } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'

/** Logo dello studio: quello caricato, oppure quello pronto scelto nelle impostazioni. */
function StudioMark({ studio }: { studio: StudioBrand }) {
  const custom = useCustomLogo(studio.logoType === 'custom' ? studio.logoVersion : 0)
  if (studio.logoType === 'custom') {
    return <span className="login-logo">{custom && <img src={custom} alt="" />}</span>
  }
  const preview = LOGO_PREVIEWS[studio.flyerStyle ?? 'smile']
  return (
    <span className="login-logo login-logo-tile" style={{ background: preview.bg }}>
      <StudioLogo type={studio.logoType} height={60} colors={preview.colors} />
    </span>
  )
}

export default function Login({
  hasUsers,
  studio,
  onLogin,
}: {
  hasUsers: boolean
  studio?: StudioBrand
  onLogin: (u: SessionUser) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Il nome dello studio anche nella scheda del browser: con più studi aperti si distinguono subito.
  useEffect(() => {
    if (studio?.name) document.title = `${studio.name} · Accesso`
  }, [studio?.name])

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
        {studio ? (
          <div className="login-brand">
            <StudioMark studio={studio} />
            <div className="login-studio">{studio.name}</div>
            <div className="small muted">Accesso riservato · Prestazioni e campagne</div>
          </div>
        ) : (
          <div className="brand">
            <span className="brand-logo">
              <Tooth size={20} />
            </span>
            Accesso allo studio
          </div>
        )}
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
