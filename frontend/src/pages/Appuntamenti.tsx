import { CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, Loader2, Plus, Send } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { endTime } from '../../../shared/appointments.ts'
import { addDays, formatDay, formatLongDay, formatWeek, fromISO, isValidISO, startOfWeek, today, WEEKDAYS_SHORT } from '../../../shared/dates.ts'
import type { Appointment, AppointmentInput, AppointmentStatus } from '../../../shared/types.ts'
import AppointmentDetail from '../components/AppointmentDetail.tsx'
import AppointmentForm from '../components/AppointmentForm.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { fromMinutes, layoutLanes, STATUS, STATUS_ORDER, toMinutes } from '../lib/appointments.ts'
import type { AppDataState } from '../lib/useData.ts'

type View = 'giorno' | 'settimana'
const VIEW_KEY = 'appuntamentiVista'
const PX_PER_MIN = 1.1
const POLL_MS = 60_000

const STATUS_ICON: Record<AppointmentStatus, typeof Check> = {
  'confermato-link': CheckCheck,
  'confermato-manuale': Check,
  inviato: Clock,
  'da-inviare': Send,
}

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'giorno' ? 'giorno' : 'settimana'
  } catch {
    return 'settimana'
  }
}

function useNarrow(query = '(max-width: 720px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const h = () => setNarrow(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return narrow
}

/** Ora e minuti attuali, aggiornati ogni minuto (linea rossa "adesso"). */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

type FormState = { id?: number; initial: AppointmentInput; wasConfirmed?: boolean } | null

