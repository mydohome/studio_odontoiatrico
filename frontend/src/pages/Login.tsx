import { ArrowLeft, Info, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import TwoFactorSetup from '../components/TwoFactorSetup.tsx'
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
  // Dopo la password: secondo passaggio (codice dell'app) o, se obbligatoria, associazione dell'app.
  const [second, setSecond] = useState<{ step: 'totp' | 'enroll'; ticket: string } | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [remember, setRemember] = useState(true)
  // Dopo l'associazione l'utente è già dentro, ma prima deve salvare i codici di recupero.
  const [enrolledUser, setEnrolledUser] = useState<SessionUser | null>(null)

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
      if (r.ok) onLogin(r.user)
      else {
        setSecond({ step: r.step, ticket: r.ticket })
        setCode('')
        setUseRecovery(false)
        setPassword('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!second) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.login2fa(second.ticket, code, remember)
      onLogin(r.user)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      // Biglietto scaduto (5 minuti): si riparte dalla password.
      if (/scaduto/i.test(msg)) setSecond(null)
    } finally {
      setBusy(false)
    }
  }

  const brand = studio ? (
    <div className="login-brand">
      <StudioMark studio={studio} />
      <div className="login-studio">{studio.name}</div>
    </div>
  ) : (
    <div className="brand">
      <span className="brand-logo">
        <Tooth size={20} />
      </span>
      Accesso allo studio
    </div>
  )

  if (second?.step === 'totp') {
    return (
      <div className="login">
        <form className="card" onSubmit={submitCode}>
          {brand}
          <h2 className="tfa-title">
            <ShieldCheck size={18} /> Verifica in due passaggi
          </h2>
          <label className="small muted" htmlFor="otp">
            {useRecovery ? 'Codice di recupero' : "Codice a 6 cifre dell'app di verifica"}
          </label>
          <input
            id="otp"
            className="input tfa-code-input"
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            maxLength={useRecovery ? 16 : 7}
            placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '000000'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <label className="small tfa-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Ricorda questo dispositivo per 30 giorni
          </label>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary" disabled={busy || !code.trim()}>
            <Lock size={16} /> Entra
          </button>
          <div className="tfa-links">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setUseRecovery((v) => !v)
                setCode('')
                setError(null)
              }}
            >
              <KeyRound size={14} /> {useRecovery ? "Usa il codice dell'app" : 'Ho perso il telefono: codice di recupero'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSecond(null); setError(null) }}>
              <ArrowLeft size={14} /> Indietro
            </button>
          </div>
        </form>
      </div>
    )
  }

  if (second?.step === 'enroll') {
    return (
      <div className="login">
        <div className="card">
          {brand}
          <h2 className="tfa-title">
            <ShieldCheck size={18} /> Attiva la verifica in due passaggi
          </h2>
          <p className="small muted">Lo studio richiede un secondo passaggio per entrare. Si associa una volta sola, poi basta il codice dell'app.</p>
          <TwoFactorSetup
            start={() => api.enrollSetup(second.ticket)}
            confirm={async (c) => {
              const r = await api.enrollEnable(second.ticket, c)
              setEnrolledUser(r.user)
              return r.recoveryCodes
            }}
            onFinished={() => enrolledUser && onLogin(enrolledUser)}
            finishLabel="Entra"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        {studio ? (
          <div className="login-brand">
            <StudioMark studio={studio} />
            <div className="login-studio">{studio.name}</div>
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
