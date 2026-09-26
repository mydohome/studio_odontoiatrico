import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES } from '../../../shared/catalog.ts'
import { addDays, formatDay, isValidISO, today } from '../../../shared/dates.ts'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import type { AppDataState } from '../lib/useData.ts'

type Items = Record<string, number>

const sum = (it: Items) => Object.values(it).reduce((a, b) => a + (b || 0), 0)
const clean = (it: Items) => Object.fromEntries(Object.entries(it).filter(([, q]) => q > 0))
const same = (a: Items, b: Items) => JSON.stringify(Object.entries(clean(a)).sort()) === JSON.stringify(Object.entries(clean(b)).sort())

export default function Registra({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [date, setDate] = useState(today())
  const [items, setItems] = useState<Items>({})
  const [saved, setSaved] = useState<Items>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const dirty = !same(items, saved)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .day(date)
      .then((d) => {
        if (!alive) return
        setItems(d.items)
        setSaved(d.items)
      })
      .catch((e) => notify((e as Error).message, 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [date, notify])

  // Avvisa prima di lasciare la pagina con modifiche non salvate.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const changeDate = (d: string) => {
    if (!isValidISO(d)) return
    if (dirty && !window.confirm('Ci sono modifiche non salvate. Vuoi cambiare giorno e perderle?')) return
    setDate(d)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.saveDay(date, clean(items))
      setItems(res.items)
      setSaved(res.items)
      notify(`Salvato: ${sum(res.items)} prestazioni il ${formatDay(date)}`)
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Ctrl/Cmd + S per salvare.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && !saving) save()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const setQty = (id: string, q: number) => setItems((it) => ({ ...it, [id]: Math.max(0, Math.min(999, Math.round(q) || 0)) }))

  const active = data.services.filter((s) => s.active || (items[s.id] ?? 0) > 0)
  const groups = CATEGORIES.map((c) => ({ cat: c, services: active.filter((s) => s.category === c.id) })).filter(
    (g) => g.services.length,
  )

  const recentDays = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of data.records) totals.set(r.d, (totals.get(r.d) ?? 0) + r.q)
    return [...totals.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12)
  }, [data.records])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Registra la giornata</h1>
          <p>Inserisci il numero di prestazioni eseguite per ciascuna tipologia.</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-icon" onClick={() => changeDate(addDays(date, -1))} aria-label="Giorno precedente">
            <ChevronLeft size={18} />
          </button>
          <input
            className="input"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => changeDate(e.target.value)}
            aria-label="Data"
          />
          <button
            className="btn btn-icon"
            onClick={() => changeDate(addDays(date, 1))}
            disabled={date >= today()}
            aria-label="Giorno successivo"
          >
            <ChevronRight size={18} />
          </button>
          <button className="btn" onClick={() => changeDate(today())} disabled={date === today()}>
            Oggi
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{formatDay(date)}</h2>
              <p className="sub">{loading ? 'Caricamento…' : `${sum(items)} prestazioni inserite`}</p>
            </div>
          </div>

          {groups.length === 0 && <div className="empty">Nessuna prestazione attiva: aggiungile in Impostazioni.</div>}

          {groups.map(({ cat, services }) => (
            <section className="entry-group" key={cat.id}>
              <div className="entry-group-title">
                <span className="dot" style={{ background: cat.color }} />
                {cat.label}
              </div>
              <div className="entry-list">
                {services.map((s) => {
                  const q = items[s.id] ?? 0
                  return (
                    <div key={s.id} className={`entry-row ${q > 0 ? 'has-value' : ''}`}>
                      <label className="entry-name" htmlFor={`q-${s.id}`} title={s.name}>
                        {s.name}
                      </label>
                      <div className="stepper">
                        <button onClick={() => setQty(s.id, q - 1)} aria-label={`Diminuisci ${s.name}`} disabled={q === 0}>
                          <Minus size={15} />
                        </button>
                        <input
                          id={`q-${s.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={q === 0 ? '' : q}
                          placeholder="0"
                          onChange={(e) => setQty(s.id, Number(e.target.value))}
                          onFocus={(e) => e.target.select()}
                        />
                        <button onClick={() => setQty(s.id, q + 1)} aria-label={`Aumenta ${s.name}`}>
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          <div className="save-bar">
            <span className="muted small">
              {dirty ? 'Modifiche non salvate' : 'Tutto salvato'} · Totale <strong className="num">{sum(items)}</strong>
            </span>
            <div className="toolbar">
              <button className="btn" onClick={() => setItems(saved)} disabled={!dirty || saving}>
                <RotateCcw size={16} /> Annulla
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
                <Save size={16} /> {saving ? 'Salvataggio…' : 'Salva giornata'}
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>Ultime giornate registrate</h2>
          <p className="sub">Clicca per aprire e modificare.</p>
          {recentDays.length === 0 ? (
            <div className="empty">
              <CalendarDays size={28} />
              <div>Nessuna giornata registrata.</div>
            </div>
          ) : (
            <ul className="day-list">
              {recentDays.map(([d, tot]) => (
                <li key={d}>
                  <button onClick={() => changeDate(d)} aria-current={d === date}>
                    <span>{formatDay(d)}</span>
                    <span className="badge num">{tot}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
