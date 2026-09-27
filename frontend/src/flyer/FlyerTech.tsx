import { forwardRef, type CSSProperties } from 'react'
import { fit, FitBox, FitLine, splitAddress } from './fit.tsx'
import { FLYER_HEIGHT, FLYER_WIDTH } from './Flyer.tsx'
import { formatPeriod, TECH_THEME_BY_ID, type FlyerData, type TechThemeId } from './flyerModel.ts'
import { LineToothLogo, MapPin, OfferIcon, StudioLogo, WhatsApp } from './shapes.tsx'
import './flyer-tech.css'

// Forme giuridiche mostrate in piccolo dopo il nome (es. "DentalCapri srl").
const LEGAL_SUFFIX = /^(.*?)[\s,]+(s\.?r\.?l\.?s?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?p\.?a\.?|s\.?t\.?p\.?)$/i

/**
 * Divide il nome dello studio per il logotipo in due colori:
 * "DentalCapri srl" → Dental | Capri | srl, "Studio Bianchi" → Studio | Bianchi.
 */
export function splitWordmark(name: string): { first: string; second: string; space: boolean; suffix: string } {
  let main = name.trim().replace(/\s+/g, ' ')
  let suffix = ''
  const legal = main.match(LEGAL_SUFFIX)
  if (legal && legal[1]) {
    main = legal[1]
    suffix = legal[2]
  }
  const space = main.indexOf(' ')
  if (space > 0) return { first: main.slice(0, space), second: main.slice(space + 1), space: true, suffix }
  const camel = main.match(/^([A-ZÀ-Ý]?[a-zà-ÿ]+)([A-ZÀ-Ý].*)$/)
  if (camel) return { first: camel[1], second: camel[2], space: false, suffix }
  return { first: main, second: '', space: false, suffix }
}

/** Griglia di puntini decorativa. */
function Dots({ cols, rows, gap, color, r = 3.2, style }: { cols: number; rows: number; gap: number; color: string; r?: number; style?: CSSProperties }) {
  return (
    <svg className="t-abs" width={cols * gap} height={rows * gap} style={style} aria-hidden="true">
      {Array.from({ length: rows }, (_, y) =>
        Array.from({ length: cols }, (_, x) => <circle key={`${x}-${y}`} cx={x * gap + gap / 2} cy={y * gap + gap / 2} r={r} fill={color} />),
      )}
    </svg>
  )
}

/** Calendario a linea, nello stile delle altre icone Tech. */
function CalendarLine({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="10" width="36" height="32" rx="7" />
      <path d="M6 20h36M16 5v9M32 5v9" />
      <path d="M15 29h4M24 29h4M15 35h4" strokeWidth="3.5" />
    </svg>
  )
}

