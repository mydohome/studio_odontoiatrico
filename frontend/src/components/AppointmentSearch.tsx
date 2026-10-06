import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { formatDay, today } from '../../../shared/dates.ts'
import type { Appointment } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { isScheduled, STATUS, STATUS_ICON } from '../lib/appointments.ts'
import { DoctorBadge } from './DoctorBadge.tsx'
import { ServiceBadge } from './ServiceBadge.tsx'

/** «Prossimi», «Da riprogrammare», «Passati»: stesso ordine dei risultati. */
function groupOf(a: Appointment, today: string): string {
  return !isScheduled(a) ? 'Da riprogrammare' : a.day >= today ? 'Prossimi' : 'Passati'
}

/**
 * Ricerca del paziente negli appuntamenti: mentre si scrive compare l'anteprima degli appuntamenti
 * salvati (anche passati); un clic su uno lo apre. Basta una parte del nome o del cognome, in qualsiasi
 * ordine, oppure il telefono.
 */
export default function AppointmentSearch({ onPick }: { onPick: (a: Appointment) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Appointment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const todayIso = today()

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // Ricerca ritardata di un attimo, così non parte a ogni lettera; le risposte vecchie si scartano.
  useEffect(() => {
    const term = q.trim()
    if (term.replace(/\s/g, '').length < 2) {
      setResults(null)
      setBusy(false)
      setError(null)
      return
    }
    let alive = true
    setBusy(true)
    const t = window.setTimeout(() => {
      api
        .searchAppointments(term)
        .then((r) => {
          if (!alive) return
          setResults(r)
          setError(null)
          setCursor(0)
        })
        .catch((e) => alive && setError((e as Error).message))
        .finally(() => alive && setBusy(false))
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q])

  // Chiude cliccando fuori o con Esc.
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  const pick = (a: Appointment) => {
    setOpen(false)
    onPick(a)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    } else if (results?.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    } else if (e.key === 'Enter' && results?.length) {
      e.preventDefault()
      pick(results[Math.min(cursor, results.length - 1)])
    }
  }

  let lastGroup = ''
  return (
    <div className="appt-search" ref={box}>
      <button className={`btn ${open ? 'is-active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Cerca un paziente negli appuntamenti">
        <Search size={16} /> <span className="appt-search-label">Cerca</span>
      </button>
      {open && (
        <div className="appt-search-panel" role="dialog" aria-label="Cerca un paziente">
          <div className="appt-search-field">
            <Search size={16} className="muted" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Nome, cognome o telefono del paziente"
              autoComplete="off"
              spellCheck={false}
              aria-label="Cerca un paziente"
            />
            {busy ? (
              <Loader2 size={16} className="spin muted" />
            ) : q ? (
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => { setQ(''); input.current?.focus() }} aria-label="Cancella">
                <X size={15} />
              </button>
            ) : null}
          </div>
          <div className="appt-search-results">
            {error && <p className="small appt-search-msg" style={{ color: 'var(--danger)' }}>{error}</p>}
            {!error && results === null && <p className="small muted appt-search-msg">Scrivi almeno due lettere: compaiono gli appuntamenti del paziente.</p>}
            {!error && results?.length === 0 && !busy && <p className="small muted appt-search-msg">Nessun appuntamento trovato per «{q.trim()}».</p>}
            {results?.map((a, i) => {
              const g = groupOf(a, todayIso)
              const head = g !== lastGroup ? g : null
              lastGroup = g
              const Icon = STATUS_ICON[a.status]
              return (
                <div key={a.id}>
                  {head && <div className="appt-search-group">{head}</div>}
                  <button className={`appt-search-item ${i === cursor ? 'is-active' : ''}`} onClick={() => pick(a)} onMouseEnter={() => setCursor(i)}>
                    <span className="appt-search-when">
                      {isScheduled(a) ? (
                        <>
                          <strong>{formatDay(a.day)}</strong>
                          <span className="muted">{a.time}</span>
                        </>
                      ) : (
                        <strong>Senza data</strong>
                      )}
                    </span>
                    <span className="appt-search-main">
                      <strong>{a.patientName}</strong>
                      <span className="appt-search-sub">
                        <DoctorBadge appointment={a} size="sm" />
                        <ServiceBadge appointment={a} size="sm" />
                        <span className={`appt-tag ${STATUS[a.status].cls}`}>
                          <Icon size={12} /> {STATUS[a.status].short}
                        </span>
                      </span>
                      {a.notes && <span className="small muted appt-search-note">{a.notes.replace(/\s+/g, ' ')}</span>}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
