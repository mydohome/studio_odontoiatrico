import { Activity, BarChart3, CalendarCheck, ChevronLeft, ChevronRight, Euro, Stethoscope, Trophy, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { categoryInfo, CATEGORIES } from '../../../shared/catalog.ts'
import { today } from '../../../shared/dates.ts'
import {
  aggregate,
  aggregateDoctors,
  delta,
  eur,
  fmt,
  NO_DOCTOR,
  periodOf,
  periodsEndingAt,
  shiftAnchor,
  trendSeries,
  type PeriodType,
} from '../lib/stats.ts'
import type { AppDataState } from '../lib/useData.ts'

const TREND_COUNT: Record<PeriodType, number> = { giorno: 14, settimana: 12, mese: 12 }
const PREV_LABEL: Record<PeriodType, string> = { giorno: 'giorno prec.', settimana: 'settimana prec.', mese: 'mese prec.' }

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="kpi-foot">nessun confronto con {label}</span>
  const up = value >= 0
  return (
    <span className="kpi-foot">
      <span className={up ? 'delta-up' : 'delta-down'}>
        {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {up ? '+' : ''}
        {fmt(value * 100)}%
      </span>
      vs {label}
    </span>
  )
}

function TrendTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as Record<string, number | string>
  const items = CATEGORIES.filter((c) => Number(row[c.id]) > 0)
  return (
    <div className="chart-tooltip">
      <div className="t">{row.full}</div>
      {items.map((c) => (
        <div className="row" key={c.id}>
          <span>
            <span className="dot" style={{ background: c.color }} /> {c.label}
          </span>
          <strong className="num">{row[c.id]}</strong>
        </div>
      ))}
      <div className="row" style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span>Totale</span>
        <strong className="num">{row.total}</strong>
      </div>
    </div>
  )
}

interface DoctorLine {
  /** Id del medico, o NO_DOCTOR. */
  id: number
  name: string
  color: string
  total: number
  revenue: number
  prevTotal: number
  top: { name: string; q: number }[]
}

function DoctorTooltip({ active, payload, lines }: TooltipContentProps<ValueType, NameType> & { lines: DoctorLine[] }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as Record<string, number | string>
  const items = lines.filter((l) => Number(row[`m${l.id}`]) > 0)
  return (
    <div className="chart-tooltip">
      <div className="t">{row.full}</div>
      {items.map((l) => (
        <div className="row" key={l.id}>
          <span>
            <span className="dot" style={{ background: l.color }} /> {l.name}
          </span>
          <strong className="num">{row[`m${l.id}`]}</strong>
        </div>
      ))}
      <div className="row" style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span>Totale</span>
        <strong className="num">{row.total}</strong>
      </div>
    </div>
  )
}