const FlyerTech = forwardRef<HTMLDivElement, { data: FlyerData; logoSrc?: string | null }>(function FlyerTech({ data, logoSrc }, ref) {
  const t = TECH_THEME_BY_ID[data.theme as TechThemeId] ?? TECH_THEME_BY_ID.capri
  const vars = {
    '--t-bg': t.bg,
    '--t-surface': t.surface,
    '--t-primary': t.primary,
    '--t-accent': t.accent,
    '--t-ink': t.ink,
    '--t-muted': t.muted,
  } as CSSProperties

  const name = splitWordmark(data.studioName)
  const period = formatPeriod(data.dateFrom, data.dateTo)
  const hasBadge = data.badge.trim() !== ''
  const hasPhone = data.phone.trim() !== ''
  const items = data.items.filter((i) => i.text.trim())
  const address = splitAddress(data.address, 34)
  // Stessa dimensione per tutte le voci, decisa dalla più lunga.
  const itemSize = Math.min(...items.map((it) => fit(it.text, items.length > 2 ? 21 : 24, items.length > 2 ? 17 : 22, 16)), 24)
  const tags = data.tags.map((s) => s.trim()).filter(Boolean).slice(0, 3)

  return (
    <div ref={ref} className="flyer-tech" style={{ ...vars, width: FLYER_WIDTH, height: FLYER_HEIGHT }}>
      {/* Decorazioni di sfondo */}
      <Dots cols={7} rows={4} gap={22} color={t.accent} style={{ right: 34, top: 34, opacity: 0.45 }} />
      <div className="t-abs t-ring" style={{ right: -150, top: 120, width: 340, height: 340 }} />
      <Dots cols={5} rows={3} gap={22} color={t.primary} r={2.6} style={{ left: 30, top: 700, opacity: 0.22 }} />

      {/* Intestazione: logo + nome dello studio */}
      <header className="t-header">
        <div className="t-logo">
          <StudioLogo
            type={data.logo}
            height={104}
            customSrc={logoSrc}
            colors={{ face: t.primary, outline: t.primary, accent: t.accent, accent2: t.primary, bow: t.accent, line: t.primary, lineSmile: t.accent }}
          />
        </div>
        <div className="t-brand">
          {data.studioName.trim() && (
            <FitBox className="t-wordmark" fitKey={data.studioName} size={fit(data.studioName, 70, 13, 34)} min={30}>
              <span style={{ color: t.primary }}>{name.first}</span>
              {name.second && (
                <span style={{ color: t.accent }}>
                  {name.space ? ' ' : ''}
                  {name.second}
                </span>
              )}
              {name.suffix && <span className="t-suffix">{name.suffix}</span>}
            </FitBox>
          )}
          <div className="t-tagline">{data.tagline}</div>
          {data.doctor.trim() && <FitLine block className="t-doctor" text={data.doctor.trim()} size={24} min={16} />}
        </div>
      </header>

      {data.topQuote && (
        <div className="t-quote" style={{ fontSize: fit(data.topQuote, 25, 50, 18) }}>
          {data.topQuote}
        </div>
      )}

      {/* Riquadro principale */}
      <section className="t-hero">
        <div className="t-hero-deco" aria-hidden="true">
          <div className="t-hero-circle" style={{ right: -90, top: -110, width: 360, height: 360 }} />
          <div className="t-hero-circle" style={{ right: 40, bottom: -160, width: 260, height: 260 }} />
          <div className="t-hero-tooth">
            <LineToothLogo height={300} color="rgba(255,255,255,.16)" smile="rgba(255,255,255,.16)" />
          </div>
        </div>
        {data.headline && <FitLine block className="t-month" text={data.headline.toUpperCase()} size={30} min={20} />}
        {data.bannerTop && <FitLine block className="t-banner-top" text={data.bannerTop} size={fit(data.bannerTop, 50, 18, 30)} min={26} />}
        <FitLine block className="t-banner-main" text={data.bannerMain} size={fit(data.bannerMain, 118, 10, 56)} min={48} />
        {period && (
          <div className="t-period">
            <CalendarLine color={t.primary} size={40} />
            <FitLine text={period} size={fit(period, 32, 24, 22)} min={20} />
          </div>
        )}
      </section>

      {hasBadge && (
        <div className="t-badge">
          <FitLine text={data.badge} size={fit(data.badge, 66, 3.6, 28)} min={24} />
        </div>
      )}

      {/* Offerta */}
      <section className={`t-offer ${hasBadge ? 't-offer-badge' : ''}`}>
        <FitLine block className="t-offer-name" text={data.offerName} size={fit(data.offerName, 54, 17, 32)} min={28} />
        <div className="t-offer-bar" />
        <div className="t-items">
          {items.map((it, i) => (
            <div className="t-item-wrap" key={i}>
              {i > 0 && <span className="t-plus">+</span>}
              <div className="t-item">
                <div className="t-item-icon">
                  <OfferIcon id={it.icon} color={t.primary} size={items.length > 2 ? 58 : 66} />
                </div>
                <span style={{ fontSize: itemSize }}>{it.text}</span>
              </div>
            </div>
          ))}
        </div>
        {data.note && (
          <div className="t-note" style={{ fontSize: fit(data.note, 22, 60, 16) }}>
            {data.note}
          </div>
        )}
      </section>

      {/* Invito all'azione */}
      <div className={`t-cta-row ${hasPhone ? '' : 't-cta-solo'}`}>
        <div className="t-cta">
          <FitLine text={data.cta} size={fit(data.cta, 38, 16, 26)} min={22} />
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
        {hasPhone && (
          <div className="t-phone">
            <WhatsApp size={54} />
            <FitLine text={data.phone} size={fit(data.phone, 38, 12, 26)} min={22} />
          </div>
        )}
      </div>

      {/* Piede: indirizzo e parole chiave */}
      <footer className="t-footer">
        <div className="t-footer-line" />
        <div className="t-footer-body">
          {address.length ? (
            <div className="t-address">
              <MapPin color={t.primary} hole={t.bg} size={46} />
              <div className="t-address-text">
                {address.map((line, i) => (
                  <FitLine key={i} block text={line} size={i === 0 ? 24 : 21} min={15} />
                ))}
              </div>
            </div>
          ) : (
            <div className="t-footer-text" style={{ fontSize: fit(data.footer, 22, 40, 16) }}>
              {data.footer}
            </div>
          )}
          {tags.length > 0 && (
            <div className="t-tags">
              {tags.map((tag, i) => (
                <span key={i}>
                  {i > 0 && <i className="t-tag-dot" />}
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  )
})

export default FlyerTech
