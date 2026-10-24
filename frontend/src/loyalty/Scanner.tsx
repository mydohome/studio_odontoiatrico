// Scanner per lo staff: la fotocamera legge il QR della carta del cliente (indirizzo o token) e registra
// un timbro; conferma con cliente e conteggio, con possibilità di annullare. In alternativa si scrive
// il codice breve.

import { Camera, CameraOff, Check, Loader2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { StampResult } from '../../../shared/loyalty.ts'
import { useToast } from '../components/Toast.tsx'
import { loyaltyApi } from './api.ts'
import StampGrid from './StampGrid.tsx'
import { loyaltyTheme } from './theme.ts'

/** Lo stesso QR non si rilegge per qualche secondo (la fotocamera lo inquadra di continuo). */
const REPEAT_MS = 5000
const SCAN_EVERY_MS = 120
const MAX_WIDTH = 640

type Outcome = { kind: 'ok'; result: StampResult } | { kind: 'error'; message: string }

export default function Scanner({ flyerStyle, onClose, onStamped }: { flyerStyle: 'smile' | 'mint'; onClose: () => void; onStamped: () => void }) {
  const notify = useToast()
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<'avvio' | 'attiva' | 'errore'>('avvio')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const [voided, setVoided] = useState(false)
  // Valori letti dal ciclo di scansione senza rifarlo a ogni rendering.
  const state = useRef({ busy: false, paused: false, last: '', lastAt: 0 })

  const handle = useCallback(
    async (text: string) => {
      state.current.busy = true
      setBusy(true)
      setVoided(false)
      try {
        const result = await loyaltyApi.scan(text)
        setOutcome({ kind: 'ok', result })
        navigator.vibrate?.(result.completed ? [120, 60, 120, 60, 200] : 120)
        onStamped()
      } catch (e) {
        setOutcome({ kind: 'error', message: (e as Error).message })
        navigator.vibrate?.([200, 80, 200])
      } finally {
        state.current.busy = false
        setBusy(false)
      }
    },
    [onStamped],
  )

  // Fotocamera + lettura del QR (jsQR si carica solo qui, quando serve).
  useEffect(() => {
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('errore')
        setCameraError('La fotocamera richiede una connessione sicura (https): scrivi il codice breve qui sotto.')
        return
      }
      try {
        const [{ default: jsQR }, s] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
        ])
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = video.current
        if (!v) return
        v.srcObject = s
        await v.play().catch(() => {})
        setCamera('attiva')

        const tick = () => {
          if (stopped) return
          const st = state.current
          if (!st.busy && !st.paused && ctx && v.videoWidth > 0) {
            const scale = Math.min(1, MAX_WIDTH / v.videoWidth)
            canvas.width = Math.round(v.videoWidth * scale)
            canvas.height = Math.round(v.videoHeight * scale)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            const now = Date.now()
            if (code?.data && (code.data !== st.last || now - st.lastAt > REPEAT_MS)) {
              st.last = code.data
              st.lastAt = now
              handle(code.data)
            }
          }
          timer = window.setTimeout(tick, SCAN_EVERY_MS)
        }
        tick()
      } catch (e) {
        setCamera('errore')
        const name = (e as DOMException).name
        setCameraError(
          name === 'NotAllowedError'
            ? 'Fotocamera non autorizzata: consenti l\'accesso nelle impostazioni del browser, oppure scrivi il codice breve qui sotto.'
            : name === 'NotFoundError'
              ? 'Nessuna fotocamera trovata: scrivi il codice breve qui sotto.'
              : `Fotocamera non disponibile (${(e as Error).message}): scrivi il codice breve qui sotto.`,
        )
      }
    }
    start()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [handle])

  // Mentre si guarda l'esito la lettura è in pausa: riparte con «Prossima carta».
  useEffect(() => {
    state.current.paused = outcome !== null
  }, [outcome])

  const next = () => {
    setOutcome(null)
    setManual('')
    state.current.last = ''
  }

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    if (manual.trim()) handle(manual.trim())
  }

  const undo = async () => {
    if (outcome?.kind !== 'ok') return
    try {
      await loyaltyApi.voidStamp(outcome.result.card.id, outcome.result.stamp.id)
      setVoided(true)
      notify('Timbro annullato')
      onStamped()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const res = outcome?.kind === 'ok' ? outcome.result : null
  // Dopo l'annullamento il conteggio torna indietro di uno.
  const stampsNow = res ? res.card.stamps - (voided ? 1 : 0) : 0

  return (
    <section className="card lc-scanner">
      <div className="lc-scanner-head">
        <h2>
          <Camera size={18} /> Scanner
        </h2>
        <button className="btn btn-sm" onClick={onClose}>
          <X size={15} /> Chiudi
        </button>
      </div>

      <div className="lc-scanner-view">
        <video ref={video} playsInline muted className={camera === 'attiva' ? '' : 'is-hidden'} />
        {camera === 'attiva' && !outcome && <div className="lc-scanner-frame" aria-hidden />}
        {camera === 'avvio' && (
          <div className="lc-scanner-msg">
            <Loader2 className="spin" size={22} /> Avvio della fotocamera…
          </div>
        )}
        {camera === 'errore' && (
          <div className="lc-scanner-msg">
            <CameraOff size={22} />
            <span>{cameraError}</span>
          </div>
        )}
        {busy && (
          <div className="lc-scanner-busy">
            <Loader2 className="spin" size={28} />
          </div>
        )}
      </div>
      {camera === 'attiva' && !outcome && <p className="small muted lc-scanner-hint">Inquadra il QR code della carta del cliente.</p>}

      {outcome?.kind === 'error' && (
        <div className="lc-result is-error" role="alert">
          <strong>Timbro non dato</strong>
          <span>{outcome.message}</span>
          <button className="btn btn-primary" onClick={next}>
            Prossima carta
          </button>
        </div>
      )}

      {res && (
        <div className={`lc-result ${res.completed && !voided ? 'is-done' : 'is-ok'}`} role="status">
          <div className="lc-result-head">
            <Check size={22} />
            <strong>{voided ? 'Timbro annullato' : res.completed ? 'Carta completa!' : 'Timbro aggiunto'}</strong>
          </div>
          <div className="lc-result-name">{res.card.holderName}</div>
          <div className="lc-result-count">
            {stampsNow} di {res.card.stampsRequired} timbri
          </div>
          {/* Sullo sfondo della carta: i dentini sono chiari sul modello Smile. */}
          <div className="lc-result-visual" style={{ background: loyaltyTheme(flyerStyle).bg }}>
            <StampGrid stamps={stampsNow} required={res.card.stampsRequired} style={flyerStyle} />
          </div>
          {res.completed && !voided && <div className="lc-result-prize">Premio da consegnare: {res.card.reward}</div>}
          <div className="lc-actions">
            <button className="btn btn-primary" onClick={next}>
              Prossima carta
            </button>
            {!voided && (
              <button className="btn" onClick={undo}>
                <Undo2 size={16} /> Annulla timbro
              </button>
            )}
          </div>
        </div>
      )}

      {!outcome && (
        <form className="lc-manual" onSubmit={submitManual}>
          <label className="small muted" htmlFor="lc-code">
            Oppure scrivi il codice breve della carta
          </label>
          <div className="lc-link-row">
            <input id="lc-code" className="input lc-mono" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="es. K7QM-X2PD" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={300} />
            <button className="btn btn-primary" disabled={busy || !manual.trim()}>
              <Check size={16} /> Timbra
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
