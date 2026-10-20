// Pagina del modulo Fidelity card: elenco e dettaglio delle carte, programma e nuova carta.
// Lo scanner per lo staff e l'invio al cliente sono in file a parte.

import { Ban, Check, Copy, Pencil, Plus, RefreshCw, RotateCcw, Search, Settings2, Stamp, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { LOYALTY_STATUS_LABEL, type LoyaltyCard, type LoyaltyCardDetail, type LoyaltyProgram, type LoyaltyStatus } from '../../../shared/loyalty.ts'
import { useToast } from '../components/Toast.tsx'
import { ApiError, api } from '../lib/api.ts'
import type { AppDataState } from '../lib/useData.ts'
import { loyaltyApi } from './api.ts'
import StampGrid from './StampGrid.tsx'
import { loyaltyTheme } from './theme.ts'
import './loyalty.css'

const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })

const STATUS_CLS: Record<LoyaltyStatus, string> = { attiva: 'lc-st-active', completata: 'lc-st-done', scaduta: 'lc-st-expired', disattivata: 'lc-st-off' }

export function StatusTag({ status }: { status: LoyaltyStatus }) {
  return <span className={`appt-tag ${STATUS_CLS[status]}`}>{LOYALTY_STATUS_LABEL[status]}</span>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const FILTERS: { id: LoyaltyStatus | 'tutte'; label: string }[] = [
  { id: 'attiva', label: 'Attive' },
  { id: 'completata', label: 'Completate' },
  { id: 'disattivata', label: 'Disattivate' },
  { id: 'tutte', label: 'Tutte' },
]

export default function LoyaltyPage({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [cards, setCards] = useState<LoyaltyCard[] | null>(null)
  const [program, setProgram] = useState<LoyaltyProgram | null>(null)
  const [filter, setFilter] = useState<LoyaltyStatus | 'tutte'>('attiva')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<LoyaltyCardDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingProgram, setEditingProgram] = useState(false)

  const loadList = useCallback(async () => {
    try {
      setCards(await loyaltyApi.list(q.trim(), filter))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }, [q, filter, notify])

  // Ricerca ritardata di un attimo mentre si scrive.
  useEffect(() => {
    const t = window.setTimeout(loadList, q ? 200 : 0)
    return () => window.clearTimeout(t)
  }, [loadList, q])

  useEffect(() => {
    loyaltyApi.program().then(setProgram).catch(() => {})
  }, [])

  useEffect(() => {
    if (selected === null) return setDetail(null)
    let alive = true
    loyaltyApi
      .card(selected)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && notify((e as Error).message, 'error'))
    return () => {
      alive = false
    }
  }, [selected, notify])

  /** Aggiorna il dettaglio aperto e la riga nell'elenco. */
  const applyDetail = (d: LoyaltyCardDetail) => {
    setDetail(d)
    setCards((l) => (l ? l.map((c) => (c.id === d.id ? { ...c, ...d } : c)) : l))
    loadList()
  }

  const shown = cards ?? []
  const active = shown.filter((c) => c.status === 'attiva').length

  return (
    <>
      <div className="page-head page-head-inline">
        <h1>Fidelity card</h1>
        <p>Carta a timbri digitale: ogni visita un timbro, al traguardo il premio.</p>
      </div>

      <div className="lc-summary">
        {program && (
          <span className="badge" title="Programma attivo">
            {program.stampsRequired} timbri = {program.reward}
          </span>
        )}
        {cards && filter === 'attiva' && !q && <span className="badge">{active} attive</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setEditingProgram(true)}>
          <Settings2 size={16} /> Programma
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Nuova carta
        </button>
      </div>

      <div className="lc-layout">
        <section className="card lc-list">
          <div className="lc-list-head">
            <div className="segmented" role="group" aria-label="Stato">
              {FILTERS.map((f) => (
                <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="lc-search">
              <Search size={15} className="muted" />
              <input className="input" placeholder="Cerca cliente, telefono o codice" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca" />
            </label>
          </div>
          {cards === null ? (
            <p className="small muted">Caricamento…</p>
          ) : shown.length === 0 ? (
            <p className="small muted">{q ? 'Nessuna carta con questi criteri.' : 'Nessuna carta: creane una con «Nuova carta».'}</p>
          ) : (
            <ul className="lc-rows">
              {shown.map((c) => (
                <li key={c.id}>
                  <button className={`lc-row ${selected === c.id ? 'is-selected' : ''}`} onClick={() => setSelected(c.id)}>
                    <span className="lc-row-main">
                      <strong>{c.holderName}</strong>
                      <span className="small muted">
                        {c.shortCode.slice(0, 4)}-{c.shortCode.slice(4)} · {c.lastStampAt ? `ultimo timbro ${day(c.lastStampAt)}` : 'nessun timbro'}
                      </span>
                    </span>
                    <span className="lc-row-side small">
                      <StatusTag status={c.status} />
                      <strong className="num">
                        {c.stamps}/{c.stampsRequired}
                      </strong>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lc-detail">
          {detail ? (
            <CardDetail key={detail.id} card={detail} flyerStyle={data.settings.flyerStyle} onChange={applyDetail} />
          ) : (
            <p className="small muted">Scegli una carta dall'elenco per vedere i timbri, aggiungerne o inviarla al cliente.</p>
          )}
        </section>
      </div>

      {creating && (
        <NewCardDialog
          onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false)
            setFilter('attiva')
            setQ('')
            setSelected(d.id)
            setDetail(d)
            notify(`Carta creata per ${d.holderName}`)
            loadList()
          }}
        />
      )}
      {editingProgram && program && (
        <ProgramDialog
          program={program}
          onClose={() => setEditingProgram(false)}
          onSaved={(p) => {
            setProgram(p)
            setEditingProgram(false)
            notify('Programma salvato: vale per le carte create da ora')
          }}
        />
      )}
    </>
  )
}

// ---------- Dettaglio ----------

function CardDetail({ card: c, flyerStyle, onChange }: { card: LoyaltyCardDetail; flyerStyle: 'smile' | 'mint'; onChange: (d: LoyaltyCardDetail) => void }) {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  // Timbro rifiutato per l'attesa: si può comunque aggiungere (correzione) dopo conferma.
  const [blocked, setBlocked] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const theme = loyaltyTheme(flyerStyle)
  const left = Math.max(0, c.stampsRequired - c.stamps)

  const run = async (fn: () => Promise<LoyaltyCardDetail>, ok?: string) => {
    setBusy(true)
    try {
      onChange(await fn())
      if (ok) notify(ok)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const stamp = async (force = false) => {
    setBusy(true)
    setBlocked(null)
    try {
      const r = await loyaltyApi.stamp(c.id, { force })
      onChange(await loyaltyApi.card(c.id))
      notify(r.completed ? `Carta completa! Premio: ${r.card.reward}` : `Timbro aggiunto (${r.card.stamps}/${r.card.stampsRequired})`)
    } catch (e) {
      // Attesa tra due timbri: si propone di aggiungerlo comunque (solo dal dettaglio, per correzioni).
      if (e instanceof ApiError && e.status === 409 && /già dato di recente/.test(e.message)) setBlocked(e.message)
      else notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!c.url) return
    try {
      await navigator.clipboard.writeText(c.url)
      notify('Link copiato')
    } catch {
      notify('Copia non riuscita: seleziona e copia il link a mano', 'error')
    }
  }

  const canStamp = c.status === 'attiva'

  return (
    <div className="lc-detail-body">
      <div className="lc-detail-head">
        <div>
          <h2>{c.holderName}</h2>
          <div className="small muted">
            {c.holderPhone ? <a href={`tel:${c.holderPhone.replace(/[^\d+]/g, '')}`}>{c.holderPhone}</a> : 'Nessun telefono'} · codice{' '}
            <strong className="lc-mono">
              {c.shortCode.slice(0, 4)}-{c.shortCode.slice(4)}
            </strong>
          </div>
        </div>
        <StatusTag status={c.status} />
      </div>

      <div className="lc-visual" style={{ background: theme.bg, color: theme.ink }}>
        <div className="lc-visual-count">
          <strong>{Math.min(c.stamps, c.stampsRequired)}</strong>
          <span style={{ color: theme.sub }}>di {c.stampsRequired} timbri · {c.reward}</span>
        </div>
        <StampGrid stamps={c.stamps} required={c.stampsRequired} style={flyerStyle} />
      </div>

      <div className="lc-actions">
        <button className="btn btn-primary" disabled={busy || !canStamp} onClick={() => stamp(false)}>
          <Stamp size={16} /> Aggiungi timbro
        </button>
        {c.status === 'disattivata' ? (
          <button className="btn" disabled={busy} onClick={() => run(() => loyaltyApi.enable(c.id), 'Carta riattivata')}>
            <RotateCcw size={16} /> Riattiva
          </button>
        ) : (
          <button
            className="btn"
            disabled={busy}
            onClick={() => window.confirm('Disattivare la carta? Il link del cliente smetterà di funzionare (si può riattivare).') && run(() => loyaltyApi.disable(c.id), 'Carta disattivata')}
          >
            <Ban size={16} /> Disattiva
          </button>
        )}
        <button className="btn" onClick={() => setEditing(true)}>
          <Pencil size={16} /> Modifica
        </button>
      </div>
      {blocked && (
        <div className="alert alert-warn small">
          <span>{blocked}</span>
          <button className="btn btn-sm" disabled={busy} onClick={() => stamp(true)}>
            Aggiungi comunque
          </button>
        </div>
      )}
      {c.status === 'completata' && <div className="alert alert-good small">Carta completa: premio da consegnare — {c.reward}.</div>}
      {c.status === 'attiva' && left > 0 && (
        <p className="small muted">
          {left === 1 ? 'Manca 1 timbro' : `Mancano ${left} timbri`} al premio.{c.expiresOn ? ` Valida fino al ${day(`${c.expiresOn}T12:00:00`)}.` : ''}
        </p>
      )}

      <div className="lc-link">
        <div className="field-label">Link della carta</div>
        {c.url ? (
          <>
            <div className="lc-link-row">
              <input className="input" readOnly value={c.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link della carta" />
              <button className="btn" onClick={copy}>
                <Copy size={16} /> Copia
              </button>
            </div>
            <div className="lc-link-actions">
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  window.confirm('Generare un nuovo link? Quello vecchio smetterà subito di funzionare: dovrai mandare il nuovo al cliente.') &&
                  run(() => loyaltyApi.regenerate(c.id), 'Nuovo link generato')
                }
              >
                <RefreshCw size={14} /> Rigenera il link
              </button>
            </div>
          </>
        ) : (
          <div className="alert alert-warn small">
            Dominio delle carte non impostato: aggiungi <code>CARD_BASE_URL=https://carte.tuodominio.it</code> al file <code>.env</code> e riavvia (<code>./studio restart</code>). Vedi il README.
          </div>
        )}
      </div>

      <div>
        <div className="field-label">Storico dei timbri</div>
        {c.history.length === 0 ? (
          <p className="small muted">Nessun timbro ancora.</p>
        ) : (
          <ul className="lc-history">
            {c.history.map((s) => (
              <li key={s.id} className={s.voidedAt ? 'is-voided' : ''}>
                <span>
                  <strong>{when(s.at)}</strong> <span className="muted small">da {s.by ?? '—'}</span>
                  {s.note && <span className="small"> · {s.note}</span>}
                  {s.voidedAt && (
                    <span className="small muted">
                      {' '}
                      · annullato il {when(s.voidedAt)} da {s.voidedBy ?? '—'}
                    </span>
                  )}
                </span>
                {!s.voidedAt && (
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    title="Annulla questo timbro (resta nello storico)"
                    onClick={() => window.confirm('Annullare questo timbro?') && run(() => loyaltyApi.voidStamp(c.id, s.id), 'Timbro annullato')}
                  >
                    <Undo2 size={14} /> Annulla
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Creata il {when(c.createdAt)}
          {c.createdBy ? ` da ${c.createdBy}` : ''} · {c.programName}
        </p>
      </div>

      {editing && (
        <HolderDialog
          card={c}
          onClose={() => setEditing(false)}
          onSaved={(d) => {
            setEditing(false)
            onChange(d)
            notify('Dati salvati')
          }}
        />
      )}
    </div>
  )
}

// ---------- Nuova carta e modifica ----------

function HolderFields({
  name,
  phone,
  consent,
  setName,
  setPhone,
  setConsent,
  patients,
}: {
  name: string
  phone: string
  consent: boolean
  setName: (v: string) => void
  setPhone: (v: string) => void
  setConsent: (v: boolean) => void
  patients: { name: string; phone: string }[]
}) {
  // Scegliendo un paziente già noto si compila il telefono.
  const pick = (v: string) => {
    setName(v)
    const p = patients.find((x) => x.name.toLowerCase() === v.trim().toLowerCase())
    if (p && !phone.trim()) setPhone(p.phone)
  }
  return (
    <div className="modal-body form-grid">
      <label className="span-2">
        Cliente (nome e cognome)
        <input className="input" required list="lc-patients" autoComplete="off" maxLength={80} value={name} onChange={(e) => pick(e.target.value)} placeholder="es. Mario Rossi" autoFocus />
        <datalist id="lc-patients">
          {patients.map((p) => (
            <option key={p.name} value={p.name}>
              {p.phone}
            </option>
          ))}
        </datalist>
      </label>
      <label className="span-2">
        Telefono (WhatsApp)
        <input className="input" type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="es. 333 1234567" />
      </label>
      <label className="span-2 lc-check small">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Consenso alle comunicazioni raccolto (facoltativo: per ora si registra soltanto)
      </label>
    </div>
  )
}

function usePatients() {
  const [patients, setPatients] = useState<{ name: string; phone: string }[]>([])
  useEffect(() => {
    api.patients().then(setPatients).catch(() => {})
  }, [])
  return patients
}

function NewCardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (d: LoyaltyCardDetail) => void }) {
  const patients = usePatients()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onCreated(await loyaltyApi.create({ name, phone, consent }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Nuova carta" onClose={onClose}>
      <form onSubmit={submit}>
        <HolderFields name={name} phone={phone} consent={consent} setName={setName} setPhone={setPhone} setConsent={setConsent} patients={patients} />
        {error && <div className="alert alert-danger" style={{ margin: '0 18px 12px' }}>{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            <Check size={16} /> {busy ? 'Creo…' : 'Crea carta'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function HolderDialog({ card, onClose, onSaved }: { card: LoyaltyCardDetail; onClose: () => void; onSaved: (d: LoyaltyCardDetail) => void }) {
  const patients = usePatients()
  const [name, setName] = useState(card.holderName)
  const [phone, setPhone] = useState(card.holderPhone)
  const [consent, setConsent] = useState(!!card.consentAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await loyaltyApi.update(card.id, { name, phone, consent }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Dati del cliente" onClose={onClose}>
      <form onSubmit={submit}>
        <HolderFields name={name} phone={phone} consent={consent} setName={setName} setPhone={setPhone} setConsent={setConsent} patients={patients} />
        {error && <div className="alert alert-danger" style={{ margin: '0 18px 12px' }}>{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            <Check size={16} /> Salva
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Programma ----------

function ProgramDialog({ program, onClose, onSaved }: { program: LoyaltyProgram; onClose: () => void; onSaved: (p: LoyaltyProgram) => void }) {
  const [name, setName] = useState(program.name)
  const [stamps, setStamps] = useState(String(program.stampsRequired))
  const [reward, setReward] = useState(program.reward)
  const [validDays, setValidDays] = useState(program.validDays === null ? '' : String(program.validDays))
  const [cooldown, setCooldown] = useState(String(program.cooldownHours))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await loyaltyApi.saveProgram({ name, stampsRequired: Number(stamps), reward, validDays: validDays === '' ? null : Number(validDays), cooldownHours: Number(cooldown) }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Programma fedeltà" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <label className="span-2">
            Nome del programma
            <input ref={first} className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Timbri per il premio
            <input className="input" type="number" min={1} max={50} required value={stamps} onChange={(e) => setStamps(e.target.value)} />
          </label>
          <label>
            Ore tra due timbri
            <input className="input" type="number" min={0} max={720} required value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
          </label>
          <label className="span-2">
            Premio
            <input className="input" required maxLength={120} value={reward} onChange={(e) => setReward(e.target.value)} placeholder="es. Igiene professionale gratuita" />
          </label>
          <label className="span-2">
            Validità della carta in giorni (vuoto = senza scadenza)
            <input className="input" type="number" min={1} max={3650} value={validDays} onChange={(e) => setValidDays(e.target.value)} placeholder="es. 365" />
          </label>
          <p className="small muted span-2">Le modifiche valgono per le carte create da ora: quelle già emesse tengono il numero di timbri e il premio di quando sono state create. Le ore tra due timbri valgono per tutte.</p>
          {error && <div className="alert alert-danger span-2">{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy}>
            <Check size={16} /> Salva
          </button>
        </div>
      </form>
    </Modal>
  )
}
