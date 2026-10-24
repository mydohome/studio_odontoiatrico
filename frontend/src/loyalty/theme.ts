// Colori della fidelity card: seguono il modello grafico dei volantini scelto dallo studio
// (Smile rosa e colorato, Mint blu e pulito), come le gift card.

import { MINT_THEME_BY_ID, THEME_BY_ID } from '../flyer/flyerModel.ts'

export interface LoyaltyTheme {
  /** Sfondo della carta. */
  bg: string
  /** Testo principale e secondario sulla carta. */
  ink: string
  sub: string
  /** Dentino ottenuto: riempimento e segno. */
  filled: string
  filledInk: string
  /** Dentino mancante: contorno. */
  empty: string
  /** Colore del pulsante e dei dettagli. */
  accent: string
  /** Colore della barra del browser / dell'icona. */
  chrome: string
}

export function loyaltyTheme(style: 'smile' | 'mint' | undefined): LoyaltyTheme {
  if (style === 'mint') {
    const m = MINT_THEME_BY_ID.capri
    return {
      bg: `linear-gradient(135deg, ${m.surface} 0%, #ffffff 60%, ${m.surface} 100%)`,
      ink: m.ink,
      sub: m.muted,
      filled: m.primary,
      filledInk: '#ffffff',
      empty: m.muted,
      accent: m.primary,
      chrome: m.primary,
    }
  }
  const r = THEME_BY_ID.rosa
  return {
    bg: `linear-gradient(135deg, ${r.bg} 0%, ${r.bg2} 100%)`,
    ink: '#ffffff',
    sub: 'rgba(255,255,255,0.88)',
    filled: '#ffffff',
    filledInk: r.bg2,
    empty: '#ffffff',
    accent: r.bg2,
    chrome: r.bg,
  }
}