export default function Appuntamenti({ data }: { data: AppDataState }) {
  const notify = useToast()
  const narrow = useNarrow()
  const now = useNow()
  const [view, setView] = useState<View>(loadView)
  const [anchor, setAnchor] = useState(today())
  const [list, setList] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(null)
  const known = useRef<Map<number, AppointmentStatus>>(new Map())

  const from = view === 'giorno' ? anchor : startOfWeek(anchor)
  const to = view === 'giorno' ? anchor : addDays(from, 6)

  const changeView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* preferenza non salvata */
    }
  }

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const l = await api.appointments(from, to)
        // Avvisa delle conferme arrivate dal link mentre la pagina era aperta.
        if (quiet) {
          for (const a of l) {
            const before = known.current.get(a.id)
            if (before && before !== 'confermato-link' && a.status === 'confermato-link') {
              notify(`${a.patientName} ha confermato l'appuntamento di ${formatDay(a.day)} alle ${a.time}`)
            }
          }
        }
        known.current = new Map(l.map((a) => [a.id, a.status]))
        setList(l)
      } catch (e) {
        if (!quiet) notify((e as Error).message, 'error')
      } finally {
        setLoading(false)
      }
    },
    [from, to, notify],
  )

  useEffect(() => {
    load()
  }, [load])

  // Aggiornamento periodico e al ritorno sulla pagina, per vedere le conferme dei pazienti.
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(true), POLL_MS)
    const onFocus = () => load(true)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const replace = (a: Appointment) => {
    known.current.set(a.id, a.status)
    setList((l) => {
      const inRange = a.day >= from && a.day <= to
      const others = l.filter((x) => x.id !== a.id)
      return inRange ? [...others, a].sort((x, y) => x.day.localeCompare(y.day) || x.time.localeCompare(y.time)) : others
    })
  }

  const opened = openId !== null ? list.find((a) => a.id === openId) ?? null : null

  const newAppointment = (day?: string, time?: string) => {
    const t = today()
    const d = day ?? (view === 'giorno' ? anchor : t >= from && t <= to ? t : from)
    let tm = time
    if (!tm) {
      // Oggi: il prossimo quarto d'ora; altri giorni: le 9.
      const n = new Date()
      tm = d === t ? fromMinutes(Math.min(23 * 60 + 45, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15)) : '09:00'
    }
    setForm({ initial: { day: d, time: tm, duration: 30, patientName: '', patientPhone: '', serviceId: null, notes: '' } })
  }

  const submitForm = async (value: AppointmentInput, prepare: boolean) => {
    if (!form) return
    const saved = form.id ? await api.updateAppointment(form.id, value) : await api.createAppointment(value)
    setForm(null)
    notify(form.id ? 'Appuntamento aggiornato' : 'Appuntamento creato')
    // Fuori dal periodo mostrato: la vista si sposta sul giorno dell'appuntamento (e lo ricarica).
    if (saved.day < from || saved.day > to) setAnchor(saved.day)
    else replace(saved)
    // Dopo una modifica si torna al dettaglio; dopo una creazione, se richiesto, si apre il messaggio.
    setOpenId(prepare || form.id ? saved.id : null)
  }

  const days = useMemo(() => {
    if (view === 'giorno') return [anchor]
    const all = Array.from({ length: 7 }, (_, i) => addDays(from, i))
    // La domenica compare solo se ci sono appuntamenti.
    return list.some((a) => a.day === all[6]) ? all : all.slice(0, 6)
  }, [view, anchor, from, list])

  const counts = useMemo(() => {
    const c: Record<AppointmentStatus, number> = { 'confermato-link': 0, 'confermato-manuale': 0, inviato: 0, 'da-inviare': 0 }
    for (const a of list) c[a.status]++
    return c
  }, [list])

  const label = view === 'giorno' ? formatLongDay(anchor) : formatWeek(from)
  const step = view === 'giorno' ? 1 : 7

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Appuntamenti</h1>
          <p>Agenda dello studio, con promemoria WhatsApp e conferma del paziente tramite link.</p>
        </div>
        <button className="btn btn-primary" onClick={() => newAppointment()}>
          <Plus size={16} /> Nuovo appuntamento
        </button>
      </div>

      <div className="card cal-card">
        <div className="cal-toolbar">
          <div className="segmented" role="group" aria-label="Vista">
            <button aria-pressed={view === 'giorno'} onClick={() => changeView('giorno')}>
              Giorno
            </button>
            <button aria-pressed={view === 'settimana'} onClick={() => changeView('settimana')}>
              Settimana
            </button>
          </div>
          <div className="toolbar">
            <button className="btn btn-icon" onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Precedente">
              <ChevronLeft size={18} />
            </button>
            <span className="period-label">{label}</span>
            <button className="btn btn-icon" onClick={() => setAnchor(addDays(anchor, step))} aria-label="Successivo">
              <ChevronRight size={18} />
            </button>
            <button className="btn" onClick={() => setAnchor(today())} disabled={today() >= from && today() <= to}>
              Oggi
            </button>
            <label className="btn btn-icon cal-date-pick" title="Vai a una data">
              <CalendarDays size={18} />
              <input type="date" value={anchor} onChange={(e) => isValidISO(e.target.value) && setAnchor(e.target.value)} aria-label="Vai a una data" />
            </label>
          </div>
        </div>

        <div className="cal-legend" aria-label="Legenda">
          <span className="small muted">
            {list.length === 0 ? 'Nessun appuntamento' : `${list.length} appuntament${list.length === 1 ? 'o' : 'i'}`}
          </span>
          {STATUS_ORDER.map((s) => {
            const Icon = STATUS_ICON[s]
            return (
              <span key={s} className={`appt-tag ${STATUS[s].cls}`} title={STATUS[s].label}>
                <Icon size={13} /> {STATUS[s].short} · {counts[s]}
              </span>
            )
          })}
          {loading && <Loader2 size={16} className="spin" />}
        </div>

        {view === 'settimana' && narrow ? (
          <Agenda days={days} list={list} onOpen={setOpenId} onNew={newAppointment} />
        ) : (
          <TimeGrid
            days={days}
            list={list}
            detailed={view === 'giorno'}
            now={now}
            onOpen={setOpenId}
            onNew={newAppointment}
            onPickDay={(d) => {
              setAnchor(d)
              changeView('giorno')
            }}
          />
        )}
      </div>

      {opened && !form && (
        <AppointmentDetail
          appointment={opened}
          settings={data.settings}
          onChange={replace}
          onClose={() => setOpenId(null)}
          onEdit={() =>
            setForm({
              id: opened.id,
              wasConfirmed: opened.confirmedAt !== null,
              initial: {
                day: opened.day,
                time: opened.time,
                duration: opened.duration,
                patientName: opened.patientName,
                patientPhone: opened.patientPhone,
                serviceId: opened.serviceId,
                notes: opened.notes,
              },
            })
          }
          onDelete={async () => {
            try {
              await api.deleteAppointment(opened.id)
              setList((l) => l.filter((x) => x.id !== opened.id))
              setOpenId(null)
              notify('Appuntamento eliminato')
            } catch (e) {
              notify((e as Error).message, 'error')
            }
          }}
        />
      )}

      {form && (
        <AppointmentForm
          title={form.id ? 'Modifica appuntamento' : 'Nuovo appuntamento'}
          initial={form.initial}
          editingId={form.id}
          wasConfirmed={form.wasConfirmed}
          services={data.services}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      )}
    </>
  )
}

// ---------- Griglia oraria (giorno o settimana) ----------

