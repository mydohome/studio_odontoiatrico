import { Check, Copy, Download, Loader2, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import type { TotpSetup } from '../lib/api.ts'

/** Segreto a gruppi di 4 caratteri, più facile da leggere e da digitare nell'app. */
const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim()

/** Codici di recupero: da salvare ora, non si mostrano più. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continua' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = codes.join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard non disponibile: restano il download e la lettura a video */
    }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`Codici di recupero (ognuno vale una volta sola)\n\n${text}\n`], { type: 'text/plain' }))
    a.download = 'codici-di-recupero.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="tfa-recovery">
      <div className="alert alert-warn small">
        <ShieldCheck size={18} style={{ flex: 'none' }} />
        <span>
          <strong>Salva questi codici di recupero.</strong> Servono se perdi il telefono: ognuno vale una volta sola e non verranno mostrati di nuovo.
        </span>
      </div>
      <ul className="tfa-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="tfa-actions">
        <button type="button" className="btn btn-sm" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiati' : 'Copia'}
        </button>
        <button type="button" className="btn btn-sm" onClick={download}>
          <Download size={15} /> Scarica
        </button>
      </div>
      <label className="small tfa-saved">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Ho salvato i codici in un posto sicuro
      </label>
      <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  )
}

/**
 * Associazione dell'app di verifica: QR code da inquadrare (o segreto da digitare), primo codice per
 * confermare, poi i codici di recupero. Serve sia al primo accesso sia da Impostazioni.
 */
export default function TwoFactorSetup({
  start,
  confirm,
  onFinished,
  finishLabel,
}: {
  start: () => Promise<TotpSetup>
  confirm: (code: string) => Promise<string[]>
  onFinished: () => void
  finishLabel?: string
}) {
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    start()
      .then(async (s) => {
        const url = await QRCode.toDataURL(s.otpauth, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
        if (alive) {
          setSetup(s)
          setQr(url)
        }
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
    // Una sola volta: ogni chiamata genera un nuovo segreto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setCodes(await confirm(code))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={onFinished} doneLabel={finishLabel} />
  if (!setup || !qr) {
    return error ? <div className="alert alert-danger">{error}</div> : <Loader2 className="spin" size={22} />
  }

  return (
    <form className="tfa-setup" onSubmit={submit}>
      <ol className="small tfa-steps">
        <li>Installa sul telefono un'app di verifica (Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Aegis…).</li>
        <li>Nell'app scegli «Aggiungi account» e inquadra questo QR code.</li>
        <li>Scrivi qui il codice a 6 cifre che l'app mostra.</li>
      </ol>
      <img className="tfa-qr" src={qr} alt="QR code per l'app di verifica" width={220} height={220} />
      <details className="small">
        <summary>Non riesci a inquadrarlo?</summary>
        <p className="muted">Nell'app scegli l'inserimento manuale e scrivi questa chiave (account e tipo «a tempo»):</p>
        <code className="tfa-secret">{grouped(setup.secret)}</code>
      </details>
      <input
        className="input tfa-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label="Codice a 6 cifre"
        autoFocus
      />
      {error && <div className="alert alert-danger">{error}</div>}
      <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, '').length !== 6}>
        <ShieldCheck size={16} /> {busy ? 'Verifica…' : 'Conferma e attiva'}
      </button>
    </form>
  )
}
