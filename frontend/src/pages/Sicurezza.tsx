import { KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { RecoveryCodes } from '../components/TwoFactorSetup.tsx'
import TwoFactorSetup from '../components/TwoFactorSetup.tsx'
import { useToast } from '../components/Toast.tsx'
import { api, type SecurityState } from '../lib/api.ts'

const SESSION_LABEL: Record<number, string> = {
  1: '1 giorno',
  7: '7 giorni',
  30: '30 giorni',
  90: '90 giorni',
  0: 'Nessuna scadenza',
}

/** Richiesta di conferma con password (e, se serve, un codice) per le operazioni delicate. */
function Confirm({
  title,
  needCode,
  busyLabel,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string
  needCode?: boolean
  busyLabel: string
  submitLabel: string
  onSubmit: (password: string, code: string) => Promise<void>
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password, code)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="sec-confirm" onSubmit={submit}>
      <strong>{title}</strong>
      <label className="small muted">
        La tua password
        <input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {needCode && (
        <label className="small muted">
          Codice dell'app (o codice di recupero)
          <input className="input" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} />
        </label>
      )}
      {error && <div className="alert alert-danger small">{error}</div>}
      <div className="settings-row">
        <button className="btn btn-primary" disabled={busy || !password || (needCode && !code.trim())}>
          {busy ? busyLabel : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
      </div>
    </form>
  )
}

type Mode = null | 'password' | 'setup' | 'recovery-pw' | 'recovery' | 'disable'

