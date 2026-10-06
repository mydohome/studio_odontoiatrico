import { CalendarRange, Copy, CopyPlus, ImagePlus, Info, Lightbulb, Loader2, Megaphone, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { categoryInfo } from '../../../shared/catalog.ts'
import { daysInMonth, formatMonth, fromISO, MONTHS, MONTHS_SHORT, monthIndex, monthKey } from '../../../shared/dates.ts'
import type {
  CampaignResponse,
  CampaignSuggestion,
  CampaignType,
  CustomCampaign,
  CustomCampaignInput,
} from '../../../shared/types.ts'
import CampaignForm from '../components/CampaignForm.tsx'
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
  personalizzata: { label: 'Personalizzata', cls: 'badge-accent' },
}

const monthStart = (ym: string) => `${ym}-01`
const monthEnd = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`

/** "10 ott – 10 nov 2026" / "17 ottobre 2026" */
function formatRange(from: string, to: string) {
  const a = fromISO(from)
  const b = fromISO(to)
  if (from === to) return `${a.getDate()} ${MONTHS[a.getMonth()].toLowerCase()} ${a.getFullYear()}`
  const sameYear = a.getFullYear() === b.getFullYear()
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()].toLowerCase()}${sameYear ? '' : ` ${a.getFullYear()}`} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()].toLowerCase()} ${b.getFullYear()}`
}

/** Una campagna personalizzata nella forma usata dal generatore di volantini. */
const asSuggestion = (c: CustomCampaign): CampaignSuggestion => ({
  id: `custom-${c.id}`,
  type: 'personalizzata',
  category: c.category,
  title: c.title,
  offer: c.offer,
  target: c.target,
  channels: c.channels,
  score: 0,
  reasons: [],
})

/** `source` è la campagna di partenza (modifica o duplicazione): serve a riportarne il volantino. */
type FormState = { mode: 'new' | 'edit' | 'duplicate'; id?: number; source?: CustomCampaign; initial: CustomCampaignInput } | null

/**
 * Testi del volantino da salvare dopo un cambio di periodo: date e mese del titolo seguono la
 * campagna, tutto il resto (testi, colori, voci) resta com'era. `null` se non serve salvare nulla.
 */
