import { AlertTriangle, CalendarClock, CalendarDays, CalendarX2, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, Loader2, MessageCircle, Phone, PhoneMissed, Plus, Send, UserX } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { confirmUntil, endTime } from '../../../shared/appointments.ts'
import { addDays, formatDay, formatLongDay, formatWeek, fromISO, isValidISO, startOfWeek, today, WEEKDAYS_SHORT } from '../../../shared/dates.ts'
import type { Appointment, AppointmentInput, AppointmentStatus, ScheduledAppointment } from '../../../shared/types.ts'
import AppointmentDetail from '../components/AppointmentDetail.tsx'
import AppointmentForm from '../components/AppointmentForm.tsx'
import { ServiceBadge, ServiceDot } from '../components/ServiceBadge.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { fromMinutes, isScheduled, layoutLanes, STATUS, STATUS_ORDER, toMinutes } from '../lib/appointments.ts'
import type { AppDataState } from '../lib/useData.ts'

type View = 'giorno' | 'settimana'
const VIEW_KEY = 'appuntamentiVista'
// 30 minuti = 42 px: c'è posto per orario, nome e badge della prestazione.
const PX_PER_MIN = 1.4
const POLL_MS = 60_000

const STATUS_ICON: Record<AppointmentStatus, typeof Check> = {
  'confermato-link': CheckCheck,
  'confermato-manuale': Check,
  inviato: Clock,
  'da-inviare': Send,
  'non-presentato': UserX,
  'da-riprogrammare': CalendarX2,
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

type FormState = { id?: number; initial: AppointmentInput; wasConfirmed?: boolean; previous?: { day: string; time: string } | null } | null

export default function Appuntamenti({ data }: { data: AppDataState }) {
  const notify = useToast()
  const narrow = useNarrow()
  const now = useNow()
  const [view, setView] = useState<View>(loadView)
  const [anchor, setAnchor] = useState(today())
  const [list, setList] = useState<ScheduledAppointment[]>([])
  // Da confermare: da oggi al prossimo giorno lavorativo (il venerdì comprende sabato e lunedì).
  const [pending, setPending] = useState<ScheduledAppointment[]>([])
  // Da riprogrammare: senza data e ora.
  const [toResched, setToResched] = useState<Appointment[]>([])
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
        const t = today()
        const [l, p, r] = await Promise.all([api.appointments(from, to), api.appointments(t, confirmUntil(t)), api.toReschedule()])
        const all = [...new Map([...l, ...p].map((a) => [a.id, a])).values()]
        // Avvisa delle conferme arrivate dal link mentre la pagina era aperta.
        if (quiet) {
          for (const a of all) {
            const before = known.current.get(a.id)
            if (before && before !== 'confermato-link' && a.status === 'confermato-link') {
              notify(`${a.patientName} ha confermato l'appuntamento di ${formatDay(a.day)} alle ${a.time}`)
            }
          }
        }
        known.current = new Map(all.map((a) => [a.id, a.status]))
        setList(l)
        setPending(p)
        setToResched(r)
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

  const byTime = (x: ScheduledAppointment, y: ScheduledAppointment) => x.day.localeCompare(y.day) || x.time.localeCompare(y.time)

  /** Aggiorna un appuntamento in tutte le liste (calendario, da confermare, da riprogrammare). */
  const replace = (a: Appointment) => {
    known.current.set(a.id, a.status)
    const upsert = (l: ScheduledAppointment[], inRange: (d: string) => boolean) => {
      const others = l.filter((x) => x.id !== a.id)
      return isScheduled(a) && inRange(a.day) ? [...others, a].sort(byTime) : others
    }
    const t = today()
    setPending((l) => upsert(l, (d) => d >= t && d <= confirmUntil(t)))
    setList((l) => upsert(l, (d) => d >= from && d <= to))
    setToResched((l) => (isScheduled(a) ? l.filter((x) => x.id !== a.id) : l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]))
  }

  const opened: Appointment | null =
    openId !== null ? list.find((a) => a.id === openId) ?? pending.find((a) => a.id === openId) ?? toResched.find((a) => a.id === openId) ?? null : null

  /** Modulo di modifica; per un appuntamento da riprogrammare, la scelta della nuova data. */
  const editForm = (a: Appointment) =>
    setForm({
      id: a.id,
      wasConfirmed: a.confirmedAt !== null,
      // Da riprogrammare: data e ora vuote, da scegliere; si ricordano quelle di prima.
      previous: !isScheduled(a) && a.prevDay && a.prevTime ? { day: a.prevDay, time: a.prevTime } : null,
      initial: {
        day: a.day ?? '',
        time: a.time ?? '',
        duration: a.duration,
        patientName: a.patientName,
        patientPhone: a.patientPhone,
        serviceId: a.serviceId,
        notes: a.notes,
      },
    })

  const quick = async (fn: () => Promise<Appointment>, ok: string) => {
    try {
      replace(await fn())
      notify(ok)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

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
    notify(form.previous ? 'Appuntamento riprogrammato' : form.id ? 'Appuntamento aggiornato' : 'Appuntamento creato')
    replace(saved)
    // Fuori dal periodo mostrato: la vista si sposta sul giorno dell'appuntamento (e lo ricarica).
    if (isScheduled(saved) && (saved.day < from || saved.day > to)) setAnchor(saved.day)
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
    const c: Record<AppointmentStatus, number> = { 'confermato-link': 0, 'confermato-manuale': 0, inviato: 0, 'da-inviare': 0, 'non-presentato': 0, 'da-riprogrammare': 0 }
    for (const a of list) c[a.status]++
    c['da-riprogrammare'] = toResched.length
    return c
  }, [list, toResched])

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

      <div className="appt-layout">
        {/* A sinistra le cose da fare, compatte; il calendario occupa il resto dello schermo. */}
        <aside className="appt-side" aria-label="Da fare">
          <ToReschedule list={toResched} onOpen={setOpenId} onPlan={editForm} />
          <ToConfirm
            list={pending}
            now={now}
            onOpen={setOpenId}
            onCalled={(a) => quick(() => api.appointmentCalled(a.id), `Chiamata a ${a.patientName} registrata`)}
            onConfirmed={(a) => quick(() => api.appointmentConfirmation(a.id, true), `${a.patientName}: appuntamento confermato`)}
          />
        </aside>

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
      </div>

      {opened && !form && (
        <AppointmentDetail
          appointment={opened}
          settings={data.settings}
          onChange={replace}
          onClose={() => setOpenId(null)}
          onEdit={() => editForm(opened)}
          onReschedule={async () => {
            const a = await api.rescheduleAppointment(opened.id)
            replace(a)
            setOpenId(null)
            notify(`${a.patientName}: da riprogrammare`)
          }}
          onDelete={async () => {
            try {
              await api.deleteAppointment(opened.id)
              setList((l) => l.filter((x) => x.id !== opened.id))
              setPending((l) => l.filter((x) => x.id !== opened.id))
              setToResched((l) => l.filter((x) => x.id !== opened.id))
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
          title={form.previous !== undefined && form.previous !== null ? 'Riprogramma appuntamento' : form.id ? 'Modifica appuntamento' : 'Nuovo appuntamento'}
          initial={form.initial}
          editingId={form.id}
          wasConfirmed={form.wasConfirmed}
          services={data.services}
          previous={form.previous}
          onSubmit={submitForm}
          onReschedule={
            form.id && !form.previous && form.initial.day
              ? async () => {
                  const id = form.id!
                  const a = await api.rescheduleAppointment(id)
                  replace(a)
                  setForm(null)
                  setOpenId(null)
                  notify(`${a.patientName}: da riprogrammare`)
                }
              : undefined
          }
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
  list: ScheduledAppointment[]
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
                      className={`cal-ev ${STATUS[a.status].cls} ${h < 40 ? 'is-short' : ''} ${!detailed && pos.lanes > 1 ? 'is-narrow' : ''}`}
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
                        {h < 40 && <ServiceDot appointment={a} />}
                        <span className="cal-ev-name">{a.patientName}</span>
                      </span>
                      {h >= 40 && a.serviceName && (
                        <span className="cal-ev-badge">
                          <ServiceBadge appointment={a} size="sm" />
                        </span>
                      )}
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
  list: ScheduledAppointment[]
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
                      <ServiceBadge appointment={a} size="sm" />
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

// ---------- Da confermare (fino al prossimo giorno lavorativo) ----------

const ago = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function dayWords(day: string, t: string) {
  if (day === t) return 'Oggi'
  if (day === addDays(t, 1)) return 'Domani'
  return formatLongDay(day).replace(/ \d{4}$/, '')
}

function ToConfirm({
  list,
  now,
  onOpen,
  onCalled,
  onConfirmed,
}: {
  list: ScheduledAppointment[]
  now: Date
  onOpen: (id: number) => void
  onCalled: (a: ScheduledAppointment) => void
  onConfirmed: (a: ScheduledAppointment) => void
}) {
  const t = today()
  const until = confirmUntil(t)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // Solo quelli non confermati e non ancora iniziati.
  const items = list.filter(
    (a) => (a.status === 'inviato' || a.status === 'da-inviare') && (a.day > t || toMinutes(a.time) > nowMin),
  )
  const days = [...new Set(items.map((a) => a.day))]
  const range = until === addDays(t, 1) ? 'oggi e domani' : `fino a ${formatLongDay(until).replace(/ \d{4}$/, '').toLowerCase()}`

  return (
    <section className={`card to-confirm ${items.length ? 'has-items' : ''}`} aria-labelledby="tc-title">
      <div className="to-confirm-head">
        <h2 id="tc-title">
          {items.length ? <AlertTriangle size={17} /> : <CheckCheck size={17} />} Da confermare
          {items.length > 0 && <span className="to-confirm-count">{items.length}</span>}
        </h2>
        <span className="small muted">Fino a {formatLongDay(until).replace(/ \d{4}$/, '').toLowerCase()}</span>
      </div>
      {items.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Tutti gli appuntamenti {range} sono confermati.
        </p>
      ) : (
        days.map((d) => (
          <div key={d} className="to-confirm-day">
            <div className="to-confirm-day-title">{dayWords(d, t)}</div>
            {items
              .filter((a) => a.day === d)
              .map((a) => {
                const Icon = STATUS_ICON[a.status]
                return (
                  <div key={a.id} className={`side-row ${STATUS[a.status].cls}`}>
                    <button className="side-row-main" onClick={() => onOpen(a.id)} title={`${a.patientName}: apri l'appuntamento`}>
                      <span className="side-row-time">{a.time}</span>
                      <strong className="side-row-name">{a.patientName}</strong>
                    </button>
                    <div className="side-row-sub small">
                      <ServiceBadge appointment={a} size="sm" />
                      <span className={`appt-tag ${STATUS[a.status].cls}`} title={a.lastSentAt ? `Ultimo invio ${ago(a.lastSentAt)}` : undefined}>
                        <Icon size={12} />
                        {a.status === 'da-inviare' ? 'Mai inviato' : a.sendCount > 1 ? `Inviato ${a.sendCount}×` : 'Inviato'}
                      </span>
                      {a.callCount > 0 && a.lastCallAt && (
                        <span className="to-confirm-called" title={`Ultima chiamata ${ago(a.lastCallAt)}`}>
                          <PhoneMissed size={12} /> {a.callCount === 1 ? 'non risponde' : `${a.callCount} chiamate`}
                        </span>
                      )}
                    </div>
                    <div className="side-row-actions">
                      <button
                        className="btn btn-sm btn-icon btn-whatsapp"
                        onClick={() => onOpen(a.id)}
                        title={a.status === 'da-inviare' ? 'Invia il messaggio WhatsApp' : 'Reinvia: prepara il sollecito WhatsApp'}
                        aria-label={a.status === 'da-inviare' ? 'Invia' : 'Reinvia'}
                      >
                        <MessageCircle size={14} />
                      </button>
                      <a className="btn btn-sm btn-icon" href={`tel:${a.patientPhone.replace(/[^\d+]/g, '')}`} title={`Chiama ${a.patientPhone}`} aria-label={`Chiama ${a.patientPhone}`}>
                        <Phone size={14} />
                      </a>
                      <button className="btn btn-sm btn-icon" onClick={() => onCalled(a)} title="Non risponde: registra una chiamata senza risposta" aria-label="Non risponde">
                        <PhoneMissed size={14} />
                      </button>
                      <button className="btn btn-sm btn-icon" onClick={() => onConfirmed(a)} title="Confermato (es. al telefono)" aria-label="Confermato">
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        ))
      )}
    </section>
  )
}

// ---------- Da riprogrammare ----------

function ToReschedule({ list, onOpen, onPlan }: { list: Appointment[]; onOpen: (id: number) => void; onPlan: (a: Appointment) => void }) {
  return (
    <section className={`card to-resched ${list.length ? 'has-items' : ''}`} aria-labelledby="tr-title">
      <div className="to-confirm-head">
        <h2 id="tr-title">
          <CalendarX2 size={17} /> Da riprogrammare
          {list.length > 0 && <span className="to-confirm-count to-resched-count">{list.length}</span>}
        </h2>
        {!list.length && <span className="small muted">Nessuno</span>}
      </div>
      {list.map((a) => (
        <div key={a.id} className="side-row st-resched">
          <button className="side-row-main" onClick={() => onOpen(a.id)} title={`${a.patientName}: apri l'appuntamento`}>
            <strong className="side-row-name">{a.patientName}</strong>
          </button>
          <div className="side-row-sub small">
            <ServiceBadge appointment={a} size="sm" />
            {a.prevDay && a.prevTime && (
              <span className="muted" title={a.rescheduleAt ? `Da riprogrammare dal ${ago(a.rescheduleAt)}` : undefined}>
                era {formatDay(a.prevDay)} {a.prevTime}
              </span>
            )}
          </div>
          <div className="side-row-actions">
            <button className="btn btn-sm btn-resched-solid" onClick={() => onPlan(a)} title="Scegli la nuova data e ora">
              <CalendarClock size={14} /> Riprogramma
            </button>
            <a className="btn btn-sm btn-icon" href={`tel:${a.patientPhone.replace(/[^\d+]/g, '')}`} title={`Chiama ${a.patientPhone}`} aria-label={`Chiama ${a.patientPhone}`}>
              <Phone size={14} />
            </a>
          </div>
        </div>
      ))}
    </section>
  )
}
