import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** Riduce la dimensione del carattere quando il testo è lungo, per restare nello spazio disponibile. */
export function fit(text: string, base: number, maxChars: number, min = base * 0.45) {
  const len = Math.max(1, text.length)
  return Math.max(min, Math.min(base, (base * maxChars) / len))
}

/** Divide l'indirizzo su due righe (via / città) alla prima virgola, se serve. */
export function splitAddress(address: string, oneLine = 26): string[] {
  const a = address.trim()
  if (!a) return []
  const i = a.indexOf(',')
  if (a.length <= oneLine || i < 0) return [a]
  return [a.slice(0, i).trim(), a.slice(i + 1).trim()]
}

/**
 * Dimensione del carattere che fa stare il contenuto su una riga nello spazio disponibile:
 * parte da `size` e scende fino a `min`. La misura viene ripetuta quando i font sono caricati,
 * così l'esportazione in immagine usa già la dimensione finale.
 */
function useFitFont<T extends HTMLElement>(size: number, min: number, key: string) {
  const ref = useRef<T | null>(null)
  const [fontSize, setFontSize] = useState(size)
  useLayoutEffect(() => {
    let alive = true
    const measure = () => {
      const el = ref.current
      if (!alive || !el) return
      let s = size
      el.style.fontSize = `${s}px`
      while (el.scrollWidth > el.clientWidth + 1 && s > min) {
        s -= 1
        el.style.fontSize = `${s}px`
      }
      setFontSize(s)
    }
    measure()
    document.fonts?.ready.then(measure)
    return () => {
      alive = false
    }
  }, [key, size, min])
  return [ref, fontSize] as const
}

/** Testo su una riga che si rimpicciolisce finché non entra nello spazio disponibile. */
export function FitLine({
  text,
  size,
  min = Math.round(size * 0.5),
  block = false,
  className,
}: {
  text: string
  size: number
  min?: number
  block?: boolean
  className?: string
}) {
  const [ref, fontSize] = useFitFont<HTMLElement>(size, min, text)
  const style: CSSProperties = { fontSize, maxWidth: '100%', minWidth: 0, whiteSpace: 'nowrap' }
  return block ? (
    <div ref={(el) => { ref.current = el }} className={className} style={style}>
      {text}
    </div>
  ) : (
    <span ref={(el) => { ref.current = el }} className={className} style={style}>
      {text}
    </span>
  )
}

/** Come FitLine, ma per contenuti composti (es. nome dello studio in due colori). `fitKey` cambia con il testo. */
export function FitBox({
  children,
  fitKey,
  size,
  min = Math.round(size * 0.5),
  className,
}: {
  children: ReactNode
  fitKey: string
  size: number
  min?: number
  className?: string
}) {
  const [ref, fontSize] = useFitFont<HTMLDivElement>(size, min, fitKey)
  return (
    <div ref={ref} className={className} style={{ fontSize, maxWidth: '100%', minWidth: 0, whiteSpace: 'nowrap' }}>
      {children}
    </div>
  )
}
