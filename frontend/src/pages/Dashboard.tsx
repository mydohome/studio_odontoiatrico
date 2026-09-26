import { Activity, BarChart3, CalendarCheck, ChevronLeft, ChevronRight, Euro, Trophy, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { CATEGORIES, CATEGORY_BY_ID } from '../../../shared/catalog.ts'
import { today } from '../../../shared/dates.ts'
import {
  aggregate,
  delta,
  eur,
  fmt,
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

      <div className="kpis">
        <div className="card">
          <div className="kpi-label">
            <Activity size={15} /> Prestazioni totali
          </div>
          <div className="kpi-value">{fmt(cur.total)}</div>
          <Delta value={delta(cur.total, prev.total)} label={PREV_LABEL[type]} />
        </div>
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
                                style={{ width: `${(q / maxService) * 100}%`, background: CATEGORY_BY_ID[s.category].color }}
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
    </>
  )
}
