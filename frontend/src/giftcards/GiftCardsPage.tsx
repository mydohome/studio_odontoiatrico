// Pagina del modulo Gift card: uso di una gift card (codice scritto o letto con lo scanner), elenco,
// creazione (a credito, a prestazioni o da un pacchetto) e gestione dei pacchetti.

import { Ban, Check, Gift, Minus, Package, Pencil, Plus, RotateCcw, ScanLine, Search, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { addDays, formatDay, today } from '../../../shared/dates.ts'
import {
  describeContent,
  formatCode,
  formatEuro,
  isValidCode,
  matchCodeEnd,
  MIN_CODE_END,
  normalizeCode,
  parseEuro,
  STATUS_LABEL,
  type GiftCard,
  type GiftCardKind,
  type GiftCardStatus,
  type GiftPackage,
  type GiftPackageItem,
} from '../../../shared/giftCards.ts'
import type { Service } from '../../../shared/types.ts'
import { useToast } from '../components/Toast.tsx'
import type { AppDataState } from '../lib/useData.ts'
import { giftApi } from './api.ts'
import { GiftCardPreview } from './GiftCardVisual.tsx'
import './giftcards.css'

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_CLS: Record<GiftCardStatus, string> = { attiva: 'gc-st-active', esaurita: 'gc-st-used', scaduta: 'gc-st-expired', annullata: 'gc-st-cancelled' }

function StatusTag({ status }: { status: GiftCardStatus }) {
  return <span className={`appt-tag ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
}

/** Residuo in breve: "45 € su 100 €" oppure "2 prestazioni su 3". */
function leftLabel(c: GiftCard): string {
  if (c.kind === 'credito') return `${formatEuro(c.balance ?? 0)} su ${formatEuro(c.amount ?? 0)}`
  const left = c.items.reduce((n, i) => n + Math.max(0, i.left), 0)
  const tot = c.items.reduce((n, i) => n + i.qty, 0)
  return `${left} prestazion${left === 1 ? 'e' : 'i'} su ${tot}`
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-dialog ${wide ? 'modal-wide' : ''}`}>
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

export default function GiftCardsPage({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [cards, setCards] = useState<GiftCard[]>([])
  const [packages, setPackages] = useState<GiftPackage[]>([])
  const [current, setCurrent] = useState<GiftCard | null>(null)
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<GiftCard | null>(null)
  const [managingPackages, setManagingPackages] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([giftApi.list(), giftApi.packages()])
      setCards(c)
      setPackages(p)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }, [notify])

  useEffect(() => {
    reload()
  }, [reload])

  /** Aggiorna la card nell'elenco e in quella aperta. */
  const replace = (c: GiftCard) => {
    setCards((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]))
    setCurrent((cur) => (cur && cur.id === c.id ? c : cur))
  }

  const active = cards.filter((c) => c.status === 'attiva')
  const credit = active.reduce((n, c) => n + (c.balance ?? 0), 0)

  return (
    <>
      <div className="page-head page-head-inline">
        <h1>Gift card</h1>
        <p>Gift card dello studio a credito o a prestazioni, con codice a barre: si verificano e si scalano qui.</p>
      </div>

      <div className="gc-summary">
        <span className="badge">{active.length} attive</span>
        <span className="badge">Credito ancora da usare: {formatEuro(credit)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setManagingPackages(true)}>
          <Package size={16} /> Pacchetti
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Nuova gift card
        </button>
      </div>

      <div className="gc-layout">
        <UseCard cards={cards} current={current} onFound={setCurrent} onChange={replace} onPreview={setPreview} />
        <CardList cards={cards} selected={current?.id ?? null} onOpen={setCurrent} />
      </div>

      {creating && (
        <NewCardDialog
          services={data.services}
          packages={packages.filter((p) => p.active)}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            replace(c)
            setCurrent(c)
            setCreating(false)
            setPreview(c)
            notify(`Gift card creata: ${formatCode(c.code)}`)
          }}
        />
      )}
      {preview && (
        <Modal title={`Gift card ${formatCode(preview.code)}`} onClose={() => setPreview(null)} wide>
          <div className="modal-body">
            <GiftCardPreview card={preview} settings={data.settings} />
          </div>
        </Modal>
      )}
      {managingPackages && (
        <PackagesDialog services={data.services} packages={packages} onChange={setPackages} onClose={() => setManagingPackages(false)} />
      )}
    </>
  )
}

// ---------- Uso di una gift card ----------

