// Contenuti del volantino generati a partire da una campagna suggerita.
// Tutti i campi restano modificabili dall'utente nell'editor.

import { daysInMonth, fromISO, MONTHS, monthIndex } from '../../../shared/dates.ts'
import type { CampaignSuggestion, CategoryId } from '../../../shared/types.ts'

export type ThemeId = 'rosa' | 'blu' | 'verde' | 'viola' | 'arancio'

export interface FlyerTheme {
  id: ThemeId
  label: string
  bg: string
  bg2: string
  /** Pennellata del banner principale e del telefono. */
  accent: string
  /** Colore dei testi scritti sulle pennellate bianche. */
  heading: string
  /** Colore secondario (seconda riga del logo, sottolineature). */
  light: string
  /** Macchia dell'etichetta prezzo. */
  badge: string
}

export const THEMES: FlyerTheme[] = [
  { id: 'rosa', label: 'Rosa', bg: '#ee1f80', bg2: '#c80d68', accent: '#1d55b3', heading: '#e3196f', light: '#5cc8f7', badge: '#ffe53b' },
  { id: 'blu', label: 'Blu', bg: '#1a6fd0', bg2: '#0d4c9c', accent: '#ec1e7e', heading: '#1664c2', light: '#ffd84a', badge: '#ffe53b' },
  { id: 'verde', label: 'Verde acqua', bg: '#10a89e', bg2: '#0a7c75', accent: '#1d55b3', heading: '#0b8c84', light: '#ffe066', badge: '#ffe53b' },
  { id: 'viola', label: 'Viola', bg: '#7d41d4', bg2: '#5a27a6', accent: '#ff4f9a', heading: '#6c33c2', light: '#8be4ff', badge: '#ffe53b' },
  { id: 'arancio', label: 'Arancio', bg: '#ff7d1f', bg2: '#e05a00', accent: '#1d55b3', heading: '#e3630a', light: '#5cc8f7', badge: '#fff04d' },
]
export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, FlyerTheme>

/** Modello grafico dei volantini: "Smile" (colorato, a pennellate) o "Tech" (pulito, tecnologico). */
export type FlyerStyle = 'smile' | 'tech'

export const FLYER_STYLES: { id: FlyerStyle; label: string; hint: string }[] = [
  { id: 'smile', label: 'Smile', hint: 'Colorato e allegro, con pennellate e scritte a mano' },
  { id: 'tech', label: 'Tech', hint: 'Pulito e tecnologico, con forme geometriche e caratteri moderni' },
]

export type TechThemeId = 'capri' | 'notte' | 'menta'

export interface TechTheme {
  id: TechThemeId
  label: string
  /** Sfondo del volantino. */
  bg: string
  /** Riquadri delle voci e fondo del piè di pagina. */
  surface: string
  /** Colore principale (prima parte del nome, pulsanti). */
  primary: string
  /** Colore d'accento (seconda parte del nome, sorriso del logo, dettagli). */
  accent: string
  /** Testo principale. */
  ink: string
  /** Testo secondario. */
  muted: string
}

export const TECH_THEMES: TechTheme[] = [
  { id: 'capri', label: 'Blu e acquamarina', bg: '#ffffff', surface: '#eef4fb', primary: '#3868bd', accent: '#4ecdbd', ink: '#16305d', muted: '#5d7091' },
  { id: 'notte', label: 'Notte', bg: '#0c1a35', surface: '#14284c', primary: '#4a86e3', accent: '#5fe0cf', ink: '#ffffff', muted: '#a8b9d6' },
  { id: 'menta', label: 'Menta', bg: '#f3fbf9', surface: '#dff4ef', primary: '#0f978b', accent: '#3868bd', ink: '#10384a', muted: '#4f6f78' },
]
export const TECH_THEME_BY_ID = Object.fromEntries(TECH_THEMES.map((t) => [t.id, t])) as Record<TechThemeId, TechTheme>

/** Colori selezionabili per un modello, nel formato usato dai pulsanti dell'editor. */
export function themeSwatches(style: FlyerStyle): { id: ThemeId | TechThemeId; label: string; a: string; b: string }[] {
  return style === 'tech'
    ? TECH_THEMES.map((t) => ({ id: t.id, label: t.label, a: t.primary, b: t.accent }))
    : THEMES.map((t) => ({ id: t.id, label: t.label, a: t.bg, b: t.accent }))
}

export const isTechTheme = (id: string): id is TechThemeId => id in TECH_THEME_BY_ID

/** Colore di fondo del volantino (per le esportazioni in JPG e PDF). */
export const flyerBackground = (theme: ThemeId | TechThemeId) =>
  isTechTheme(theme) ? TECH_THEME_BY_ID[theme].bg : THEME_BY_ID[theme].bg

