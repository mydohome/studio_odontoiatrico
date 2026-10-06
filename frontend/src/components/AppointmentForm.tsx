import { AlertTriangle, CalendarX2, Save, X } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { CATEGORIES } from '../../../shared/catalog.ts'
import { endTime } from '../../../shared/appointments.ts'
import { formatDay } from '../../../shared/dates.ts'
import type { AppointmentInput, Doctor, ScheduledAppointment, Service } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { overlapping } from '../lib/appointments.ts'

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180]

interface Props {
  title: string
  initial: AppointmentInput
  /** Appuntamento in modifica (per escluderlo dal controllo delle sovrapposizioni). */
  editingId?: number
  /** Se cambiano data o ora di un appuntamento già confermato, la conferma va richiesta di nuovo. */
  wasConfirmed?: boolean
  services: Service[]
  doctors: Doctor[]
  /** Da riprogrammare: data e ora che aveva (si sceglie la nuova). */
  previous?: { day: string; time: string } | null
  onSubmit: (value: AppointmentInput, prepareMessage: boolean) => Promise<void>
  /** Mette l'appuntamento "da riprogrammare" (senza data e ora); solo per quelli in agenda. */
  onReschedule?: () => Promise<void>
  onClose: () => void
}

export default function AppointmentForm({ title, initial, editingId, wasConfirmed, services, doctors, previous, onSubmit, onReschedule, onClose }: Props) {
  const [v, setV] = useState<AppointmentInput>(initial)
  // Nuovo appuntamento o nuova data dopo una riprogrammazione: il messaggio va inviato.
  const [prepare, setPrepare] = useState(editingId === undefined || !!previous)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [patients, setPatients] = useState<{ name: string; phone: string }[]>([])
  const [sameDay, setSameDay] = useState<ScheduledAppointment[]>([])
  const set = <K extends keyof AppointmentInput>(k: K, val: AppointmentInput[K]) => setV((x) => ({ ...x, [k]: val }))

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    api.patients().then(setPatients).catch(() => {})
  }, [])

  // Appuntamenti dello stesso giorno, per segnalare le sovrapposizioni.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return
    let alive = true
    api
      .appointments(v.day, v.day)
      .then((l) => alive && setSameDay(l))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [v.day])

  const clashes = /^\d{2}:\d{2}$/.test(v.time) ? overlapping(sameDay, v.day, v.time, v.duration, editingId) : []
  const moved = wasConfirmed && (v.day !== initial.day || v.time !== initial.time)

  // Scegliendo un paziente già noto si compila il telefono.
  const pickName = (name: string) => {
    set('patientName', name)
    const p = patients.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (p && !v.patientPhone.trim()) set('patientPhone', p.phone)
  }

  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        items: services.filter((s) => s.category === c.id && (s.active || s.id === initial.serviceId)),
      })).filter((g) => g.items.length),
    [services, initial.serviceId],
  )

  // Medici attivi (più quello già assegnato, se nel frattempo è stato disattivato).
  const choosable = doctors.filter((d) => d.active || d.id === initial.doctorId)

  const reschedule = async () => {
    if (!onReschedule) return
    if (!window.confirm(`Mettere l'appuntamento di ${initial.patientName} da riprogrammare? Data e ora vengono tolte dall'agenda.`)) return
    setBusy(true)
    try {
      await onReschedule()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSubmit({ ...v, patientName: v.patientName.trim(), patientPhone: v.patientPhone.trim(), notes: v.notes.trim() }, prepare)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="af-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal-dialog" onSubmit={submit}>
        <div className="modal-head">
          <h2 id="af-title">{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body form-grid">
          {previous && (
            <div className="alert alert-resched small span-2">
              <CalendarX2 size={18} style={{ flex: 'none' }} />
              <span>
                Da riprogrammare: era {formatDay(previous.day)} alle {previous.time}. Scegli la nuova data e ora.
              </span>
            </div>
          )}
          <label>
            Data
            <input className="input" type="date" required value={v.day} onChange={(e) => set('day', e.target.value)} />
          </label>
          <div className="row-2">
            <label>
              Ora
              <input className="input" type="time" required step={300} value={v.time} onChange={(e) => set('time', e.target.value)} />
            </label>
            <label>
              Durata
              <select className="input" value={v.duration} onChange={(e) => set('duration', Number(e.target.value))}>
                {[...new Set([...DURATIONS, v.duration])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ''}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Paziente (nome e cognome)
            <input
              className="input"
              required
              list="patients-list"
              autoComplete="off"
              maxLength={80}
              value={v.patientName}
              onChange={(e) => pickName(e.target.value)}
              placeholder="es. Mario Rossi"
            />
            <datalist id="patients-list">
              {patients.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.phone}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            Telefono (WhatsApp)
            <input
              className="input"
              type="tel"
              inputMode="tel"
              required
              maxLength={20}
              value={v.patientPhone}
              onChange={(e) => set('patientPhone', e.target.value)}
              placeholder="es. 333 1234567"
            />
          </label>

          <label className="span-2">
            Prestazione
            <select className="input" value={v.serviceId ?? ''} onChange={(e) => set('serviceId', e.target.value || null)}>
              <option value="">— Non specificata —</option>
              {groups.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {g.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {choosable.length > 0 && (
            <div className="span-2 doctor-pick" role="group" aria-label="Medico">
              <span className="doctor-pick-label">Medico</span>
              <div className="doctor-chips">
                <button type="button" className="doctor-chip" aria-pressed={v.doctorId === null} onClick={() => set('doctorId', null)}>
                  Nessuno
                </button>
                {choosable.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="doctor-chip"
                    aria-pressed={v.doctorId === d.id}
                    style={{ '--doc': d.color } as CSSProperties}
                    onClick={() => set('doctorId', d.id)}
                  >
                    <span className="doctor-chip-dot" /> {d.name}
                    {!d.active && ' (non attivo)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="span-2">
            Note interne (non compaiono nel messaggio)
            <textarea className="input" rows={2} maxLength={1000} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {clashes.length > 0 && (
            <div className="alert alert-warn span-2">
              <AlertTriangle size={18} style={{ flex: 'none' }} />
              <span>
                Si sovrappone a:{' '}
                {clashes.map((c) => `${c.time}–${endTime(c.time, c.duration)} ${c.patientName}`).join(', ')}.
              </span>
            </div>
          )}
          {moved && (
            <div className="alert alert-warn span-2">
              <AlertTriangle size={18} style={{ flex: 'none' }} />
              <span>Cambiando data o ora la conferma del paziente viene annullata: andrà inviato un nuovo messaggio.</span>
            </div>
          )}
          {error && <div className="alert alert-danger span-2">{error}</div>}
        </div>

        <div className="modal-foot appt-form-foot">
          {onReschedule && (
            <button type="button" className="btn btn-resched" onClick={reschedule} disabled={busy} title="Il paziente deve spostare l'appuntamento: si toglie dall'agenda e va in «Da riprogrammare»">
              <CalendarX2 size={16} /> Da riprogrammare
            </button>
          )}
          <label className="small muted appt-prepare">
            <input type="checkbox" checked={prepare} onChange={(e) => setPrepare(e.target.checked)} />
            Poi prepara il messaggio WhatsApp
          </label>
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy || !v.patientName.trim() || !v.patientPhone.trim()}>
            <Save size={16} /> {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  )
}