function UseCard({
  cards,
  current,
  onFound,
  onChange,
  onPreview,
}: {
  cards: GiftCard[]
  current: GiftCard | null
  onFound: (c: GiftCard | null) => void
  onChange: (c: GiftCard) => void
  onPreview: (c: GiftCard) => void
}) {
  const notify = useToast()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Più gift card finiscono con gli stessi caratteri: l'operatore sceglie quella giusta. */
  const [choices, setChoices] = useState<GiftCard[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const open = async (c: string) => {
    setBusy(true)
    setError(null)
    setChoices(null)
    try {
      onFound(await giftApi.lookup(c))
      setCode('')
    } catch (err) {
      setError((err as Error).message)
      onFound(null)
    } finally {
      setBusy(false)
    }
  }

  // Lo scanner "scrive" il codice e preme Invio: la ricerca parte da sola. A mano bastano anche
  // gli ultimi caratteri del codice (almeno 3).
  const search = async (e?: FormEvent) => {
    e?.preventDefault()
    const c = normalizeCode(code)
    if (!c) return
    if (isValidCode(c)) return open(c)
    const found = matchCodeEnd(cards, c)
    setChoices(null)
    if (found === null) {
      setError(
        c.length < MIN_CODE_END
          ? `Scrivi il codice intero (es. GC-7KQ2-MXP4-RTH) o almeno gli ultimi ${MIN_CODE_END} caratteri.`
          : 'Nei codici non ci sono 0, O, 1 e I: controlla di averlo scritto correttamente.',
      )
    } else if (found.length === 0) {
      setError(c.startsWith('GC') ? 'Codice non valido: controlla di averlo scritto correttamente.' : `Nessuna gift card con il codice che finisce in «${c}».`)
    } else if (found.length === 1) {
      await open(found[0].code)
    } else {
      setError(null)
      onFound(null)
      setChoices(found)
    }
  }

  const act = async (fn: () => Promise<GiftCard>, msg: string) => {
    try {
      onChange(await fn())
      notify(msg)
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <section className="card gc-use">
      <h2>
        <ScanLine size={18} /> Usa una gift card
      </h2>
      <form className="gc-search" onSubmit={search}>
        <input
          ref={inputRef}
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Codice a barre, codice GC-… o ultimi 3 caratteri"
          autoComplete="off"
          spellCheck={false}
          aria-label="Codice della gift card"
        />
        <button className="btn btn-primary" disabled={busy || !code.trim()}>
          <Search size={16} /> Cerca
        </button>
      </form>
      {error && <div className="alert alert-danger small">{error}</div>}
      {choices && (
        <div className="gc-choices">
          <p className="small muted">{choices.length} gift card finiscono così: scegli quella giusta.</p>
          <ul className="gc-rows">
            {choices.map((c) => (
              <li key={c.id}>
                <CardRow card={c} selected={false} onOpen={() => open(c.code)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {current ? (
        <CardManager card={current} act={act} onPreview={() => onPreview(current)} />
      ) : (
        !error &&
        !choices && <p className="small muted">Con un lettore di codici a barre basta inquadrare la card: il codice si scrive da solo.</p>
      )}
    </section>
  )
}

function CardManager({ card: c, act, onPreview }: { card: GiftCard; act: (fn: () => Promise<GiftCard>, msg: string) => Promise<void>; onPreview: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const usable = c.status === 'attiva'

  useEffect(() => {
    setAmount('')
    setNote('')
    setEditing(false)
  }, [c.id])

  const scale = async (value: number) => {
    if (!window.confirm(`Scalare ${formatEuro(value)} dalla gift card ${formatCode(c.code)}?`)) return
    await act(() => giftApi.redeem(c.id, { amount: value, note }), `Scalati ${formatEuro(value)}`)
    setAmount('')
    setNote('')
  }

  const amountValue = parseEuro(amount)

  return (
    <div className="gc-manage">
      <div className="gc-manage-head">
        <div>
          <div className="gc-manage-code">{formatCode(c.code)}</div>
          <div className="small muted">
            {c.title}
            {c.recipient ? ` · per ${c.recipient}` : ''}
          </div>
        </div>
        <StatusTag status={c.status} />
      </div>

      {c.kind === 'credito' ? (
        <div className="gc-balance">
          <span className="small muted">Credito disponibile</span>
          <strong>{formatEuro(c.balance ?? 0)}</strong>
          <span className="small muted">su {formatEuro(c.amount ?? 0)}</span>
        </div>
      ) : (
        <ul className="gc-items-left">
          {c.items.map((i) => (
            <li key={i.idx} className={i.left <= 0 ? 'is-used' : ''}>
              <span>
                <strong>{i.name}</strong>
                <span className="small muted">
                  {' '}
                  · {i.left} di {i.qty} da usare
                </span>
              </span>
              <button
                className="btn btn-sm btn-primary"
                disabled={!usable || i.left <= 0}
                onClick={() => {
                  if (!window.confirm(`Segnare usata 1 × ${i.name}?`)) return
                  act(() => giftApi.redeem(c.id, { itemIdx: i.idx, qty: 1, note }), `${i.name}: segnata come usata`)
                }}
              >
                <Check size={15} /> Usa 1
              </button>
            </li>
          ))}
        </ul>
      )}

      {c.status !== 'attiva' && (
        <div className={`alert small ${c.status === 'annullata' ? 'alert-danger' : 'alert-warn'}`}>
          {c.status === 'esaurita' && 'Gift card già usata completamente.'}
          {c.status === 'scaduta' && `Scaduta il ${formatDay(c.expiresOn!)}: per usarla prolunga la scadenza con Modifica.`}
          {c.status === 'annullata' && 'Gift card annullata: non si può usare.'}
        </div>
      )}

      {usable && c.kind === 'credito' && (
        <div className="gc-redeem">
          <input
            className="input"
            inputMode="decimal"
            placeholder="Importo da scalare (es. 45,50)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Importo da scalare"
          />
          <button className="btn btn-primary" disabled={amountValue === null || amountValue <= 0} onClick={() => amountValue && scale(amountValue)}>
            <Minus size={16} /> Scala
          </button>
          <button className="btn" onClick={() => scale(c.balance ?? 0)} title="Usa tutto il credito rimasto">
            Scala tutto
          </button>
        </div>
      )}
      {usable && (
        <input className="input" placeholder="Nota (facoltativa, es. prestazione eseguita)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      )}

      <div className="gc-manage-meta small muted">
        {c.expiresOn ? `Valida fino al ${formatDay(c.expiresOn)}` : 'Senza scadenza'}
        {c.buyer && ` · acquistata da ${c.buyer}`}
        {c.pricePaid !== null && ` · pagata ${formatEuro(c.pricePaid)}`}
        {` · creata ${stamp(c.createdAt)}${c.createdBy ? ` da ${c.createdBy}` : ''}`}
      </div>
      {c.notes && <p className="appt-notes small">{c.notes}</p>}

      {c.movements.length > 0 && (
        <div className="gc-history">
          <div className="field-label">Utilizzi</div>
          <ul>
            {[...c.movements].reverse().map((m) => {
              const item = m.itemIdx !== null ? c.items.find((i) => i.idx === m.itemIdx) : null
              return (
                <li key={m.id} className={m.reversedAt ? 'is-reversed' : ''}>
                  <span>
                    <strong>{m.amount !== null ? `− ${formatEuro(m.amount)}` : `${m.qty} × ${item?.name ?? 'prestazione'}`}</strong>
                    <span className="small muted">
                      {' '}
                      · {stamp(m.at)}
                      {m.user ? ` · ${m.user}` : ''}
                      {m.note ? ` · ${m.note}` : ''}
                      {m.reversedAt ? ` · stornato ${stamp(m.reversedAt)}${m.reversedBy ? ` da ${m.reversedBy}` : ''}` : ''}
                    </span>
                  </span>
                  {!m.reversedAt && c.status !== 'annullata' && (
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Annulla questo utilizzo (registrato per errore)"
                      onClick={() => window.confirm('Stornare questo utilizzo? Il credito o la prestazione tornano disponibili.') && act(() => giftApi.reverse(c.id, m.id), 'Utilizzo stornato')}
                    >
                      <Undo2 size={14} /> Storna
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="gc-manage-actions">
        <button className="btn btn-sm" onClick={onPreview}>
          <Gift size={15} /> Card e codice a barre
        </button>
        <button className="btn btn-sm" onClick={() => setEditing(true)}>
          <Pencil size={15} /> Modifica
        </button>
        {c.status === 'annullata' ? (
          <button className="btn btn-sm" onClick={() => act(() => giftApi.cancel(c.id, false), 'Gift card riattivata')}>
            <RotateCcw size={15} /> Riattiva
          </button>
        ) : (
          <button
            className="btn btn-sm btn-ghost btn-danger"
            onClick={() => window.confirm(`Annullare la gift card ${formatCode(c.code)}? Non si potrà più usare (si può riattivare).`) && act(() => giftApi.cancel(c.id, true), 'Gift card annullata')}
          >
            <Ban size={15} /> Annulla card
          </button>
        )}
      </div>

      {editing && <EditDialog card={c} onClose={() => setEditing(false)} onSave={(changes) => act(() => giftApi.update(c.id, changes), 'Gift card aggiornata').then(() => setEditing(false))} />}
    </div>
  )
}

function EditDialog({ card, onClose, onSave }: { card: GiftCard; onClose: () => void; onSave: (c: { recipient: string; buyer: string; notes: string; expiresOn: string | null }) => void }) {
  const [recipient, setRecipient] = useState(card.recipient)
  const [buyer, setBuyer] = useState(card.buyer)
  const [notes, setNotes] = useState(card.notes)
  const [expiresOn, setExpiresOn] = useState(card.expiresOn ?? '')
  return (
    <Modal title={`Modifica ${formatCode(card.code)}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ recipient, buyer, notes, expiresOn: expiresOn || null })
        }}
      >
        <div className="modal-body form-grid">
          <label>
            Intestatario
            <input className="input" value={recipient} maxLength={80} onChange={(e) => setRecipient(e.target.value)} />
          </label>
          <label>
            Acquistata da
            <input className="input" value={buyer} maxLength={80} onChange={(e) => setBuyer(e.target.value)} />
          </label>
          <label>
            Scadenza (vuota = nessuna)
            <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <label className="span-2">
            Note interne
            <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary">Salva</button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Elenco ----------

const FILTERS: { id: GiftCardStatus | 'tutte'; label: string }[] = [
  { id: 'attiva', label: 'Attive' },
  { id: 'esaurita', label: 'Esaurite' },
  { id: 'scaduta', label: 'Scadute' },
  { id: 'annullata', label: 'Annullate' },
  { id: 'tutte', label: 'Tutte' },
]

function CardRow({ card: c, selected, onOpen }: { card: GiftCard; selected: boolean; onOpen: () => void }) {
  return (
    <button className={`gc-row ${selected ? 'is-selected' : ''}`} onClick={onOpen}>
      <span className="gc-row-main">
        <strong>{c.recipient || c.title}</strong>
        <span className="small muted">
          {formatCode(c.code)} · {describeContent(c)}
        </span>
      </span>
      <span className="gc-row-side small">
        <StatusTag status={c.status} />
        <span className="muted">{leftLabel(c)}</span>
      </span>
    </button>
  )
}

function CardList({ cards, selected, onOpen }: { cards: GiftCard[]; selected: number | null; onOpen: (c: GiftCard) => void }) {
  const [filter, setFilter] = useState<GiftCardStatus | 'tutte'>('attiva')
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const code = normalizeCode(q)
    return cards.filter(
      (c) =>
        (filter === 'tutte' || c.status === filter) &&
        (!s || c.recipient.toLowerCase().includes(s) || c.buyer.toLowerCase().includes(s) || c.title.toLowerCase().includes(s) || c.code.includes(code)),
    )
  }, [cards, filter, q])

  return (
    <section className="card gc-list">
      <div className="gc-list-head">
        <div className="segmented" role="group" aria-label="Stato">
          {FILTERS.map((f) => (
            <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="input" placeholder="Cerca nome o codice" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca" />
      </div>
      {shown.length === 0 ? (
        <p className="small muted">{cards.length ? 'Nessuna gift card con questi criteri.' : 'Nessuna gift card: creane una con «Nuova gift card».'}</p>
      ) : (
        <ul className="gc-rows">
          {shown.map((c) => (
            <li key={c.id}>
              <CardRow card={c} selected={selected === c.id} onOpen={() => onOpen(c)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Nuova gift card ----------

/** Prestazioni scelte dal catalogo, con la quantità. */
function ItemsEditor({ services, items, onChange }: { services: Service[]; items: GiftPackageItem[]; onChange: (i: GiftPackageItem[]) => void }) {
  const available = services.filter((s) => s.active)
  return (
    <div className="gc-items-editor span-2">
      {items.map((it, n) => (
        <div key={n} className="gc-item-row">
          <select
            className="input"
            value={it.serviceId ?? ''}
            onChange={(e) => {
              const s = services.find((x) => x.id === e.target.value)
              onChange(items.map((x, k) => (k === n ? { ...x, serviceId: s?.id ?? null, name: s?.name ?? '' } : x)))
            }}
            aria-label="Prestazione"
          >
            <option value="">— Scegli la prestazione —</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="input gc-qty"
            type="number"
            min={1}
            max={99}
            value={it.qty}
            onChange={(e) => onChange(items.map((x, k) => (k === n ? { ...x, qty: Math.max(1, Math.min(99, Number(e.target.value) || 1)) } : x)))}
            aria-label="Quantità"
          />
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => onChange(items.filter((_, k) => k !== n))} aria-label="Togli" disabled={items.length === 1}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...items, { serviceId: null, name: '', qty: 1 }])}>
        <Plus size={15} /> Aggiungi prestazione
      </button>
    </div>
  )
}

type Mode = GiftCardKind | 'pacchetto'

function NewCardDialog({
  services,
  packages,
  onClose,
  onCreated,
}: {
  services: Service[]
  packages: GiftPackage[]
  onClose: () => void
  onCreated: (c: GiftCard) => void
}) {
  const [mode, setMode] = useState<Mode>('credito')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [items, setItems] = useState<GiftPackageItem[]>([{ serviceId: null, name: '', qty: 1 }])
  const [packageId, setPackageId] = useState<number | null>(packages[0]?.id ?? null)
  const [recipient, setRecipient] = useState('')
  const [buyer, setBuyer] = useState('')
  const [pricePaid, setPricePaid] = useState('')
  const [expiresOn, setExpiresOn] = useState(addDays(today(), 365))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pkg = packages.find((p) => p.id === packageId) ?? null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const base = { recipient, buyer, notes, expiresOn: expiresOn || null }
      const input =
        mode === 'pacchetto'
          ? pkg
            ? { ...base, kind: pkg.kind, title: pkg.name, amount: pkg.amount, items: pkg.items, packageId: pkg.id, pricePaid: parseEuro(pricePaid) ?? pkg.price }
            : null
          : mode === 'credito'
            ? { ...base, kind: 'credito' as const, title: title || 'Gift card', amount: parseEuro(amount), items: [], pricePaid: parseEuro(pricePaid) ?? parseEuro(amount) }
            : { ...base, kind: 'prestazioni' as const, title: title || 'Gift card', amount: null, items: items.filter((i) => i.serviceId), pricePaid: parseEuro(pricePaid) }
      if (!input) throw new Error('Scegli un pacchetto')
      onCreated(await giftApi.create(input))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Nuova gift card" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="segmented span-2" role="group" aria-label="Tipo">
            <button type="button" aria-pressed={mode === 'credito'} onClick={() => setMode('credito')}>
              Credito
            </button>
            <button type="button" aria-pressed={mode === 'prestazioni'} onClick={() => setMode('prestazioni')}>
              Prestazioni
            </button>
            <button type="button" aria-pressed={mode === 'pacchetto'} onClick={() => setMode('pacchetto')} disabled={!packages.length} title={packages.length ? undefined : 'Nessun pacchetto: creali con «Pacchetti»'}>
              Pacchetto
            </button>
          </div>

          {mode === 'pacchetto' ? (
            <label className="span-2">
              Pacchetto
              <select className="input" value={packageId ?? ''} onChange={(e) => setPackageId(Number(e.target.value) || null)}>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {describeContent(p)}
                    {p.price !== null ? ` (${formatEuro(p.price)})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Titolo sulla card
                <input className="input" placeholder="Gift card" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
              </label>
              {mode === 'credito' ? (
                <label>
                  Importo (€)
                  <input className="input" inputMode="decimal" required placeholder="es. 100" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
              ) : (
                <span />
              )}
              {mode === 'prestazioni' && <ItemsEditor services={services} items={items} onChange={setItems} />}
            </>
          )}

          <label>
            Intestatario (facoltativo)
            <input className="input" placeholder="es. Maria Rossi" value={recipient} maxLength={80} onChange={(e) => setRecipient(e.target.value)} />
          </label>
          <label>
            Acquistata da (facoltativo)
            <input className="input" value={buyer} maxLength={80} onChange={(e) => setBuyer(e.target.value)} />
          </label>
          <label>
            Prezzo pagato (€)
            <input
              className="input"
              inputMode="decimal"
              placeholder={mode === 'credito' ? 'uguale all\'importo' : mode === 'pacchetto' && pkg?.price !== null && pkg ? String(pkg.price) : 'facoltativo'}
              value={pricePaid}
              onChange={(e) => setPricePaid(e.target.value)}
            />
          </label>
          <label>
            Scadenza (vuota = nessuna)
            <input className="input" type="date" min={today()} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <label className="span-2">
            Note interne
            <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <div className="alert alert-danger span-2">{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy}>
            <Gift size={16} /> {busy ? 'Creazione…' : 'Crea gift card'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Pacchetti ----------

type PackageDraft = Omit<GiftPackage, 'id'> & { id?: number }

const emptyPackage = (): PackageDraft => ({ name: '', kind: 'prestazioni', amount: null, items: [{ serviceId: null, name: '', qty: 1 }], price: null, active: true })

function PackagesDialog({
  services,
  packages,
  onChange,
  onClose,
}: {
  services: Service[]
  packages: GiftPackage[]
  onChange: (p: GiftPackage[]) => void
  onClose: () => void
}) {
  const notify = useToast()
  const [draft, setDraft] = useState<PackageDraft | null>(null)
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')

  const edit = (p: PackageDraft) => {
    setDraft(p)
    setAmount(p.amount !== null ? String(p.amount).replace('.', ',') : '')
    setPrice(p.price !== null ? String(p.price).replace('.', ',') : '')
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft) return
    try {
      const body = {
        name: draft.name,
        kind: draft.kind,
        amount: draft.kind === 'credito' ? parseEuro(amount) : null,
        items: draft.kind === 'prestazioni' ? draft.items.filter((i) => i.serviceId) : [],
        price: parseEuro(price),
        active: draft.active,
      }
      const saved = draft.id ? await giftApi.updatePackage(draft.id, body) : await giftApi.createPackage(body)
      onChange(draft.id ? packages.map((p) => (p.id === saved.id ? saved : p)) : [...packages, saved])
      setDraft(null)
      notify(`Pacchetto «${saved.name}» salvato`)
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  const remove = async (p: GiftPackage) => {
    if (!window.confirm(`Eliminare il pacchetto «${p.name}»? Le gift card già create restano valide.`)) return
    try {
      await giftApi.deletePackage(p.id)
      onChange(packages.filter((x) => x.id !== p.id))
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <Modal title="Pacchetti" onClose={onClose}>
      {draft ? (
        <form onSubmit={save}>
          <div className="modal-body form-grid">
            <label className="span-2">
              Nome del pacchetto
              <input className="input" required maxLength={60} placeholder="es. Check-up completo" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="segmented span-2" role="group" aria-label="Tipo">
              <button type="button" aria-pressed={draft.kind === 'prestazioni'} onClick={() => setDraft({ ...draft, kind: 'prestazioni' })}>
                Prestazioni
              </button>
              <button type="button" aria-pressed={draft.kind === 'credito'} onClick={() => setDraft({ ...draft, kind: 'credito' })}>
                Credito
              </button>
            </div>
            {draft.kind === 'prestazioni' ? (
              <ItemsEditor services={services} items={draft.items.length ? draft.items : [{ serviceId: null, name: '', qty: 1 }]} onChange={(items) => setDraft({ ...draft, items })} />
            ) : (
              <label>
                Credito (€)
                <input className="input" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            <label>
              Prezzo di vendita (€, facoltativo)
              <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="gc-check">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Disponibile per nuove gift card
            </label>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Indietro
            </button>
            <button className="btn btn-primary">Salva pacchetto</button>
          </div>
        </form>
      ) : (
        <>
          <div className="modal-body">
            {packages.length === 0 ? (
              <p className="small muted">Nessun pacchetto. Un pacchetto è un modello (es. «1 visita di controllo + 1 seduta di igiene» a 120 €) da cui creare gift card con un clic.</p>
            ) : (
              <ul className="gc-rows">
                {packages.map((p) => (
                  <li key={p.id} className="gc-package">
                    <span className="gc-row-main">
                      <strong>
                        {p.name}
                        {!p.active && <span className="small muted"> · non disponibile</span>}
                      </strong>
                      <span className="small muted">
                        {describeContent(p)}
                        {p.price !== null ? ` · ${formatEuro(p.price)}` : ''}
                      </span>
                    </span>
                    <span>
                      <button className="btn btn-sm btn-ghost" onClick={() => edit(p)}>
                        <Pencil size={14} /> Modifica
                      </button>
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(p)} aria-label={`Elimina ${p.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal-foot">
            <button className="btn btn-primary" onClick={() => edit(emptyPackage())}>
              <Plus size={16} /> Nuovo pacchetto
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