export default function Sicurezza() {
  const notify = useToast()
  const [state, setState] = useState<SecurityState | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  // Password inserita per iniziare l'associazione (serve per generare il segreto) e codici da mostrare.
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      setState(await api.security())
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  if (!state) return <div className="card muted">Caricamento…</div>

  const save = async (patch: { require2fa?: boolean; sessionDays?: number }, ok: string) => {
    try {
      setState(await api.securitySettings(patch))
      notify(ok)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="settings-narrow grid">
      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={18} /> Verifica in due passaggi
        </h2>
        <p className="sub">
          Oltre alla password serve un codice a 6 cifre che cambia ogni 30 secondi, generato da un'app sul telefono (Google Authenticator, Microsoft Authenticator, Authy, 2FAS…).
        </p>

        {mode === null && !state.totpEnabled && (
          <div className="settings-row">
            <button className="btn btn-primary" onClick={() => setMode('password')}>
              <ShieldCheck size={16} /> Attiva la verifica in due passaggi
            </button>
          </div>
        )}
        {mode === 'password' && (
          <Confirm
            title="Per iniziare conferma la password"
            busyLabel="Controllo…"
            submitLabel="Continua"
            onSubmit={async (pw) => {
              // La password serve anche a generare il segreto: la si tiene fino al QR code.
              setPassword(pw)
              setMode('setup')
            }}
            onCancel={() => setMode(null)}
          />
        )}
        {mode === 'setup' && (
          <TwoFactorSetup
            start={() =>
              api.securitySetup(password).catch((e) => {
                setMode('password')
                notify((e as Error).message, 'error')
                throw e
              })
            }
            confirm={async (code) => {
              const r = await api.securityEnable(code)
              setState(r)
              return r.recoveryCodes
            }}
            onFinished={() => {
              setPassword('')
              setMode(null)
              notify('Verifica in due passaggi attivata')
            }}
            finishLabel="Fatto"
          />
        )}

        {state.totpEnabled && mode === null && (
          <>
            <p>
              <span className="badge badge-good">Attiva</span>{' '}
              <span className="small muted">
                {state.recoveryLeft} codic{state.recoveryLeft === 1 ? 'e' : 'i'} di recupero {state.recoveryLeft === 1 ? 'rimasto' : 'rimasti'}
              </span>
            </p>
            {state.recoveryLeft <= 2 && (
              <div className="alert alert-warn small">Pochi codici di recupero: generane di nuovi, così non resti chiuso fuori se perdi il telefono.</div>
            )}
            <div className="settings-row">
              <button className="btn" onClick={() => setMode('recovery-pw')}>
                <KeyRound size={16} /> Nuovi codici di recupero
              </button>
              <button
                className="btn btn-danger"
                onClick={() => setMode('disable')}
                disabled={state.require2fa}
                title={state.require2fa ? "È obbligatoria per tutti: togli prima l'obbligo (più sotto)" : undefined}
              >
                <ShieldOff size={16} /> Disattiva
              </button>
            </div>
          </>
        )}
        {mode === 'recovery-pw' && (
          <Confirm
            title="Genera nuovi codici di recupero (i vecchi non valgono più)"
            busyLabel="Genero…"
            submitLabel="Genera"
            onSubmit={async (pw) => {
              setCodes((await api.securityRecovery(pw)).recoveryCodes)
              setMode('recovery')
              load()
            }}
            onCancel={() => setMode(null)}
          />
        )}
        {mode === 'recovery' && <RecoveryCodes codes={codes} onDone={() => { setCodes([]); setMode(null) }} doneLabel="Fatto" />}
        {mode === 'disable' && (
          <Confirm
            title="Disattivare la verifica in due passaggi?"
            needCode
            busyLabel="Disattivo…"
            submitLabel="Disattiva"
            onSubmit={async (pw, code) => {
              setState(await api.securityDisable(pw, code))
              setMode(null)
              notify('Verifica in due passaggi disattivata')
            }}
            onCancel={() => setMode(null)}
          />
        )}
      </div>

      <div className="card">
        <h2>Accesso di tutti gli utenti</h2>
        <div className="setting-toggle">
          <div>
            <label htmlFor="require2fa">Richiedi la verifica in due passaggi a tutti</label>
            <p className="small muted">
              Chi non l'ha ancora attivata dovrà associare l'app al prossimo accesso, prima di entrare.
              {state.withoutTotp > 0 && ` Oggi non ce l'hanno ${state.withoutTotp} ${state.withoutTotp === 1 ? 'utente' : 'utenti'}.`}
              {!state.totpEnabled && ' Per poterla imporre attivala prima sul tuo account.'}
            </p>
          </div>
          <label className="switch">
            <input
              id="require2fa"
              type="checkbox"
              checked={state.require2fa}
              disabled={!state.totpEnabled && !state.require2fa}
              onChange={(e) => save({ require2fa: e.target.checked }, e.target.checked ? 'Verifica obbligatoria per tutti' : 'Verifica non più obbligatoria')}
            />
            <span />
          </label>
        </div>
        <div className="setting-toggle">
          <div>
            <label htmlFor="session-days">Durata della sessione</label>
            <p className="small muted">
              Per quanto resta collegato un dispositivo senza chiedere di nuovo la password. Si rinnova a ogni uso: scade solo se il dispositivo non viene usato per questo periodo.
              {state.sessionDays === 0 && ' Senza scadenza resta collegato finché non esce o non lo disconnetti (fino a 400 giorni di inattività).'}
            </p>
          </div>
          <select
            id="session-days"
            className="input"
            style={{ width: 'auto' }}
            value={state.sessionDays}
            onChange={(e) => save({ sessionDays: Number(e.target.value) }, 'Durata della sessione salvata')}
          >
            {state.sessionChoices.map((d) => (
              <option key={d} value={d}>
                {SESSION_LABEL[d] ?? `${d} giorni`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Dispositivi collegati</h2>
        <p className="sub">
          Smarrito o rubato un telefono o un computer? Disconnetti tutti gli altri dispositivi: dovranno rifare l'accesso (e il codice dell'app). Questo dispositivo resta collegato. Se non puoi
          farlo da qui, l'amministratore del server può farlo con <code>./studio user logout</code>.
        </p>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!window.confirm('Disconnettere tutti gli altri dispositivi dal tuo account?')) return
            try {
              await api.securityLogoutOthers()
              notify('Gli altri dispositivi sono stati disconnessi')
            } catch (e) {
              notify((e as Error).message, 'error')
            }
          }}
        >
          <LogOut size={16} /> Disconnetti gli altri dispositivi
        </button>
      </div>
    </div>
  )
}
