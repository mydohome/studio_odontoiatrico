import { ChevronDown, X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { badgeColor, CATEGORIES } from '../../../shared/catalog.ts'
import type { Service } from '../../../shared/types.ts'

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Scelta della prestazione: elenco per categoria (si apre con un clic) e ricerca con completamento
 * automatico mentre si scrive (nome o categoria, anche solo una parte; più parole = tutte presenti).
 */
export default function ServicePicker({
  services,
  value,
  onChange,
}: {
  services: Service[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  // Testo digitato: null = mostra la prestazione scelta.
  const [query, setQuery] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const selected = services.find((s) => s.id === value) ?? null

  const groups = useMemo(() => {
    const words = fold(query ?? '').split(/\s+/).filter(Boolean)
    return CATEGORIES.map((c) => ({
      ...c,
      items: services.filter((s) => {
        if (!s.active && s.id !== value) return false
        const hay = fold(`${s.name} ${c.label}`)
        return s.category === c.id && words.every((w) => hay.includes(w))
      }),
    })).filter((g) => g.items.length)
  }, [services, query, value])

  // Elenco piatto (per la tastiera): «Non specificata» solo senza ricerca in corso.
  const flat: (Service | null)[] = useMemo(() => [...(query ? [] : [null]), ...groups.flatMap((g) => g.items)], [groups, query])

  const close = () => {
    setOpen(false)
    setQuery(null)
  }
  const pick = (s: Service | null) => {
    onChange(s?.id ?? null)
    close()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length)
    } else if (e.key === 'Enter' && open) {
      e.preventDefault() // non invia il modulo
      // Con una ricerca in corso Invio sceglie la voce evidenziata (la prima, se non ci si è mossi).
      if (flat.length) pick(flat[Math.min(cursor, flat.length - 1)])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation() // chiude l'elenco, non il modulo
      close()
    }
  }

  const shown = query ?? selected?.name ?? ''
  let index = -1

  return (
    <div className="combo">
      <div className="combo-field">
        <input
          ref={inputRef}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Prestazione"
          autoComplete="off"
          spellCheck={false}
          placeholder="Cerca o scegli la prestazione…"
          value={shown}
          onFocus={(e) => {
            setOpen(true)
            setCursor(0)
            e.currentTarget.select()
          }}
          onClick={() => setOpen(true)}
          onBlur={close}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
        />
        {selected && !open ? (
          <button type="button" className="combo-btn" onClick={() => pick(null)} aria-label="Togli la prestazione" title="Togli la prestazione">
            <X size={15} />
          </button>
        ) : (
          <button type="button" className="combo-btn" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? close() : (inputRef.current?.focus(), setOpen(true)))} aria-label="Mostra l'elenco">
            <ChevronDown size={16} />
          </button>
        )}
      </div>
      {open && (
        <ul className="combo-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {!query && (
            <li role="option" aria-selected={value === null} className={`combo-opt ${cursor === 0 ? 'is-active' : ''}`} onClick={() => pick(null)} onMouseEnter={() => setCursor(0)}>
              <span className="muted">— Non specificata —</span>
            </li>
          )}
          {groups.map((g) => (
            <li key={g.id} role="presentation">
              <div className="combo-group">{g.label}</div>
              <ul role="presentation">
                {g.items.map((s) => {
                  index = flat.indexOf(s)
                  const i = index
                  return (
                    <li key={s.id} role="option" aria-selected={s.id === value} className={`combo-opt ${cursor === i ? 'is-active' : ''} ${s.id === value ? 'is-selected' : ''}`} onClick={() => pick(s)} onMouseEnter={() => setCursor(i)}>
                      <span className="combo-dot" style={{ background: badgeColor(s.category, s.color) }} />
                      {s.name}
                      {!s.active && <span className="muted small"> (non attiva)</span>}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
          {query && groups.length === 0 && <li className="combo-empty small muted">Nessuna prestazione trovata per «{query}».</li>}
        </ul>
      )}
    </div>
  )
}
