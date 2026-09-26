import { CalendarRange, ImagePlus, Info, Lightbulb, Loader2, Megaphone, RefreshCw } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { CATEGORY_BY_ID } from '../../../shared/catalog.ts'
import { formatMonth, MONTHS_SHORT, monthIndex } from '../../../shared/dates.ts'
import type { CampaignResponse, CampaignSuggestion, CampaignType } from '../../../shared/types.ts'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { fmt } from '../lib/stats.ts'
import type { AppDataState } from '../lib/useData.ts'

// Editor dei volantini (beta): caricato solo quando serve.
const FlyerEditor = lazy(() => import('../flyer/FlyerEditor.tsx'))

const TYPE_LABEL: Record<CampaignType, { label: string; cls: string }> = {
  calo: { label: 'Riempi l\'agenda', cls: 'badge-warn' },
  richiamo: { label: 'Richiamo pazienti', cls: 'badge-accent' },
  conversione: { label: 'Recupero preventivi', cls: 'badge-danger' },
  trend: { label: 'Riattivazione', cls: 'badge-danger' },
  crosssell: { label: 'Cross-selling', cls: 'badge-good' },
  calendario: { label: 'Stagionale', cls: '' },
}

const CONFIDENCE: Record<CampaignResponse['confidence'], { label: string; cls: string; text: string }> = {
  nessuna: { label: 'Nessun dato', cls: 'badge-danger', text: 'Senza storico i suggerimenti si basano solo sul calendario.' },
  bassa: { label: 'Affidabilità bassa', cls: 'badge-warn', text: 'Meno di 6 mesi di storico: la stagionalità è ancora poco definita.' },
  media: { label: 'Affidabilità media', cls: 'badge-accent', text: 'Tra 6 e 18 mesi di storico: stagionalità parzialmente stimata.' },
  alta: { label: 'Affidabilità alta', cls: 'badge-good', text: 'Oltre 18 mesi di storico: stagionalità e trend ben stimati.' },
}

/** Colore divergente per l'indice stagionale: blu sotto la media, rosso sopra, grigio neutro a 1. */
function heatColor(v: number) {
  const t = Math.max(-1, Math.min(1, (v - 1) / 0.5))
  const pole = t < 0 ? 'var(--div-neg)' : 'var(--div-pos)'
  return `color-mix(in srgb, ${pole} ${Math.round(Math.abs(t) * 85)}%, var(--div-mid))`
}

