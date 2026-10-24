// Pagina pubblica «richiesta di appuntamento» (dominio dedicato, senza accesso): il cliente lascia
// nome, telefono e un breve testo; lo studio lo richiama. Nessun dato dell'agenda è visibile.
// Il codice del modulo scade in 10 minuti: finché il cliente scrive viene rinnovato in automatico.

import { CheckCircle2, Loader2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { LIMITS, MIN_FILL_MS, SLOT_LABEL, SLOTS, type BookingSession, type WebSlot } from '../../../shared/webRequests.ts'
import { api } from '../lib/api.ts'
import './prenota.css'

const RENEW_BEFORE_MS = 2 * 60_000

export default function Prenota() {
  const [session, setSession] = useState<BookingSession | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [form, setForm] = useState({ name: '', surname: '', phone: '', message: '', slot: 'indifferente' as WebSlot, consent: false, website: '' })
  const renewing = useRef(false)

  useEffect(() => {
    document.title = 'Richiesta di appuntamento'
    for (const [name, content] of [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']]) {
      if (!document.head.querySelector(`meta[name="${name}"]`)) {
        const m = document.createElement('meta')
        m.name = name
        m.content = content
        document.head.appendChild(m)
      }
    }
  }, [])

  const open = useCallback(async () => {
    try {
      setSession(await api.bookingSession())
    } catch (e) {
      setFatal((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void open()
  }, [open])

  // Orologio, rinnovo del codice poco prima della scadenza e nuovo codice se è scaduto.
  useEffect(() => {
    if (!session || sent) return
    const t = setInterval(async () => {
      const n = Date.now()
      setNow(n)
      if (renewing.current || session.expiresAt - n > RENEW_BEFORE_MS) return
      renewing.current = true
      try {
        setSession(await api.bookingRenew(session.token))
      } catch {
        // Scaduto o già usato: si riparte con un codice nuovo, i campi compilati restano.
        await open()
      } finally {
        renewing.current = false
      }
    }, 1000)
    return () => clearInterval(t)
  }, [session, sent, open])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const ready = session ? now - session.startedAt >= MIN_FILL_MS : false

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!session || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.bookingSubmit({ token: session.token, ...form })
      setSent(true)
      setForm({ name: '', surname: '', phone: '', message: '', slot: 'indifferente', consent: false, website: '' })
    } catch (err) {
      setError((err as Error).message)
      // Codice scaduto o già usato: ne serve uno nuovo per riprovare.
      if ((err as { status?: number }).status === 410) await open()
    } finally {
      setBusy(false)
    }
  }

  if (fatal) {
    return (
      <div className="login booking">
        <div className="card">
          <h2>Richiesta di appuntamento</h2>
          <div className="alert alert-warn">{fatal}</div>
        </div>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="login booking">
        <Loader2 className="spin" aria-label="Caricamento" />
      </div>
    )
  }
  const { studio } = session

  if (sent) {
    return (
      <div className="login booking">
        <div className="card booking-done">
          <CheckCircle2 size={44} color="var(--good, #1a8a4a)" style={{ justifySelf: 'center' }} />
          <h2>Richiesta inviata</h2>
          <p>Grazie! {studio.name} ti richiamerà per concordare l'appuntamento.</p>
          {studio.phone && <p className="small muted">Se è urgente telefona al {studio.phone}.</p>}
          <p className="small muted">Puoi chiudere questa pagina.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login booking">
      <form className="card" onSubmit={submit} autoComplete="on">
        <div className="login-brand">
          <div className="login-studio">{studio.name}</div>
          <div className="small muted">Richiesta di appuntamento</div>
        </div>
        <p className="small muted">Lascia i tuoi dati: ti richiamiamo per fissare giorno e ora. Questa non è una prenotazione confermata.</p>
        <div className="booking-row">
          <label className="field-label">
            Nome
            <input className="input" required maxLength={LIMITS.name} autoComplete="given-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field-label">
            Cognome
            <input className="input" required maxLength={LIMITS.surname} autoComplete="family-name" value={form.surname} onChange={(e) => set('surname', e.target.value)} />
          </label>
        </div>
        <label className="field-label">
          Telefono
          <input className="input" required type="tel" inputMode="tel" maxLength={LIMITS.phone} autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="field-label">
          Di cosa hai bisogno?
          <textarea className="input" maxLength={LIMITS.message} value={form.message} onChange={(e) => set('message', e.target.value)} />
          <span className="small muted">Basta una breve descrizione (es. «controllo», «mal di denti»). Non scrivere dati sulla tua salute: ne parleremo al telefono.</span>
        </label>
        <fieldset className="booking-slots">
          <legend>Quando preferisci essere richiamato/a?</legend>
          {SLOTS.map((s) => (
            <label key={s}>
              <input type="radio" name="slot" checked={form.slot === s} onChange={() => set('slot', s)} /> {SLOT_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <div className="booking-trap" aria-hidden="true">
          <label>
            Sito web
            <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={(e) => set('website', e.target.value)} />
          </label>
        </div>
        <label className="booking-consent">
          <input type="checkbox" required checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
          <span>
            Ho letto l'
            <a href={session.privacyUrl} target="_blank" rel="noopener noreferrer">
              informativa sulla privacy
            </a>{' '}
            e acconsento al trattamento dei miei dati per essere ricontattato/a.
          </span>
        </label>
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !ready || !form.consent}>
          {busy ? 'Invio…' : 'Invia richiesta'}
        </button>
        <p className="small muted" style={{ textAlign: 'center' }}>
          {studio.phone ? `Oppure telefona al ${studio.phone}.` : null}
        </p>
      </form>
    </div>
  )
}
