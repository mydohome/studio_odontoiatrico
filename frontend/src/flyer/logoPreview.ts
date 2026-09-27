// Colori con cui mostrare i loghi pronti fuori dal volantino (impostazioni, pagina di accesso):
// tema rosa per Smile, blu e acquamarina per Mint.
import { MINT_THEME_BY_ID, THEME_BY_ID, type FlyerStyle } from './flyerModel.ts'
import type { LogoColors } from './shapes.tsx'

const ROSA = THEME_BY_ID.rosa
const CAPRI = MINT_THEME_BY_ID.capri

export const LOGO_PREVIEWS: Record<FlyerStyle, { bg: string; colors: LogoColors }> = {
  smile: {
    bg: ROSA.bg,
    colors: { face: ROSA.heading, outline: ROSA.bg2, accent: ROSA.accent, accent2: ROSA.heading, bow: ROSA.light },
  },
  mint: {
    bg: CAPRI.surface,
    colors: { face: CAPRI.primary, outline: CAPRI.primary, accent: CAPRI.accent, accent2: CAPRI.primary, bow: CAPRI.accent, line: CAPRI.primary, lineSmile: CAPRI.accent },
  },
}