export type IconId =
  | 'check'
  | 'xray'
  | 'clean'
  | 'sparkle'
  | 'shield'
  | 'child'
  | 'aligner'
  | 'implant'
  | 'card'
  | 'gift'
  | 'heart'

export const ICON_LABELS: Record<IconId, string> = {
  check: 'Check-up',
  xray: 'Radiografia',
  clean: 'Igiene',
  sparkle: 'Estetica',
  shield: 'Protezione',
  child: 'Bambini',
  aligner: 'Ortodonzia',
  implant: 'Impianto',
  card: 'Pagamento',
  gift: 'Regalo',
  heart: 'Cuore',
}

export interface FlyerItem {
  icon: IconId
  text: string
}

export interface FlyerData {
  /** Combinazione di colori: di "Smile" (ThemeId) o di "Tech" (TechThemeId), in base al modello. */
  theme: ThemeId | TechThemeId
  studioName: string
  tagline: string
  /** Nome del dottore, sotto "Studio odontoiatrico" (vuoto = riga nascosta). */
  doctor: string
  /** Logo in alto a sinistra: uno di quelli pronti oppure quello caricato dallo studio. */
  logo: 'famiglia' | 'dente' | 'cuore' | 'linea' | 'custom'
  topQuote: string
  headline: string
  bannerTop: string
  bannerMain: string
  dateFrom: string
  dateTo: string
  offerName: string
  items: FlyerItem[]
  note: string
  badge: string
  cta: string
  phone: string
  /** Indirizzo dello studio: in basso a destra con il segnaposto (se vuoto si mostra `footer`). */
  address: string
  footer: string
  tags: string[]
}

interface CategoryCopy {
  theme: ThemeId
  bannerTop: string
  bannerMain: string
  offerName: string
  topQuote: string
  footer: string
  tags: [string, string, string]
}

// Testi di base per categoria.
const COPY: Record<CategoryId, CategoryCopy> = {
  prevenzione: {
    theme: 'rosa',
    bannerTop: 'Il mese della',
    bannerMain: 'PREVENZIONE',
    offerName: 'Sorriso In Salute',
    topQuote: 'La prevenzione è il più bel sorriso di domani!',
    footer: 'La salute del tuo sorriso è la nostra priorità',
    tags: ['Sorrisi', 'Salute', 'Famiglia'],
  },
  diagnostica: {
    theme: 'blu',
    bannerTop: 'Il tuo',
    bannerMain: 'CHECK-UP',
    offerName: 'Diagnosi Chiara',
    topQuote: 'Conoscere per curare al momento giusto!',
    footer: 'Tecnologia digitale al servizio del tuo sorriso',
    tags: ['Precisione', 'Salute', 'Serenità'],
  },
  conservativa: {
    theme: 'verde',
    bannerTop: 'Cura il tuo',
    bannerMain: 'SORRISO',
    offerName: 'Denti Sani',
    topQuote: 'Intervenire presto fa la differenza!',
    footer: 'Cure delicate per denti forti',
    tags: ['Cura', 'Salute', 'Benessere'],
  },
  estetica: {
    theme: 'rosa',
    bannerTop: 'Il tuo sorriso',
    bannerMain: 'SPLENDENTE',
    offerName: 'Sorriso Luminoso',
    topQuote: 'Un sorriso bianco ti cambia la giornata!',
    footer: 'Sorridi con fiducia, ogni giorno',
    tags: ['Bellezza', 'Luce', 'Fiducia'],
  },
  ortodonzia: {
    theme: 'viola',
    bannerTop: 'Un sorriso',
    bannerMain: 'ALLINEATO',
    offerName: 'Sorriso Perfetto',
    topQuote: 'Un sorriso dritto è per sempre!',
    footer: 'Ortodonzia per grandi e piccoli',
    tags: ['Sorrisi', 'Armonia', 'Famiglia'],
  },
  chirurgia: {
    theme: 'blu',
    bannerTop: 'Torna a',
    bannerMain: 'SORRIDERE',
    offerName: 'Sorriso Completo',
    topQuote: 'Ogni dente conta!',
    footer: 'Implantologia sicura, con pagamenti su misura',
    tags: ['Sicurezza', 'Salute', 'Serenità'],
  },
  protesi: {
    theme: 'verde',
    bannerTop: 'Torna a',
    bannerMain: 'MASTICARE',
    offerName: 'Sorriso Sereno',
    topQuote: 'Mangiare bene è tornare a vivere!',
    footer: 'Soluzioni protesiche comode e naturali',
    tags: ['Comfort', 'Salute', 'Serenità'],
  },
  pedodonzia: {
    theme: 'arancio',
    bannerTop: 'Sorrisi',
    bannerMain: 'PICCOLI',
    offerName: 'Piccoli Sorrisi',
    topQuote: 'I denti dei bambini meritano il meglio!',
    footer: 'Un dentista amico dei più piccoli',
    tags: ['Bambini', 'Gioco', 'Famiglia'],
  },
}