export default function Dashboard({ data, onGoRegistra }: { data: AppDataState; onGoRegistra: () => void }) {
  const [type, setType] = useState<PeriodType>('mese')
  const [anchor, setAnchor] = useState(today())
  const { records, services } = data

  const period = periodOf(type, anchor)
  const prevPeriod = periodOf(type, shiftAnchor(type, anchor, -1))
  const cur = useMemo(() => aggregate(records, services, period), [records, services, period.start, period.end])
  const prev = useMemo(() => aggregate(records, services, prevPeriod), [records, services, prevPeriod.start, prevPeriod.end])
  const series = useMemo(
    () => trendSeries(records, services, periodsEndingAt(type, anchor, TREND_COUNT[type])),
    [records, services, type, anchor],
  )
  const showPrices = data.settings.showPrices

  // ---- Per medico: contano le prestazioni degli appuntamenti confermati; il resto (registrazioni a mano
  // e appuntamenti senza medico) va in «Senza medico», così i totali tornano con il resto della dashboard.
  const { doctors, doctorRecords } = data
  const doctorsOn = data.settings.modules.appointments
  const periods = useMemo(() => periodsEndingAt(type, anchor, TREND_COUNT[type]), [type, anchor])
  const doctorView = useMemo(() => {
    const split = (p: ReturnType<typeof periodOf>) => {
      const tot = aggregate(records, services, p)
      const per = aggregateDoctors(doctorRecords, services, p)
      let total = 0
      let revenue = 0
      for (const [k, v] of per) {
        if (k === NO_DOCTOR) continue
        total += v.total
        revenue += v.revenue
      }
      per.set(NO_DOCTOR, { total: tot.total - total, revenue: tot.revenue - revenue, byService: new Map() })
      return { tot, per }
    }
    const curS = split(period)
    const prevS = split(prevPeriod)
    const trend = periods.map((p) => ({ p, ...split(p) }))
    const used = (id: number) => id === NO_DOCTOR || [curS, prevS, ...trend].some((x) => (x.per.get(id)?.total ?? 0) > 0)
    const meta = [
      ...doctors.map((d) => ({ id: d.id, name: d.name, color: d.color })),
      { id: NO_DOCTOR, name: 'Senza medico', color: 'var(--text-3)' },
    ].filter((m) => used(m.id))
    const lines: DoctorLine[] = meta.map((m) => {
      const c = curS.per.get(m.id)
      const top = [...(c?.byService ?? [])]
        .map(([sid, q]) => ({ name: services.find((x) => x.id === sid)?.name ?? sid, q }))
        .sort((a, b) => b.q - a.q)
        .slice(0, 3)
      return { ...m, total: c?.total ?? 0, revenue: c?.revenue ?? 0, prevTotal: prevS.per.get(m.id)?.total ?? 0, top }
    })
    const rows = trend.map(({ p, tot, per }) => {
      const row: Record<string, number | string> = { key: p.start, label: p.short, full: p.label, total: tot.total }
      for (const m of meta) row[`m${m.id}`] = per.get(m.id)?.total ?? 0
      return row
    })
    return { lines, rows }
  }, [records, doctorRecords, doctors, services, period.start, period.end, prevPeriod.start, prevPeriod.end, periods])
  const doctorLines = doctorView.lines.filter((l) => l.id !== NO_DOCTOR || l.total > 0 || l.prevTotal > 0)
  const namedDoctors = doctorLines.some((l) => l.id !== NO_DOCTOR)
  const maxDoctor = Math.max(1, ...doctorLines.map((l) => l.total))
  const hasPrices = services.some((s) => (s.price ?? 0) > 0)
  const isFuture = shiftAnchor(type, anchor, 1) > today()

  const serviceRows = services
    .map((s) => ({ s, q: cur.byService.get(s.id) ?? 0, p: prev.byService.get(s.id) ?? 0 }))
    .filter((r) => r.q > 0 || r.p > 0)
    .sort((a, b) => b.q - a.q || b.p - a.p)
  const maxService = Math.max(1, ...serviceRows.map((r) => r.q))
  const top = serviceRows[0]?.q ? serviceRows[0] : null

  const catRows = CATEGORIES.map((c) => ({ c, q: cur.byCategory.get(c.id) ?? 0 })).filter((r) => r.q > 0)
  const maxCat = Math.max(1, ...catRows.map((r) => r.q))

  if (!records.length) {
    return (
      <div className="card empty">
        <BarChart3 size={32} />
        <h2>Nessun dato ancora</h2>
        <p>Registra le prime giornate oppure importa uno storico da Excel in Impostazioni.</p>
        <button className="btn btn-primary" onClick={onGoRegistra}>
          Registra una giornata
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Riepilogo delle prestazioni per giornata, settimana e mese.</p>
        </div>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Periodo">
            {(['giorno', 'settimana', 'mese'] as PeriodType[]).map((t) => (
              <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn btn-icon" onClick={() => setAnchor(shiftAnchor(type, anchor, -1))} aria-label="Periodo precedente">
            <ChevronLeft size={18} />
          </button>
          <span className="period-label">{period.label}</span>
          <button
            className="btn btn-icon"
            onClick={() => setAnchor(shiftAnchor(type, anchor, 1))}
            disabled={isFuture}
            aria-label="Periodo successivo"
          >
            <ChevronRight size={18} />
          </button>
          <button className="btn" onClick={() => setAnchor(today())}>
            Oggi
          </button>
        </div>
      </div>

      <div className={`kpis ${showPrices ? '' : 'kpis-3'}`}>
        <div className="card">
          <div className="kpi-label">
            <Activity size={15} /> Prestazioni totali
          </div>
          <div className="kpi-value">{fmt(cur.total)}</div>
          <Delta value={delta(cur.total, prev.total)} label={PREV_LABEL[type]} />
        </div>
        {showPrices && (
          <div className="card">
            <div className="kpi-label">
              <Euro size={15} /> Fatturato stimato
            </div>
            <div className="kpi-value">{hasPrices ? eur(cur.revenue) : '—'}</div>
            {hasPrices ? (
              <Delta value={delta(cur.revenue, prev.revenue)} label={PREV_LABEL[type]} />
            ) : (
              <span className="kpi-foot">imposta i prezzi in Impostazioni</span>
            )}
          </div>
        )}
        <div className="card">
          <div className="kpi-label">
            <CalendarCheck size={15} /> {type === 'giorno' ? 'Categorie trattate' : 'Media per giorno lavorato'}
          </div>
          <div className="kpi-value">
            {type === 'giorno' ? catRows.length : cur.workedDays ? fmt(cur.total / cur.workedDays, 1) : '—'}
          </div>
          <span className="kpi-foot">
            {type === 'giorno' ? `su ${CATEGORIES.length} categorie` : `${cur.workedDays} giorni con attività`}
          </span>
        </div>
        <div className="card">
          <div className="kpi-label">
            <Trophy size={15} /> Prestazione più eseguita
          </div>
          <div className="kpi-value" style={{ fontSize: '1.2rem', lineHeight: 1.25, margin: '8px 0 6px' }}>
            {top ? top.s.name : '—'}
          </div>
          <span className="kpi-foot">{top ? `${top.q} volte` : 'nessuna attività'}</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h2>Andamento per categoria</h2>
            <p className="sub">
              Ultimi {TREND_COUNT[type]} {type === 'giorno' ? 'giorni' : type === 'settimana' ? 'settimane' : 'mesi'} · clicca
              una colonna per selezionare il periodo
            </p>
          </div>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart
              data={series}
              margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
              barCategoryGap="22%"
              onClick={(e) => {
                const i = e?.activeTooltipIndex
                if (typeof i === 'number' && series[i]) setAnchor(String(series[i].key))
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={TrendTooltip} cursor={{ fill: 'var(--surface-2)' }} />
              {CATEGORIES.map((c, i) => (
                <Bar
                  key={c.id}
                  dataKey={c.id}
                  stackId="a"
                  fill={c.color}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  radius={i === CATEGORIES.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="legend">
          {CATEGORIES.map((c) => (
            <span key={c.id}>
              <span className="dot" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Prestazioni · {period.label}</h2>
          <p className="sub">Quantità per tipologia e confronto con il periodo precedente.</p>
          {serviceRows.length === 0 ? (
            <div className="empty">Nessuna prestazione in questo periodo.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prestazione</th>
                    <th style={{ width: '40%' }}>Quantità</th>
                    <th className="r">Prec.</th>
                    <th className="r">Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceRows.map(({ s, q, p }) => {
                    const d = delta(q, p)
                    return (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          <div className="bar-cell">
                            <div className="track">
                              <div
                                className="fill"
                                style={{ width: `${(q / maxService) * 100}%`, background: categoryInfo(s.category).color }}
                              />
                            </div>
                            <strong className="num" style={{ minWidth: 28, textAlign: 'right' }}>
                              {q}
                            </strong>
                          </div>
                        </td>
                        <td className="r num muted">{p}</td>
                        <td className={`r num ${d === null ? 'muted' : d >= 0 ? 'delta-up' : 'delta-down'}`}>
                          {d === null ? '—' : `${d >= 0 ? '+' : ''}${fmt(d * 100)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>Per categoria</h2>
          <p className="sub">Distribuzione nel periodo selezionato.</p>
          {catRows.length === 0 ? (
            <div className="empty">Nessun dato.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {catRows
                .sort((a, b) => b.q - a.q)
                .map(({ c, q }) => (
                  <div key={c.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 4 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="dot" style={{ background: c.color }} />
                        {c.label}
                      </span>
                      <span className="num">
                        <strong>{q}</strong> <span className="muted">· {fmt((q / cur.total) * 100)}%</span>
                      </span>
                    </div>
                    <div className="bar-cell">
                      <div className="track">
                        <div className="fill" style={{ width: `${(q / maxCat) * 100}%`, background: c.color }} />
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {doctorsOn && namedDoctors && (
        <>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ alignSelf: 'start' }}>
              <h2>
                <Stethoscope size={18} style={{ verticalAlign: '-3px' }} /> Per medico · {period.label}
              </h2>
              <p className="sub">
                Prestazioni degli appuntamenti confermati. Le registrazioni a mano e gli appuntamenti senza medico sono in «Senza medico».
              </p>
              <div style={{ display: 'grid', gap: 14 }}>
                {doctorLines.map((l) => {
                  const d = delta(l.total, l.prevTotal)
                  return (
                    <div key={l.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.9rem', marginBottom: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span className="dot" style={{ background: l.color }} />
                          <strong>{l.name}</strong>
                        </span>
                        <span className="num" style={{ whiteSpace: 'nowrap' }}>
                          <strong>{l.total}</strong> <span className="muted">· {cur.total ? fmt((l.total / cur.total) * 100) : 0}%</span>
                          {showPrices && hasPrices && <span className="muted"> · {eur(l.revenue)}</span>}
                          {d !== null && (
                            <span className={d >= 0 ? 'delta-up' : 'delta-down'} title={`${PREV_LABEL[type]}: ${l.prevTotal}`}>
                              {' '}
                              {d >= 0 ? '+' : ''}
                              {fmt(d * 100)}%
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="bar-cell">
                        <div className="track">
                          <div className="fill" style={{ width: `${(l.total / maxDoctor) * 100}%`, background: l.color }} />
                        </div>
                      </div>
                      {l.top.length > 0 && l.id !== NO_DOCTOR && (
                        <div className="small muted" style={{ marginTop: 4 }}>
                          {l.top.map((t) => `${t.name} ${t.q}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card">
              <h2>Andamento per medico</h2>
              <p className="sub">
                Ultimi {TREND_COUNT[type]} {type === 'giorno' ? 'giorni' : type === 'settimana' ? 'settimane' : 'mesi'}
              </p>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={doctorView.rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={(props) => <DoctorTooltip {...props} lines={doctorView.lines} />} cursor={{ fill: 'var(--surface-2)' }} />
                    {doctorView.lines.map((l, i) => (
                      <Bar
                        key={l.id}
                        dataKey={`m${l.id}`}
                        stackId="m"
                        fill={l.color}
                        stroke="var(--surface)"
                        strokeWidth={1}
                        radius={i === doctorView.lines.length - 1 ? [4, 4, 0, 0] : 0}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="legend">
                {doctorView.lines.map((l) => (
                  <span key={l.id}>
                    <span className="dot" style={{ background: l.color }} />
                    {l.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