function TimeGrid({
  days,
  list,
  detailed,
  now,
  onOpen,
  onNew,
  onPickDay,
}: {
  days: string[]
  list: Appointment[]
  detailed: boolean
  now: Date
  onOpen: (id: number) => void
  onNew: (day: string, time: string) => void
  onPickDay: (day: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Orario mostrato: 8–20, allargato se ci sono appuntamenti prima o dopo.
  const startHour = Math.min(8, ...list.map((a) => Math.floor(toMinutes(a.time) / 60)))
  const endHour = Math.max(20, ...list.map((a) => Math.ceil((toMinutes(a.time) + a.duration) / 60)))
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const height = (endHour - startHour) * 60 * PX_PER_MIN
  const t = today()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // Apre la griglia sull'ora del primo appuntamento (o su adesso, se oggi è visibile).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = list.length ? Math.min(...list.map((a) => toMinutes(a.time))) : days.includes(t) ? nowMin : 9 * 60
    el.scrollTop = Math.max(0, (first - startHour * 60 - 30) * PX_PER_MIN)
  }, [days.join(), list.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const clickColumn = (day: string, e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const min = startHour * 60 + Math.floor(y / PX_PER_MIN / 15) * 15
    onNew(day, fromMinutes(Math.min(23 * 60 + 45, Math.max(0, min))))
  }

  return (
    <div className="cal" style={{ '--cols': days.length } as CSSProperties}>
      <div className="cal-head">
        <span />
        {days.map((d) => {
          const dt = fromISO(d)
          return (
            <button
              key={d}
              className={`cal-day-head ${d === t ? 'is-today' : ''}`}
              onClick={() => onPickDay(d)}
              disabled={detailed}
              title={detailed ? undefined : 'Apri la vista del giorno'}
            >
              <span>{WEEKDAYS_SHORT[dt.getDay()]}</span> <strong>{dt.getDate()}</strong>
              <span className="cal-day-count">{list.filter((a) => a.day === d).length || ''}</span>
            </button>
          )
        })}
      </div>
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-body" style={{ height }}>
          <div className="cal-hours">
            {hours.map((h) => (
              <span key={h} style={{ top: (h - startHour) * 60 * PX_PER_MIN }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const items = list.filter((a) => a.day === d)
            const lanes = layoutLanes(items)
            return (
              <div
                key={d}
                className={`cal-col ${d === t ? 'is-today' : ''}`}
                style={{ backgroundSize: `100% ${60 * PX_PER_MIN}px` }}
                onClick={(e) => clickColumn(d, e)}
                title="Clicca per aggiungere un appuntamento"
              >
                {d === t && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                  <div className="cal-now" style={{ top: (nowMin - startHour * 60) * PX_PER_MIN }} />
                )}
                {items.map((a) => {
                  const pos = lanes.get(a.id) ?? { lane: 0, lanes: 1 }
                  const top = (toMinutes(a.time) - startHour * 60) * PX_PER_MIN
                  const h = Math.max(24, a.duration * PX_PER_MIN - 2)
                  const Icon = STATUS_ICON[a.status]
                  return (
                    <button
                      key={a.id}
                      className={`cal-ev ${STATUS[a.status].cls} ${h < 44 ? 'is-short' : ''} ${!detailed && pos.lanes > 1 ? 'is-narrow' : ''}`}
                      style={{
                        top,
                        height: h,
                        left: `calc(${(pos.lane / pos.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / pos.lanes}% - 4px)`,
                      }}
                      onClick={() => onOpen(a.id)}
                      title={`${a.time}–${endTime(a.time, a.duration)} · ${a.patientName}${a.serviceName ? ` · ${a.serviceName}` : ''} · ${STATUS[a.status].label}`}
                    >
                      <span className="cal-ev-line">
                        <Icon size={13} className="cal-ev-icon" />
                        <span className="cal-ev-time">{a.time}</span>
                        <span className="cal-ev-name">{a.patientName}</span>
                      </span>
                      {!(h < 44) && a.serviceName && <span className="cal-ev-sub">{a.serviceName}</span>}
                      {detailed && h >= 60 && <span className="cal-ev-sub">{STATUS[a.status].label}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------- Elenco per giorno (settimana su schermi stretti) ----------

function Agenda({
  days,
  list,
  onOpen,
  onNew,
}: {
  days: string[]
  list: Appointment[]
  onOpen: (id: number) => void
  onNew: (day: string) => void
}) {
  const t = today()
  return (
    <div className="agenda">
      {days.map((d) => {
        const items = list.filter((a) => a.day === d)
        return (
          <section key={d} className={`agenda-day ${d === t ? 'is-today' : ''}`}>
            <div className="agenda-day-head">
              <strong>{formatLongDay(d)}</strong>
              <button className="btn btn-ghost btn-icon" onClick={() => onNew(d)} aria-label={`Nuovo appuntamento ${formatDay(d)}`}>
                <Plus size={16} />
              </button>
            </div>
            {items.length === 0 ? (
              <p className="small muted agenda-empty">Nessun appuntamento</p>
            ) : (
              items.map((a) => {
                const Icon = STATUS_ICON[a.status]
                return (
                  <button key={a.id} className={`agenda-item ${STATUS[a.status].cls}`} onClick={() => onOpen(a.id)}>
                    <span className="agenda-time">
                      {a.time}
                      <small>{endTime(a.time, a.duration)}</small>
                    </span>
                    <span className="agenda-main">
                      <strong>{a.patientName}</strong>
                      {a.serviceName && <span className="small muted">{a.serviceName}</span>}
                      <span className={`appt-tag ${STATUS[a.status].cls}`}>
                        <Icon size={13} /> {STATUS[a.status].short}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </section>
        )
      })}
    </div>
  )
}
