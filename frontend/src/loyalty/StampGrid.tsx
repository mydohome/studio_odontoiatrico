import { Gift } from 'lucide-react'
import type { CSSProperties } from 'react'
import { loyaltyTheme, type LoyaltyTheme } from './theme.ts'

// Sagoma del dentino: la stessa del logo dell'app (viewBox 24).
const TOOTH =
  'M7.5 3C5 3 3.5 5 3.5 7.5c0 3 1.5 4.5 2 7.5.4 2.8 1.2 6 2.8 6 1.4 0 1.5-2.6 2.2-4.6.3-.9.8-1.4 1.5-1.4s1.2.5 1.5 1.4c.7 2 .8 4.6 2.2 4.6 1.6 0 2.4-3.2 2.8-6 .5-3 2-4.5 2-7.5C20.5 5 19 3 16.5 3 14.5 3 13.6 4.2 12 4.2S9.5 3 7.5 3z'

function Tooth({ filled, theme, last }: { filled: boolean; theme: LoyaltyTheme; last: boolean }) {
  if (last) {
    // L'ultimo posto è il premio.
    return (
      <span className={`lc-slot lc-prize ${filled ? 'is-on' : ''}`} style={{ color: filled ? theme.filledInk : theme.empty, background: filled ? theme.filled : 'transparent', borderColor: filled ? theme.filled : theme.empty }}>
        <Gift size="55%" strokeWidth={2.2} aria-hidden />
      </span>
    )
  }
  return (
    <svg className={`lc-slot ${filled ? 'is-on' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <>
          <path d={TOOTH} fill={theme.filled} stroke={theme.filled} strokeWidth="1.2" strokeLinejoin="round" />
          {/* Segno di spunta: timbro ottenuto. */}
          <path d="M8.2 10.4l2.6 2.6 4.8-5" fill="none" stroke={theme.filledInk} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d={TOOTH} fill="none" stroke={theme.empty} strokeOpacity="0.55" strokeWidth="1.3" strokeLinejoin="round" strokeDasharray="2.2 2" />
      )}
    </svg>
  )
}

/**
 * Griglia dei timbri: un dentino per ogni timbro (pieno = ottenuto, tratteggiato = mancante) e, come
 * ultimo posto, il premio. Si adatta al numero di timbri richiesti (da 1 a 50).
 */
export default function StampGrid({ stamps, required, style, className = '' }: { stamps: number; required: number; style?: 'smile' | 'mint'; className?: string }) {
  const theme = loyaltyTheme(style)
  // Righe da 5 (fino a 10 timbri) o da 6/7/8 per quelle più lunghe: sempre ben leggibili.
  const cols = required <= 10 ? 5 : required <= 18 ? 6 : required <= 28 ? 7 : 8
  return (
    <div
      className={`lc-grid ${className}`}
      style={{ '--cols': cols } as CSSProperties}
      role="img"
      aria-label={`${Math.min(stamps, required)} timbri su ${required}`}
    >
      {Array.from({ length: required }, (_, i) => (
        <Tooth key={i} filled={i < stamps} theme={theme} last={i === required - 1} />
      ))}
    </div>
  )
}