function flyerForPeriod(source: CustomCampaign | undefined, saved: CustomCampaign): Record<string, unknown> | null {
  const flyer = source?.flyer
  if (!flyer) return null
  if (source.dateFrom === saved.dateFrom && source.dateTo === saved.dateTo) return saved.id === source.id ? null : flyer
  const { dateFrom: _from, dateTo: _to, headline: _headline, ...rest } = flyer
  return rest
}
type FlyerState = { campaign: CampaignSuggestion; month: string; custom?: CustomCampaign } | null

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
  const [flyerFor, setFlyerFor] = useState<FlyerState>(null)
  const [customs, setCustoms] = useState<CustomCampaign[]>([])
  const [form, setForm] = useState<FormState>(null)

  const load = () => {
    setLoading(true)
    api
      .campaigns(12)
      .then(setRes)
      .catch((e) => notify((e as Error).message, 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [data.version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Campagne personalizzate nell'orizzonte mostrato (i 12 mesi della striscia).
  const firstMonth = res?.months[0]?.month
  const lastMonth = res?.months[res.months.length - 1]?.month
  const loadCustoms = () => {
    if (!firstMonth || !lastMonth) return
    api
      .customCampaigns(monthStart(firstMonth), monthEnd(lastMonth))
      .then(setCustoms)
      .catch((e) => notify((e as Error).message, 'error'))
  }
  useEffect(loadCustoms, [firstMonth, lastMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const inMonth = (c: CustomCampaign, ym: string) => c.dateFrom <= monthEnd(ym) && c.dateTo >= monthStart(ym)

  const newCampaign = (ym: string, from?: CampaignSuggestion) =>
    setForm({
      mode: 'new',
      initial: {
        category: from?.category ?? 'prevenzione',
        title: from?.title ?? '',
        offer: from?.offer ?? '',
        target: from?.target ?? '',
        channels: from?.channels ?? [],
        dateFrom: monthStart(ym),
        dateTo: monthEnd(ym),
        notes: '',
      },
    })

  const campaignInput = (c: CustomCampaign, title = c.title): CustomCampaignInput => ({
    category: c.category,
    title,
    offer: c.offer,
    target: c.target,
    channels: c.channels,
    dateFrom: c.dateFrom,
    dateTo: c.dateTo,
    notes: c.notes,
  })

  const editCampaign = (c: CustomCampaign) => setForm({ mode: 'edit', id: c.id, source: c, initial: campaignInput(c) })

  // La copia si apre nel modulo: di solito si cambia il periodo (es. la stessa promozione il mese dopo).
  const duplicateCampaign = (c: CustomCampaign) =>
    setForm({ mode: 'duplicate', source: c, initial: campaignInput(c, `${c.title} (copia)`.slice(0, 80)) })

  const submitForm = async (value: CustomCampaignInput) => {
    if (!form) return
    let saved =
      form.mode === 'edit' && form.id
        ? await api.updateCustomCampaign(form.id, value)
        : await api.createCustomCampaign(value)
    // Modifica o copia: il volantino già preparato segue la campagna (con date e mese aggiornati).
    const flyer = flyerForPeriod(form.source, saved)
    if (flyer) {
      try {
        saved = await api.saveCustomFlyer(saved.id, flyer)
      } catch (e) {
        notify(`Campagna salvata, ma non il suo volantino: ${(e as Error).message}`, 'error')
      }
    }
    setForm(null)
    notify(form.mode === 'edit' ? 'Campagna aggiornata' : form.mode === 'duplicate' ? 'Campagna duplicata' : 'Campagna creata')
    loadCustoms()
    // Porta la vista sul mese di inizio della campagna, se è tra quelli mostrati.
    const idx = res?.months.findIndex((m) => m.month === monthKey(saved.dateFrom)) ?? -1
    if (idx >= 0 && !inMonth(saved, res!.months[sel].month)) setSel(idx)
  }

  const removeCampaign = async (c: CustomCampaign) => {
    if (!window.confirm(`Eliminare la campagna "${c.title}"?`)) return
    try {
      await api.deleteCustomCampaign(c.id)
      setCustoms((list) => list.filter((x) => x.id !== c.id))
      notify('Campagna eliminata')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

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
          <button className="btn btn-primary" onClick={() => newCampaign(plan.month)}>
            <Plus size={16} /> Nuova campagna
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
            {customs.some((c) => inMonth(c, m.month)) && (
              <span className="count" title="Campagne personalizzate">
                {(() => {
                  const n = customs.filter((c) => inMonth(c, m.month)).length
                  return n === 1 ? '1 tua' : `${n} tue`
                })()}
              </span>
            )}
            {m.campaigns[0] && (
              <span
                className="dot"
                style={{ background: categoryInfo(m.campaigns[0].category).color }}
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

          <div className="section-title">
            <span>Le tue campagne</span>
            <button className="btn btn-ghost small" onClick={() => newCampaign(plan.month)}>
              <Plus size={15} /> Crea per {MONTHS[monthIndex(plan.month)].toLowerCase()}
            </button>
          </div>
          {customs.filter((c) => inMonth(c, plan.month)).length === 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              Nessuna campagna personalizzata in questo mese. Creane una da zero oppure usa "Personalizza" su una proposta.
            </p>
          )}
          {customs
            .filter((c) => inMonth(c, plan.month))
            .map((c) => {
              const cat = categoryInfo(c.category)
              return (
                <article className="campaign campaign-custom" key={`custom-${c.id}`}>
                  <div className="campaign-top">
                    <div>
                      <div className="chips">
                        <span className="badge badge-accent">Personalizzata</span>
                        <span className="badge">
                          <span className="dot" style={{ background: cat.color }} />
                          {cat.label}
                        </span>
                        <span className="badge">
                          <CalendarRange size={12} /> {formatRange(c.dateFrom, c.dateTo)}
                        </span>
                      </div>
                      <h3>{c.title}</h3>
                    </div>
                  </div>
                  <dl>
                    {c.offer && (
                      <>
                        <dt>Offerta</dt>
                        <dd>{c.offer}</dd>
                      </>
                    )}
                    {c.target && (
                      <>
                        <dt>Target</dt>
                        <dd>{c.target}</dd>
                      </>
                    )}
                    {c.channels.length > 0 && (
                      <>
                        <dt>Canali</dt>
                        <dd className="chips">
                          {c.channels.map((ch) => (
                            <span className="badge" key={ch}>
                              {ch}
                            </span>
                          ))}
                        </dd>
                      </>
                    )}
                  </dl>
                  {c.notes && <p className="reasons" style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.notes}</p>}
                  <div className="campaign-actions">
                    <button
                      className="btn"
                      onClick={() => setFlyerFor({ campaign: asSuggestion(c), month: monthKey(c.dateFrom), custom: c })}
                    >
                      <ImagePlus size={16} /> {c.flyer ? 'Apri volantino' : 'Genera volantino'} <span className="beta-tag">beta</span>
                    </button>
                    <button className="btn" onClick={() => editCampaign(c)}>
                      <Pencil size={16} /> Modifica
                    </button>
                    <button className="btn" onClick={() => duplicateCampaign(c)} title="Crea una nuova campagna partendo da questa (anche il volantino)">
                      <CopyPlus size={16} /> Duplica
                    </button>
                    <button className="btn btn-ghost btn-danger" onClick={() => removeCampaign(c)}>
                      <Trash2 size={16} /> Elimina
                    </button>
                  </div>
                  {c.createdBy && (
                    <p className="small muted" style={{ margin: 0 }}>
                      Creata da {c.createdBy}
                    </p>
                  )}
                </article>
              )
            })}

          <div className="section-title">
            <span>Proposte dell'algoritmo</span>
          </div>
          {plan.campaigns.length === 0 && (
            <div className="card empty">
              <Megaphone size={28} />
              <div>Nessuna campagna suggerita per questo mese.</div>
            </div>
          )}

          {plan.campaigns.map((c, i) => {
            const cat = categoryInfo(c.category)
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
                <div className="campaign-actions">
                  <button className="btn" onClick={() => setFlyerFor({ campaign: c, month: plan.month })}>
                    <ImagePlus size={16} /> Genera volantino <span className="beta-tag">beta</span>
                  </button>
                  <button className="btn" onClick={() => newCampaign(plan.month, c)} title="Copia tra le tue campagne per modificarla">
                    <Copy size={16} /> Personalizza
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
                  const cat = categoryInfo(f.category)
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
                        <span className="dot" style={{ background: categoryInfo(s.category).color }} />
                        {categoryInfo(s.category).label}
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
            campaign={flyerFor.campaign}
            month={flyerFor.month}
            settings={data.settings}
            onSettingsChange={data.setSettings}
            onClose={() => setFlyerFor(null)}
            {...(flyerFor.custom
              ? {
                  period: { from: flyerFor.custom.dateFrom, to: flyerFor.custom.dateTo },
                  saved: flyerFor.custom.flyer,
                  onSave: async (flyer) => {
                    const updated = await api.saveCustomFlyer(flyerFor.custom!.id, flyer)
                    setCustoms((list) => list.map((x) => (x.id === updated.id ? updated : x)))
                  },
                }
              : {})}
          />
        </Suspense>
      )}

      {form && (
        <CampaignForm
          title={form.mode === 'edit' ? 'Modifica campagna' : form.mode === 'duplicate' ? 'Duplica campagna' : 'Nuova campagna'}
          initial={form.initial}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      )}
    </>
  )
}