export default function Campagne({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [res, setRes] = useState<CampaignResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(0)
  const [flyerFor, setFlyerFor] = useState<CampaignSuggestion | null>(null)

  const load = () => {
    setLoading(true)
    api
      .campaigns(12)
      .then(setRes)
      .catch((e) => notify((e as Error).message, 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [data.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !res) {
    return (
      <div className="empty">
        <Loader2 size={24} /> Elaborazione in corso…
      </div>
    )
  }
  if (!res) return null

  const plan = res.months[sel]
  const conf = CONFIDENCE[res.confidence]
  const maxForecast = Math.max(1, ...plan.forecast.map((f) => Math.max(f.expected, f.average)))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campagne marketing</h1>
          <p>Proposte mese per mese calcolate su stagionalità, trend e richiami dei tuoi dati.</p>
        </div>
        <div className="toolbar">
          <span className={`badge ${conf.cls}`} title={conf.text}>
            {conf.label} · {res.historyMonths} mesi di storico
          </span>
          <button className="btn" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Ricalcola
          </button>
        </div>
      </div>

      {res.confidence !== 'alta' && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <Info size={18} style={{ flex: 'none' }} />
          <span>
            {conf.text} Più giornate registri (o importi da Excel), più precise diventano le proposte.
          </span>
        </div>
      )}

      <div className="month-strip" role="group" aria-label="Mese">
        {res.months.map((m, i) => (
          <button key={m.month} className="month-chip" aria-pressed={i === sel} onClick={() => setSel(i)}>
            <span className="m">{MONTHS_SHORT[monthIndex(m.month)]}</span>
            <span className="y">{m.month.slice(0, 4)}</span>
            {m.campaigns[0] && (
              <span
                className="dot"
                style={{ background: CATEGORY_BY_ID[m.campaigns[0].category].color }}
                title={m.campaigns[0].title}
              />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card-head">
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{formatMonth(plan.month)}</h2>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                {plan.activity < 0.85
                  ? `Mese a ridotta attività (circa ${fmt(plan.activity * 100)}% di un mese medio): chiusure o ferie.`
                  : plan.activity > 1.1
                    ? `Mese intenso: attività attesa ${fmt(plan.activity * 100)}% di un mese medio.`
                    : 'Attività attesa nella media.'}
              </p>
            </div>
          </div>

          {plan.campaigns.length === 0 && (
            <div className="card empty">
              <Megaphone size={28} />
              <div>Nessuna campagna suggerita per questo mese.</div>
            </div>
          )}

          {plan.campaigns.map((c, i) => {
            const cat = CATEGORY_BY_ID[c.category]
            const t = TYPE_LABEL[c.type]
            return (
              <article className="campaign" key={c.id}>
                <div className="campaign-top">
                  <div>
                    <div className="chips">
                      {i === 0 && <span className="badge badge-accent">Consigliata</span>}
                      <span className={`badge ${t.cls}`}>{t.label}</span>
                      <span className="badge">
                        <span className="dot" style={{ background: cat.color }} />
                        {cat.label}
                      </span>
                    </div>
                    <h3>{c.title}</h3>
                  </div>
                  <div className="score" title="Punteggio di convenienza">
                    <div className="score-value">{c.score}</div>
                    <div className="small muted">su 100</div>
                    <div className="score-bar">
                      <span style={{ width: `${c.score}%` }} />
                    </div>
                  </div>
                </div>
                <dl>
                  <dt>Offerta</dt>
                  <dd>{c.offer}</dd>
                  <dt>Target</dt>
                  <dd>{c.target}</dd>
                  <dt>Canali</dt>
                  <dd className="chips">
                    {c.channels.map((ch) => (
                      <span className="badge" key={ch}>
                        {ch}
                      </span>
                    ))}
                  </dd>
                </dl>
                <ul className="reasons">
                  {c.reasons.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
                <div>
                  <button className="btn" onClick={() => setFlyerFor(c)}>
                    <ImagePlus size={16} /> Genera volantino <span className="beta-tag">beta</span>
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>Previsione del mese</h2>
            <p className="sub">Interventi attesi per categoria rispetto alla media mensile.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              {plan.forecast
                .filter((f) => f.average > 0 || f.expected > 0)
                .map((f) => {
                  const cat = CATEGORY_BY_ID[f.category]
                  const diff = f.average ? f.expected / f.average - 1 : 0
                  return (
                    <div key={f.category}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', marginBottom: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="dot" style={{ background: cat.color }} />
                          {cat.label}
                        </span>
                        <span className="num">
                          <strong>{fmt(f.expected)}</strong>{' '}
                          <span className={Math.abs(diff) < 0.05 ? 'muted' : diff > 0 ? 'delta-up' : 'delta-down'}>
                            {diff >= 0 ? '+' : ''}
                            {fmt(diff * 100)}%
                          </span>
                        </span>
                      </div>
                      <div className="bar-cell">
                        <div className="track">
                          <div className="fill" style={{ width: `${(f.expected / maxForecast) * 100}%`, background: cat.color }} />
                          <div
                            title={`Media: ${fmt(f.average)}`}
                            style={{
                              position: 'absolute',
                              top: -3,
                              bottom: -3,
                              width: 2,
                              left: `${(f.average / maxForecast) * 100}%`,
                              background: 'var(--text)',
                              borderRadius: 1,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              {res.historyMonths === 0 && <div className="muted small">Nessuno storico disponibile.</div>}
            </div>
            <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
              La linea verticale indica la media mensile della categoria.
            </p>
          </div>

          <div className="card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lightbulb size={16} /> Come funziona
            </h2>
            <ul className="small muted" style={{ paddingLeft: 18, margin: '8px 0 0', display: 'grid', gap: 6 }}>
              <li>
                <strong>Stagionalità</strong>: per ogni categoria calcola quanto ogni mese si discosta dalla media.
              </li>
              <li>
                <strong>Calo previsto</strong> → promozioni per riempire l'agenda; <strong>picco</strong> → offerte
                complementari ai pazienti già in studio.
              </li>
              <li>
                <strong>Richiami</strong>: igieni e controlli di 6 mesi prima da richiamare.
              </li>
              <li>
                <strong>Trend e conversione</strong>: segnala cali reali rispetto all'anno precedente e un calo del rapporto
                cure/visite (preventivi non accettati).
              </li>
              <li>
                <strong>Calendario</strong>: ricorrenze utili (San Valentino, rientro a scuola, detrazioni di fine anno…).
              </li>
            </ul>
          </div>
        </div>
      </div>

      {res.historyMonths > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CalendarRange size={16} /> Stagionalità per categoria
          </h2>
          <p className="sub">
            Indice mensile: 1,00 = mese medio. <span style={{ color: 'var(--div-neg)', fontWeight: 600 }}>Blu</span> = sotto la
            media, <span style={{ color: 'var(--div-pos)', fontWeight: 600 }}>rosso</span> = sopra. I mesi senza dati valgono 1.
          </p>
          <div className="table-wrap">
            <table className="heat">
              <thead>
                <tr>
                  <th />
                  {MONTHS_SHORT.map((m) => (
                    <th key={m}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.seasonality.map((s) => (
                  <tr key={s.category}>
                    <th className="cat">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="dot" style={{ background: CATEGORY_BY_ID[s.category].color }} />
                        {CATEGORY_BY_ID[s.category].label}
                      </span>
                    </th>
                    {s.index.map((v, m) => (
                      <td
                        key={m}
                        style={{ background: s.observations[m] ? heatColor(v) : 'transparent', color: 'var(--text)' }}
                        title={`${s.observations[m]} osservazioni`}
                      >
                        {s.observations[m] ? v.toFixed(2).replace('.', ',') : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {flyerFor && (
        <Suspense fallback={null}>
          <FlyerEditor
            campaign={flyerFor}
            month={plan.month}
            settings={data.settings}
            onSettingsChange={data.setSettings}
            onClose={() => setFlyerFor(null)}
          />
        </Suspense>
      )}
    </>
  )
}
