import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { formatPeriod, THEME_BY_ID, type FlyerData } from './flyerModel.ts'
import { Brush, CalendarIcon, FamilyLogo, Heart, MapPin, OfferIcon, Splash, Swoosh, WhatsApp } from './shapes.tsx'
import './flyer.css'

export const FLYER_WIDTH = 800
export const FLYER_HEIGHT = 1200

/** Riduce la dimensione del carattere quando il testo è lungo, per restare nello spazio disponibile. */
function fit(text: string, base: number, maxChars: number, min = base * 0.45) {
  const len = Math.max(1, text.length)
  return Math.max(min, Math.min(base, (base * maxChars) / len))
}

/** Divide l'indirizzo su due righe (via / città) alla prima virgola, se serve. */
function splitAddress(address: string): string[] {
  const a = address.trim()
  if (!a) return []
  const i = a.indexOf(',')
  if (a.length <= 26 || i < 0) return [a]
  return [a.slice(0, i).trim(), a.slice(i + 1).trim()]
}

/**
 * Testo su una riga che si rimpicciolisce finché non entra nello spazio disponibile.
 * `size` è la dimensione di partenza (stima), `min` il limite inferiore. La misura viene
 * ripetuta quando i font sono caricati, così l'esportazione in PNG usa già la dimensione finale.
 */
function FitLine({
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
  const ref = useRef<HTMLElement | null>(null)
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
  }, [text, size, min])

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

// Decorazioni: tratti a raggiera e cuori sparsi (posizioni fisse).
const RAYS = [
  { x: 40, y: 235, a: -20, l: 50 },
  { x: 28, y: 280, a: 0, l: 45 },
  { x: 45, y: 325, a: 20, l: 40 },
  { x: 715, y: 235, a: 20, l: 50 },
  { x: 727, y: 280, a: 0, l: 45 },
  { x: 710, y: 325, a: -20, l: 40 },
  { x: 55, y: 560, a: 25, l: 40 },
  { x: 710, y: 560, a: -25, l: 40 },
  { x: 560, y: 745, a: -60, l: 34 },
  { x: 600, y: 760, a: -35, l: 30 },
]
const HEARTS = [
  { x: 14, y: 140, s: 64, o: 0.16 },
  { x: 718, y: 440, s: 60, o: 0.16 },
  { x: 8, y: 600, s: 76, o: 0.14 },
  { x: 736, y: 700, s: 50, o: 0.16 },
  { x: 118, y: 178, s: 40, o: 0.9, w: 5 },
]

