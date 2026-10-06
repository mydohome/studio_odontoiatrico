import { useEffect, useRef, useState } from 'react'

const HEX = /^#[0-9a-f]{6}$/i

/** "7E22CE" / "#7e22ce" → "#7e22ce" (null se non è un colore esadecimale). */
export const parseHex = (raw: string): string | null => {
  const s = raw.trim().replace(/^#?/, '#').toLowerCase()
  return HEX.test(s) ? s : null
}

/** Testo bianco o scuro, a seconda di quale si legge meglio sul colore di sfondo. */
export function readableOn(hex: string): string {
  const h = parseHex(hex)
  if (!h) return '#fff'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1b1f23' : '#fff'
}

/**
 * Selettore di colore che salva solo a scelta finita. Il selettore del browser genera un evento a ogni
 * valore digitato (RGB o esadecimale): salvare e ricaricare ogni volta rifarebbe la pagina e lo
 * chiuderebbe. Qui durante la scelta cambia solo l'anteprima; si salva quando il selettore si chiude
 * (evento «change») o perde il focus.
 */
export function useColorPick(value: string, onCommit: (color: string) => void) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onCommit })
  latest.current = { value, onCommit }

  // Un colore cambiato altrove (ricaricamento dei dati) aggiorna anche l'anteprima.
  useEffect(() => setDraft(value), [value])

  const commit = (color: string) => {
    const c = parseHex(color)
    if (c && c !== latest.current.value.toLowerCase()) latest.current.onCommit(c)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => commit(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])

  return {
    draft,
    commit,
    setDraft,
    inputProps: {
      ref,
      type: 'color' as const,
      value: parseHex(draft) ?? '#000000',
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: (e: { currentTarget: { value: string } }) => commit(e.currentTarget.value),
    },
  }
}

/** Colore con anteprima e codice esadecimale modificabile (più comodo del selettore per un valore preciso). */
export function ColorInput({ value, onCommit, label, title }: { value: string; onCommit: (color: string) => void; label: string; title?: string }) {
  const { draft, commit, setDraft, inputProps } = useColorPick(value, onCommit)
  const [hex, setHex] = useState<string | null>(null)
  const shown = hex ?? draft
  const finish = () => {
    const c = hex === null ? null : parseHex(hex)
    if (c) {
      setDraft(c)
      commit(c)
    }
    setHex(null)
  }
  return (
    <span className="color-input">
      <input className="cat-color" aria-label={label} title={title} {...inputProps} />
      <input
        className="input color-hex"
        value={shown}
        onChange={(e) => setHex(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={7}
        spellCheck={false}
        aria-label={`${label} (codice esadecimale)`}
      />
    </span>
  )
}
