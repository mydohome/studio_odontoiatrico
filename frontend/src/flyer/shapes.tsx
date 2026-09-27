// Forme grafiche del volantino: pennellate, macchia dell'etichetta, cuori, icone.

import type { IconId } from './flyerModel.ts'

/** Generatore pseudo-casuale deterministico: le forme restano identiche a ogni render. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

/** Pennellata orizzontale con bordi irregolari e setole sfrangiate alle estremità (viewBox 1000×200). */
export function brushPath(seed: number): string {
  const r = rng(seed)
  const top: string[] = []
  const bottom: string[] = []
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const x = 30 + (i / steps) * 940
    top.push(`${x.toFixed(1)},${(14 + r() * 16).toFixed(1)}`)
    bottom.push(`${x.toFixed(1)},${(186 - r() * 16).toFixed(1)}`)
  }
  // Estremità: denti irregolari come setole di pennello.
  const right: string[] = []
  for (let i = 1; i < 9; i++) {
    const y = 20 + (i / 9) * 160
    right.push(`${(970 + (i % 2 ? r() * 30 : -r() * 25)).toFixed(1)},${y.toFixed(1)}`)
  }
  const left: string[] = []
  for (let i = 8; i > 0; i--) {
    const y = 20 + (i / 9) * 160
    left.push(`${(30 - (i % 2 ? r() * 30 : -r() * 25)).toFixed(1)},${y.toFixed(1)}`)
  }
  return `M${[...top, ...right, ...bottom.reverse(), ...left].join(' L')} Z`
}

export function Brush({
  color,
  seed,
  className,
  style,
}: {
  color: string
  seed: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg className={className} style={style} viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
      <path d={brushPath(seed)} fill={color} />
      {/* strisce più chiare per l'effetto "setole" */}
      <path d={brushPath(seed + 7)} fill="#fff" opacity={color.toLowerCase() === '#ffffff' ? 0 : 0.06} />
    </svg>
  )
}

/** Macchia a punte per l'etichetta prezzo (viewBox 200×200). */
export function Splash({ color, seed = 5 }: { color: string; seed?: number }) {
  const r = rng(seed)
  const pts: string[] = []
  const n = 22
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rad = i % 2 ? 78 + r() * 8 : 92 + r() * 8
    pts.push(`${(100 + Math.cos(a) * rad).toFixed(1)},${(100 + Math.sin(a) * rad).toFixed(1)}`)
  }
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <polygon points={pts.join(' ')} fill={color} />
    </svg>
  )
}

/**
 * Sottolineatura a mano libera come forma piena (mezzaluna assottigliata alle estremità).
 * Si usa un riempimento invece del tratto perché l'esportazione in PNG perde il colore dei tratti SVG.
 */
export function Swoosh({
  color,
  w,
  h,
  from,
  ctrl,
  to,
  thickness = 6,
  className,
}: {
  color: string
  w: number
  h: number
  from: [number, number]
  ctrl: [number, number]
  to: [number, number]
  thickness?: number
  className?: string
}) {
  const d = `M${from[0]} ${from[1]} Q${ctrl[0]} ${ctrl[1]} ${to[0]} ${to[1]} Q${ctrl[0]} ${ctrl[1] + thickness * 2} ${from[0]} ${from[1]} Z`
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill={color} />
    </svg>
  )
}