function BrandName({ first, rest, size, lightColor }: { first: string; rest: string; size: number; lightColor: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(size)
  useLayoutEffect(() => {
    let alive = true
    const measure = () => {
      const el = ref.current
      if (!alive || !el) return
      let s = size
      el.style.fontSize = `${s}px`
      while (el.scrollWidth > el.clientWidth + 1 && s > size * 0.5) {
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
  }, [first, rest, size])
  return (
    <div ref={ref} className="f-brand-name" style={{ fontSize }}>
      <span>{first}</span>
      {rest && <span style={{ color: lightColor }}> {rest}</span>}
    </div>
  )
}

const Flyer = forwardRef<HTMLDivElement, { data: FlyerData }>(function Flyer({ data }, ref) {
  const t = THEME_BY_ID[data.theme]
  const vars = {
    '--f-bg': t.bg,
    '--f-bg2': t.bg2,
    '--f-accent': t.accent,
    '--f-heading': t.heading,
    '--f-light': t.light,
    '--f-badge': t.badge,
  } as CSSProperties

  const [nameFirst, ...nameRest] = data.studioName.trim().split(/\s+/)
  const period = formatPeriod(data.dateFrom, data.dateTo)
  const hasBadge = data.badge.trim() !== ''
  const hasPhone = data.phone.trim() !== ''
  const items = data.items.filter((i) => i.text.trim())
  const address = splitAddress(data.address)

  return (
    <div ref={ref} className="flyer" style={vars}>
      {/* Decorazioni di sfondo */}
      {HEARTS.map((h, i) => (
        <div key={i} className="f-abs" style={{ left: h.x, top: h.y, opacity: h.o }}>
          <Heart size={h.s} width={h.w ?? 4} />
        </div>
      ))}
      {RAYS.map((r, i) => (
        <div key={i} className="f-ray" style={{ left: r.x, top: r.y, width: r.l, transform: `rotate(${r.a}deg)` }} />
      ))}

      {/* Intestazione con logo */}
      <div className="f-header">
        <FamilyLogo height={124} colors={{ face: t.heading, outline: t.bg2, accent: t.accent, accent2: t.heading, bow: t.light }} />
        <div className="f-brand">
          <BrandName first={nameFirst} rest={nameRest.join(' ')} size={fit(data.studioName, 62, 15)} lightColor={t.light} />
          <Swoosh className="f-swoosh" color={t.light} w={300} h={30} from={[4, 8]} ctrl={[150, 30]} to={[296, 4]} thickness={4} />
          <div className="f-tagline">{data.tagline}</div>
        </div>
      </div>
      {data.topQuote && (
        <div className="f-top-quote" style={{ fontSize: fit(data.topQuote, 25, 46, 18) }}>
          {data.topQuote}
          <Swoosh color="#fff" w={200} h={20} from={[4, 14]} ctrl={[100, 0]} to={[196, 8]} thickness={3} />
        </div>
      )}

      {/* Mese */}
      <div className="f-block f-headline">
        <Brush color="#ffffff" seed={11} className="f-brush" />
        <FitLine text={data.headline} size={fit(data.headline, 146, 8.5)} />
      </div>

      {/* Banner principale */}
      <div className="f-block f-banner">
        <Brush color={t.accent} seed={23} className="f-brush" />
        <div className="f-banner-text">
          {data.bannerTop && <FitLine block className="f-banner-top" text={data.bannerTop} size={fit(data.bannerTop, 62, 16)} />}
          <FitLine block className="f-banner-main" text={data.bannerMain} size={fit(data.bannerMain, 104, 11)} />
        </div>
        <div className="f-banner-heart">
          <Heart size={34} width={5} />
        </div>
      </div>

      {/* Periodo */}
      {period && (
        <div className="f-block f-period">
          <Brush color="#ffffff" seed={37} className="f-brush" />
          <div className="f-period-icon">
            <CalendarIcon color={t.accent} size={84} />
          </div>
          <FitLine text={period} size={fit(period, 42, 22, 26)} min={22} />
        </div>
      )}

      {/* Nome dell'offerta */}
      <div className="f-offer-name">
        <FitLine block text={data.offerName} size={fit(data.offerName, 86, 17)} />
        <Swoosh color={t.light} w={600} h={30} from={[6, 20]} ctrl={[300, 0]} to={[594, 12]} thickness={5} />
      </div>

      {/* Riquadro offerta + etichetta */}
      <div className={`f-block f-offer ${hasBadge ? '' : 'f-offer-wide'}`}>
        <Brush color="#ffffff" seed={41} className="f-brush" />
        <div className="f-offer-body">
          <div className="f-items">
            {items.map((it, i) => (
              <div className="f-item-wrap" key={i}>
                {i > 0 && <span className="f-plus">+</span>}
                <div className="f-item">
                  <OfferIcon id={it.icon} color={t.accent} size={items.length > 2 ? 70 : 84} />
                  <span style={{ fontSize: fit(it.text, items.length > 2 ? 22 : 27, items.length > 2 ? 16 : 20, 17) }}>
                    {it.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {data.note && (
            <div className="f-note" style={{ fontSize: fit(data.note, 26, 46, 17) }}>
              {data.note}
            </div>
          )}
        </div>
      </div>
      {hasBadge && (
        <div className="f-badge">
          <Splash color={t.badge} />
          <FitLine text={data.badge} size={fit(data.badge, 80, 3.4, 30)} min={24} />
          <div className="f-badge-heart">
            <Heart size={40} color={t.heading} width={4} />
          </div>
        </div>
      )}

      {/* Invito all'azione */}
      <div className={`f-cta-row ${hasPhone ? '' : 'f-cta-solo'}`}>
        <div className="f-block f-cta">
          <Brush color="#ffffff" seed={53} className="f-brush" />
          <FitLine text={data.cta} size={fit(data.cta, 56, 15, 32)} min={26} />
        </div>
        {hasPhone && (
          <div className="f-block f-phone">
            <Brush color={t.accent} seed={61} className="f-brush" />
            <WhatsApp size={78} />
            <FitLine text={data.phone} size={fit(data.phone, 50, 11, 30)} min={24} />
          </div>
        )}
      </div>

      {/* Piede */}
      <div className="f-tags">
        {data.tags
          .filter((t) => t.trim())
          .slice(0, 3)
          .map((tag, i) => (
            <div key={i} className={`f-tag f-tag-${i}`}>
              <Heart size={16} width={6} /> {tag}
            </div>
          ))}
      </div>
      {address ? (
        <div className="f-block f-address">
          <Brush color="#ffffff" seed={71} className="f-brush" />
          <MapPin color={t.accent} size={62} />
          <div className="f-address-text">
            {address.map((line, i) => (
              <FitLine key={i} block text={line} size={fit(line, i === 0 ? 30 : 26, 22, 18)} min={16} />
            ))}
          </div>
        </div>
      ) : data.footer && (
        <div className="f-footer" style={{ fontSize: fit(data.footer, 27, 36, 20) }}>
          {data.footer}
          <Swoosh color="#fff" w={300} h={20} from={[4, 10]} ctrl={[150, 16]} to={[296, 4]} thickness={3} />
        </div>
      )}
    </div>
  )
})

export default Flyer