// Testi dedicati alle campagne stagionali (indice = mese, 0 = gennaio).
const CALENDAR_COPY: Partial<CategoryCopy>[] = [
  { bannerTop: 'Anno nuovo,', bannerMain: 'SORRISO SANO', offerName: 'Buoni Propositi' },
  { bannerTop: 'San Valentino', bannerMain: 'SORRIDI', offerName: 'Sorriso Innamorato', topQuote: 'Il regalo più bello è un sorriso!' },
  { bannerTop: 'Primavera', bannerMain: 'DI SORRISI', offerName: 'Sorriso In Fiore' },
  { bannerTop: 'Sposi e', bannerMain: 'CERIMONIE', offerName: 'Sorriso Da Favola', topQuote: 'Il giorno più bello merita il sorriso più bello!' },
  { bannerTop: "Pronti per", bannerMain: "L'ESTATE", offerName: 'Sorriso Al Sole' },
  { bannerTop: 'Finita la', bannerMain: 'SCUOLA', offerName: 'Estate Sorridente' },
  { bannerTop: 'Prima delle', bannerMain: 'VACANZE', offerName: 'Parti Sereno', topQuote: 'In vacanza senza pensieri!' },
  { bannerTop: "Sorrisi", bannerMain: "D'ESTATE", offerName: 'Estate Allineata' },
  { bannerTop: 'Si torna a', bannerMain: 'SCUOLA', offerName: 'Zaino e Sorriso', topQuote: 'Un sorriso sano per il nuovo anno!' },
  { bannerTop: 'Mese della', bannerMain: 'PREVENZIONE', offerName: 'Sorriso In Salute' },
  { bannerTop: 'Detrai entro', bannerMain: 'FINE ANNO', offerName: 'Cure Senza Pensieri', topQuote: 'Le spese dentistiche sono detraibili al 19%!' },
  { bannerTop: 'Regala un', bannerMain: 'SORRISO', offerName: 'Natale Sorridente', topQuote: 'Il regalo più bello è un sorriso!' },
]

// Riconoscimento delle voci dell'offerta nel testo della campagna.
const ITEM_RULES: { re: RegExp; icon: IconId; text: string }[] = [
  { re: /igiene/i, icon: 'clean', text: 'Igiene professionale' },
  { re: /check-?up|visita di controllo|controllo/i, icon: 'check', text: 'Check-up dentistico completo' },
  { re: /prima visita|visita ortodontica/i, icon: 'check', text: 'Prima visita' },
  { re: /visita pedodontica/i, icon: 'child', text: 'Visita pedodontica' },
  { re: /visita protesica/i, icon: 'check', text: 'Visita protesica' },
  { re: /ortopanoramica|radiograf|rx/i, icon: 'xray', text: 'Ortopanoramica' },
  { re: /tac/i, icon: 'xray', text: 'TAC Cone Beam' },
  { re: /sbiancament/i, icon: 'sparkle', text: 'Sbiancamento professionale' },
  { re: /faccett/i, icon: 'sparkle', text: 'Faccette estetiche' },
  { re: /simulazione|consulenza estetica/i, icon: 'sparkle', text: 'Consulenza estetica' },
  { re: /sigillatur/i, icon: 'shield', text: 'Sigillature' },
  { re: /scansione 3d|allineator/i, icon: 'aligner', text: 'Scansione 3D' },
  { re: /screening ortodontico/i, icon: 'aligner', text: 'Screening ortodontico' },
  { re: /impiant|implant/i, icon: 'implant', text: 'Consulenza implantologica' },
  { re: /ribasatura|protesi/i, icon: 'implant', text: 'Controllo protesi' },
  { re: /otturazion|carie/i, icon: 'check', text: 'Cura delle carie' },
  { re: /gift card|regal/i, icon: 'gift', text: 'Gift card' },
  { re: /kit/i, icon: 'gift', text: 'Kit di mantenimento' },
  { re: /rate|rateizz|finanziament|tasso zero/i, icon: 'card', text: 'Pagamento a rate' },
  { re: /detra/i, icon: 'card', text: 'Spese detraibili 19%' },
]