export function Heart({ size = 40, color = '#fff', fill = 'none', width = 5 }: { size?: number; color?: string; fill?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M24 41S6 30 6 17.5C6 11.7 10.5 7.5 15.8 7.5c3.6 0 6.5 2 8.2 4.8 1.7-2.8 4.6-4.8 8.2-4.8C37.5 7.5 42 11.7 42 17.5 42 30 24 41 24 41z"
        fill={fill}
        stroke={color}
        strokeWidth={width}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MapPin({ color, hole = '#fff', size = 60 }: { color: string; hole?: string; size?: number }) {
  return (
    <svg width={size * 0.8} height={size} viewBox="0 0 48 60" aria-hidden="true">
      <path d="M24 58C24 58 4 35.5 4 22a20 20 0 0 1 40 0c0 13.5-20 36-20 36z" fill={color} />
      <circle cx="24" cy="22" r="8" fill={hole} />
      <ellipse cx="24" cy="58" rx="9" ry="2" fill="#000" opacity=".15" />
    </svg>
  )
}

// Sagoma del dente del logo (coordinate in un riquadro 120×120, x 14–106, y 16–107).
const TOOTH =
  'M36 16c-14 0-22 11-22 25 0 16 8 24 10 38 2 13 6 28 14 28 7 0 7-12 10-22 2-6 5-9 12-9s10 3 12 9c3 10 3 22 10 22 8 0 12-15 14-28 2-14 10-22 10-38 0-14-8-25-22-25-10 0-15 6-24 6s-14-6-24-6z'

export interface LogoColors {
  /** Colore dei tratti del viso. */
  face: string
  /** Contorno dei dentini (tono scuro del tema, separa i denti sovrapposti). */
  outline: string
  /** Accessori (papillon, fiocchi). */
  accent: string
  /** Secondo colore per gli accessori (guance, lentiggini). */
  accent2: string
  /** Fiocco della mamma: deve staccarsi dallo sfondo del volantino. */
  bow: string
}

/** Un dentino con faccina; `extra` aggiunge i dettagli del personaggio. */
function ToothFace({ x, y, scale, c, extra, smile = 'M44 60c4 6 10 9 16 9s12-3 16-9' }: {
  x: number
  y: number
  scale: number
  c: LogoColors
  extra?: React.ReactNode
  smile?: string
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={TOOTH} fill="#fff" stroke={c.outline} strokeWidth={5 / scale} strokeLinejoin="round" />
      <circle cx="46" cy="45" r="4.6" fill={c.face} />
      <circle cx="74" cy="45" r="4.6" fill={c.face} />
      <circle cx="47.5" cy="43.5" r="1.4" fill="#fff" />
      <circle cx="75.5" cy="43.5" r="1.4" fill="#fff" />
      <path d={smile} fill="none" stroke={c.face} strokeWidth="5" strokeLinecap="round" />
      {extra}
    </g>
  )
}

/**
 * Logo "famiglia di dentini": papà, mamma e due figli.
 * I dentini sono bianchi; viso, contorni e accessori seguono i colori del tema del volantino.
 */
export function FamilyLogo({ height = 128, colors }: { height?: number; colors: LogoColors }) {
  const c = colors
  const cheeks = (
    <>
      <ellipse cx="36" cy="57" rx="6" ry="4" fill={c.accent2} opacity=".35" />
      <ellipse cx="84" cy="57" rx="6" ry="4" fill={c.accent2} opacity=".35" />
    </>
  )
  return (
    <svg height={height} width={(height * 250) / 160} viewBox="0 0 250 160" aria-hidden="true">
      {/* Papà: baffi e papillon */}
      <ToothFace
        x={-8}
        y={-6}
        scale={1.12}
        c={c}
        smile="M47 66c4 4 8 6 13 6s9-2 13-6"
        extra={
          <>
            <path d="M40 38l10-3M70 35l10 3" stroke={c.face} strokeWidth="4" strokeLinecap="round" />
            <path d="M44 59c5-6 11-6 16-1 5-5 11-5 16 1-5 4-11 4-16 0-5 4-11 4-16 0z" fill={c.face} />
            <path d="M48 80l12 6 12-6v14l-12-6-12 6z" fill={c.accent} stroke={c.accent} strokeWidth="2" strokeLinejoin="round" />
            <circle cx="60" cy="87" r="3.6" fill={c.accent} stroke="#fff" strokeWidth="1.5" />
          </>
        }
      />
      {/* Mamma: ciglia, guance e fiocco */}
      <ToothFace
        x={112}
        y={2}
        scale={1.04}
        c={c}
        extra={
          <>
            <path d="M40 40l-4-4M44 38l-2-5M80 40l4-4M76 38l2-5" stroke={c.face} strokeWidth="3" strokeLinecap="round" />
            {cheeks}
            <g transform="translate(86 16) rotate(20)">
              <path d="M0 0L-15 -9V9zM0 0L15 -9V9z" fill={c.bow} stroke={c.outline} strokeWidth="2.5" strokeLinejoin="round" />
              <circle r="4.5" fill={c.bow} stroke={c.outline} strokeWidth="2" />
            </g>
          </>
        }
      />
      {/* Figlio: ciuffo e lentiggini */}
      <ToothFace
        x={74}
        y={66}
        scale={0.72}
        c={c}
        smile="M44 58c4 8 10 11 16 11s12-3 16-11z"
        extra={
          <>
            <path d="M58 20c-2-8 3-13 9-12-4 3-4 7-1 10" fill="none" stroke={c.outline} strokeWidth="4" strokeLinecap="round" />
            <g fill={c.accent2} opacity=".6">
              <circle cx="36" cy="54" r="2" />
              <circle cx="41" cy="58" r="2" />
              <circle cx="84" cy="54" r="2" />
              <circle cx="79" cy="58" r="2" />
            </g>
          </>
        }
      />
      {/* Figlia: due fiocchetti */}
      <ToothFace
        x={160}
        y={80}
        scale={0.64}
        c={c}
        extra={
          <>
            {cheeks}
            {[
              [26, 22, -25],
              [94, 22, 25],
            ].map(([bx, by, r]) => (
              <g key={bx} transform={`translate(${bx} ${by}) rotate(${r})`}>
                <path d="M0 0L-12 -8V8zM0 0L12 -8V8z" fill={c.accent} stroke={c.accent} strokeWidth="3" strokeLinejoin="round" />
                <circle r="4" fill={c.accent} stroke="#fff" strokeWidth="1.5" />
              </g>
            ))}
          </>
        }
      />
      {/* Stellina brillante */}
      <path d="M232 4l3.5 8.5 8.5 3.5-8.5 3.5-3.5 8.5-3.5-8.5-8.5-3.5 8.5-3.5z" fill="#fff" />
      <path d="M8 118l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".85" />
    </svg>
  )
}

/** Logo pronto "Dente sorridente": contorno bianco con stellina (il logo originale). */
export function ToothLogo({ height = 128, color = '#fff' }: { height?: number; color?: string }) {
  return (
    <svg height={height} width={height} viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
      <path d={TOOTH} />
      <path d="M44 58c4 6 10 9 16 9s12-3 16-9" />
      <circle cx="45" cy="44" r="2.5" fill={color} />
      <circle cx="75" cy="44" r="2.5" fill={color} />
      <path d="M100 6l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" strokeWidth="3" />
    </svg>
  )
}

/** Logo pronto "Dente con cuore": dentino bianco che abbraccia un cuore nel colore del tema. */
export function HeartToothLogo({ height = 128, colors }: { height?: number; colors: LogoColors }) {
  const c = colors
  return (
    <svg height={height} width={(height * 150) / 128} viewBox="0 0 150 128" aria-hidden="true">
      <ToothFace x={0} y={0} scale={1.04} c={c} />
      <g transform="translate(108 92) rotate(14) scale(0.82)">
        <path
          d="M0 34S-30 16-30-4c0-9 7-16 15-16 6 0 11 3 15 8 4-5 9-8 15-8 8 0 15 7 15 16C30 16 0 34 0 34z"
          fill={c.accent}
          stroke="#fff"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M-16-6c1-4 4-7 8-7" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".7" />
      </g>
      <path d="M140 6l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" />
    </svg>
  )
}

export type LogoType = 'famiglia' | 'dente' | 'cuore' | 'custom'

export const LOGO_OPTIONS: { id: Exclude<LogoType, 'custom'>; label: string }[] = [
  { id: 'famiglia', label: 'Famiglia di dentini' },
  { id: 'dente', label: 'Dente sorridente' },
  { id: 'cuore', label: 'Dente con cuore' },
]

/**
 * Logo dello studio: uno di quelli pronti (colorati con il tema) oppure l'immagine caricata.
 * `customSrc` deve essere già un data URL, così l'esportazione in immagine lo include sempre.
 */
export function StudioLogo({
  type,
  height,
  colors,
  customSrc,
}: {
  type: LogoType
  height: number
  colors: LogoColors
  customSrc?: string | null
}) {
  if (type === 'custom' && customSrc) {
    return <img src={customSrc} alt="" style={{ height, maxWidth: height * 1.8, objectFit: 'contain', display: 'block' }} />
  }
  if (type === 'dente') return <ToothLogo height={height} />
  if (type === 'cuore') return <HeartToothLogo height={height} colors={colors} />
  return <FamilyLogo height={height} colors={colors} />
}

export function WhatsApp({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#25d366" />
      <path d="M13 51l3.4-10.2A20 20 0 1 1 24 48.6z" fill="#fff" />
      <path d="M17 47.5l2.4-7.1A16.5 16.5 0 1 1 25 45.6z" fill="#25d366" />
      <path
        d="M25.5 22.5c.6-.6 1.8-.8 2.4.2l2 4c.3.7.1 1.4-.4 1.9l-1.2 1.2c1 2.4 3.4 4.8 5.8 5.8l1.2-1.2c.5-.5 1.2-.7 1.9-.4l4 2c1 .6.8 1.8.2 2.4l-1.6 1.6c-1.7 1.7-5.3 1-9.6-2.6-4.3-3.6-6.8-7.9-6.3-10.2.2-1 .8-1.9 1.6-2.7z"
        fill="#fff"
      />
    </svg>
  )
}

export function CalendarIcon({ color, size = 64 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round">
      <rect x="6" y="12" width="52" height="46" rx="8" fill="#fff" />
      <path d="M6 24h52" />
      <path d="M20 6v12M44 6v12" strokeLinecap="round" />
      <path d="M32 50s-9-5-9-11c0-2.8 2-4.6 4.4-4.6 2 0 3.4 1.2 4.6 2.6 1.2-1.4 2.6-2.6 4.6-2.6 2.4 0 4.4 1.8 4.4 4.6 0 6-9 11-9 11z" fill={color} stroke="none" />
    </svg>
  )
}

/** Icone delle voci dell'offerta (tratto singolo, colore del tema). */
export function OfferIcon({ id, color, size = 96 }: { id: IconId; color: string; size?: number }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const tooth = 'M28 14c-10 0-16 8-16 18 0 12 6 17 7 27 1 9 4 20 10 20 5 0 5-9 7-16 1-4 4-7 9-7s8 3 9 7c2 7 2 16 7 16 6 0 9-11 10-20 1-10 7-15 7-27 0-10-6-18-16-18-7 0-11 4-17 4s-10-4-17-4z'
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      {id === 'check' && (
        <g {...common}>
          <path d={tooth} transform="translate(-4 0) scale(.9)" />
          <circle cx="62" cy="58" r="14" fill="#fff" />
          <path d="M72 68l14 14" strokeWidth="7" />
        </g>
      )}
      {id === 'xray' && (
        <g {...common}>
          <rect x="6" y="18" width="84" height="60" rx="10" />
          <rect x="14" y="26" width="68" height="44" rx="6" fill={color} opacity=".15" />
          <path d="M20 40c8-6 48-6 56 0M20 56c8 6 48 6 56 0" />
          {[28, 38, 48, 58, 68].map((x) => (
            <path key={x} d={`M${x} 38v6M${x} 52v6`} strokeWidth="4" />
          ))}
        </g>
      )}
      {id === 'clean' && (
        <g {...common}>
          <path d={tooth} transform="translate(6 10) scale(.8)" />
          <path d="M70 8l16 16M60 18l8-8 16 16-8 8z" />
          <path d="M18 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" strokeWidth="3" />
        </g>
      )}
      {id === 'sparkle' && (
        <g {...common}>
          <path d={tooth} transform="translate(0 8) scale(.85)" />
          <path d="M76 8l3 8 8 3-8 3-3 8-3-8-8-3 8-3zM84 40l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" strokeWidth="3" />
        </g>
      )}
      {id === 'shield' && (
        <g {...common}>
          <path d="M48 8l32 12v24c0 22-14 36-32 44C30 80 16 66 16 44V20z" />
          <path d="M34 48l10 10 20-22" />
        </g>
      )}
      {id === 'child' && (
        <g {...common}>
          <circle cx="48" cy="50" r="34" />
          <path d="M34 60c4 6 9 9 14 9s10-3 14-9" />
          <circle cx="36" cy="44" r="3" fill={color} />
          <circle cx="60" cy="44" r="3" fill={color} />
          <path d="M40 16c2-6 6-8 10-8-2 4 0 8 4 10" />
        </g>
      )}
      {id === 'aligner' && (
        <g {...common}>
          <path d="M10 44c0-16 16-28 38-28s38 12 38 28" />
          <path d="M16 46c4 14 16 24 32 24s28-10 32-24" />
          {[26, 38, 50, 62, 74].map((x) => (
            <path key={x} d={`M${x} 30v14`} strokeWidth="4" />
          ))}
          <path d="M14 44h68" strokeWidth="3" opacity=".6" />
        </g>
      )}
      {id === 'implant' && (
        <g {...common}>
          <path d="M26 14c-8 0-12 6-12 12 0 6 4 10 34 10s34-4 34-10c0-6-4-12-12-12-6 0-10 4-22 4s-16-4-22-4z" />
          <path d="M38 40h20l-2 44H40z" />
          <path d="M36 52h24M36 62h22M38 72h18" strokeWidth="4" />
        </g>
      )}
      {id === 'card' && (
        <g {...common}>
          <rect x="8" y="22" width="80" height="52" rx="8" />
          <path d="M8 38h80" strokeWidth="8" />
          <path d="M20 60h20M52 60h8" />
        </g>
      )}
      {id === 'gift' && (
        <g {...common}>
          <rect x="12" y="36" width="72" height="50" rx="6" />
          <path d="M8 26h80v12H8zM48 26v60" />
          <path d="M48 26c-6-12-22-16-22-6 0 6 12 6 22 6zM48 26c6-12 22-16 22-6 0 6-12 6-22 6z" />
        </g>
      )}
      {id === 'heart' && (
        <path
          {...common}
          d="M48 82S14 62 14 36c0-10 8-18 18-18 7 0 12 4 16 9 4-5 9-9 16-9 10 0 18 8 18 18 0 26-34 46-34 46z"
        />
      )}
    </svg>
  )
}