function itemsFromOffer(offer: string, category: CategoryId): FlyerItem[] {
  const found: { pos: number; item: FlyerItem }[] = []
  for (const r of ITEM_RULES) {
    const m = offer.match(r.re)
    if (m?.index === undefined) continue
    if (found.some((f) => f.item.text === r.text || f.item.icon === r.icon)) continue
    found.push({ pos: m.index, item: { icon: r.icon, text: r.text } })
  }
  const items = found.sort((a, b) => a.pos - b.pos).map((f) => f.item).slice(0, 3)
  if (items.length) return items
  const icon: IconId = category === 'pedodonzia' ? 'child' : category === 'estetica' ? 'sparkle' : 'check'
  return [{ icon, text: offer.split(/[,.;]/)[0].slice(0, 40).trim() }]
}

function badgeFromOffer(offer: string): string {
  const pct = offer.match(/(\d{1,2})\s?%/)
  // Una percentuale nel testo (-25%, "scontato del 25%", "sconto del 10%") diventa lo sconto.
  if (pct && !/detra/i.test(offer)) return `-${pct[1]}%`
  if (/gratuit|omaggio/i.test(offer)) return 'GRATIS'
  if (/\brate\b|rateizz|tasso zero|finanziament/i.test(offer)) return 'A RATE'
  return ''
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatPeriod(from: string, to: string): string {
  if (!from || !to) return ''
  const a = fromISO(from)
  const b = fromISO(to)
  const ma = MONTHS[a.getMonth()]
  const mb = MONTHS[b.getMonth()]
  if (from === to) return `solo il ${pad(a.getDate())} ${ma}`
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `dal ${pad(a.getDate())} al ${pad(b.getDate())} ${ma}`
  }
  return `dal ${pad(a.getDate())} ${ma} al ${pad(b.getDate())} ${mb}`
}

export function buildFlyer(
  campaign: CampaignSuggestion,
  month: string,
  studio: { studioName: string; phone: string; address: string; doctorName?: string; logoType?: FlyerData['logo'] },
  period?: { from: string; to: string },
  style: FlyerStyle = 'smile',
): FlyerData {
  const m = monthIndex(month)
  const base = COPY[campaign.category]
  let copy: CategoryCopy = { ...base }

  switch (campaign.type) {
    case 'calendario':
      copy = { ...copy, ...CALENDAR_COPY[m] }
      break
    case 'richiamo':
      copy = { ...copy, bannerTop: 'È tempo del tuo', bannerMain: 'CONTROLLO', offerName: 'Ci Vediamo Presto' }
      break
    case 'conversione':
      copy = { ...copy, bannerTop: 'Completa le tue', bannerMain: 'CURE', offerName: 'Sorriso Senza Pensieri' }
      break
    case 'trend':
      copy = { ...copy, bannerTop: 'Ti aspettiamo', bannerMain: 'IN STUDIO', offerName: 'Bentornato Sorriso' }
      break
    case 'personalizzata':
      // Il titolo scelto dall'utente diventa il nome dell'offerta (se non è troppo lungo).
      if (campaign.title.length <= 28) copy = { ...copy, offerName: campaign.title }
      break
  }

  return {
    // Tech usa sempre la combinazione principale (i colori dello studio); Smile cambia colore per categoria.
    theme: style === 'tech' ? 'capri' : copy.theme,
    studioName: studio.studioName,
    tagline: 'Studio odontoiatrico',
    doctor: studio.doctorName ?? '',
    logo: studio.logoType ?? 'famiglia',
    topQuote: copy.topQuote,
    headline: MONTHS[m],
    bannerTop: copy.bannerTop,
    bannerMain: copy.bannerMain,
    dateFrom: period?.from ?? `${month}-01`,
    dateTo: period?.to ?? `${month}-${pad(daysInMonth(month))}`,
    offerName: copy.offerName,
    items: itemsFromOffer(campaign.offer, campaign.category),
    note: campaign.offer,
    badge: badgeFromOffer(campaign.offer),
    cta: 'Prenota subito!',
    phone: studio.phone,
    address: studio.address,
    footer: copy.footer,
    tags: [...copy.tags],
  }
}

/** Unisce i testi salvati con quelli proposti, così un volantino salvato con una versione
 * precedente dell'app riceve i campi aggiunti in seguito. */
export function mergeFlyer(defaults: FlyerData, saved: Record<string, unknown> | null | undefined): FlyerData {
  if (!saved) return defaults
  const out = { ...defaults } as Record<string, unknown>
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in defaults)) continue
    const d = (defaults as unknown as Record<string, unknown>)[k]
    if (Array.isArray(d) ? Array.isArray(v) : typeof v === typeof d) out[k] = v
  }
  // I colori salvati valgono solo se appartengono al modello in uso.
  const t = String(out.theme)
  const valid = isTechTheme(defaults.theme) ? isTechTheme(t) : t in THEME_BY_ID
  if (!valid) out.theme = defaults.theme
  return out as unknown as FlyerData
}
