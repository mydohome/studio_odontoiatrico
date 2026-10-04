// Grafica della gift card (formato carta di credito) con logo e nome dello studio, valore e codice a
// barre; si scarica in PNG (da inviare) o in PDF a grandezza reale (da stampare).

import { toPng } from 'html-to-image'
import JsBarcode from 'jsbarcode'
import { Download, FileDown, Printer } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fromISO } from '../../../shared/dates.ts'
import { describeContent, formatCode, formatEuro, type GiftCard } from '../../../shared/giftCards.ts'
import { useToast } from '../components/Toast.tsx'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { MINT_THEME_BY_ID, THEME_BY_ID } from '../flyer/flyerModel.ts'
import { StudioLogo, type LogoType } from '../flyer/shapes.tsx'
import type { AppSettings } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'
import '@fontsource/lobster/latin-400.css'
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-700.css'

/** Dimensioni della card in pixel (rapporto della carta di credito, 85,6 × 54 mm). */
export const CARD_W = 856
export const CARD_H = 540

/** "2027-10-04" → "4 ottobre 2027". */
const longDate = (iso: string) => fromISO(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })

type CardContent = Pick<GiftCard, 'code' | 'kind' | 'title' | 'amount' | 'items' | 'recipient' | 'expiresOn'>

function Barcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    // Code 128: il formato letto da qualsiasi lettore di codici a barre (anche quelli USB "a tastiera").
    JsBarcode(ref.current, code, { format: 'CODE128', displayValue: false, margin: 0, height: 86, width: 2.2, background: 'transparent' })
  }, [code])
  return <svg ref={ref} className="gc-barcode" aria-label={`Codice a barre ${code}`} />
}

export function GiftCardVisual({ card, settings }: { card: CardContent; settings: AppSettings }) {
  const style = settings.flyerStyle
  const logo = useCustomLogo(settings.logoType === 'custom' ? settings.logoVersion : 0)
  const preview = LOGO_PREVIEWS[style]
  const rosa = THEME_BY_ID.rosa
  const capri = MINT_THEME_BY_ID.capri
  // Colori del modello dei volantini scelto in Impostazioni: la card è coordinata con il resto.
  const theme =
    style === 'mint'
      ? { bg: `linear-gradient(135deg, ${capri.surface} 0%, #ffffff 60%, ${capri.surface} 100%)`, ink: capri.ink, title: capri.primary, accent: capri.accent, muted: capri.muted }
      : { bg: `linear-gradient(135deg, ${rosa.bg} 0%, ${rosa.bg2} 100%)`, ink: '#ffffff', title: '#ffffff', accent: rosa.badge, muted: 'rgba(255,255,255,0.85)' }

  return (
    <div className={`gc-card gc-${style}`} style={{ width: CARD_W, height: CARD_H, background: theme.bg, color: theme.ink }}>
      <div className="gc-top">
        <div className="gc-brand">
          <StudioLogo type={settings.logoType as LogoType} height={74} colors={preview.colors} customSrc={logo} />
          <div className="gc-studio">{settings.studioName}</div>
        </div>
        <div className="gc-label" style={{ color: theme.accent, borderColor: theme.accent }}>
          GIFT CARD
        </div>
      </div>

      <div className="gc-middle">
        <div className="gc-title" style={{ color: theme.title }}>
          {card.title}
        </div>
        {card.kind === 'credito' && card.amount !== null ? (
          <div className="gc-amount" style={{ color: theme.accent }}>
            {formatEuro(card.amount)}
          </div>
        ) : (
          <ul className="gc-items">
            {card.items.slice(0, 4).map((i) => (
              <li key={i.idx}>
                <strong style={{ color: theme.accent }}>{i.qty} ×</strong> {i.name}
              </li>
            ))}
            {card.items.length > 4 && <li>e altre {card.items.length - 4} prestazioni</li>}
          </ul>
        )}
        {card.recipient && <div className="gc-recipient">Per {card.recipient}</div>}
      </div>

      <div className="gc-bottom">
        <div className="gc-code-box">
          <Barcode code={card.code} />
          <div className="gc-code">{formatCode(card.code)}</div>
        </div>
        <div className="gc-meta" style={{ color: theme.muted }}>
          {card.expiresOn && <div>Valida fino al {longDate(card.expiresOn)}</div>}
          {settings.phone && <div>{settings.phone}</div>}
          {settings.address && <div>{settings.address}</div>}
        </div>
      </div>
    </div>
  )
}

/** Anteprima ridotta della card con i pulsanti per scaricarla. */
export function GiftCardPreview({ card, settings }: { card: GiftCard; settings: AppSettings }) {
  const notify = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(0.75)

  // La card è a grandezza piena (856 × 540) e si riduce alla larghezza disponibile.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / CARD_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // L'immagine si genera dalla card a grandezza piena, senza la riduzione dello schermo.
  const png = async () =>
    toPng(ref.current!.firstElementChild!.firstElementChild as HTMLElement, { pixelRatio: 2, cacheBust: true, width: CARD_W, height: CARD_H, style: { transform: 'none' } })

  const download = async (kind: 'png' | 'pdf' | 'print') => {
    setBusy(true)
    try {
      const data = await png()
      if (kind === 'png') {
        const a = document.createElement('a')
        a.href = data
        a.download = `gift-card-${card.code}.png`
        a.click()
        return
      }
      const { jsPDF } = await import('jspdf')
      // A grandezza reale (85,6 × 54 mm), oppure su A4 con il bordo da ritagliare per stampare in casa.
      if (kind === 'pdf') {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 54] })
        doc.addImage(data, 'PNG', 0, 0, 85.6, 54)
        doc.save(`gift-card-${card.code}.pdf`)
      } else {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        const x = (210 - 85.6) / 2
        doc.addImage(data, 'PNG', x, 30, 85.6, 54)
        doc.setDrawColor(180)
        doc.setLineDashPattern([1, 1], 0)
        doc.rect(x, 30, 85.6, 54)
        doc.setFontSize(9)
        doc.text('Ritagliare lungo la linea tratteggiata', 105, 92, { align: 'center' })
        doc.autoPrint()
        window.open(doc.output('bloburl'), '_blank')
      }
    } catch (e) {
      notify(`Impossibile preparare il file: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gc-preview-wrap">
      <div className="gc-preview" ref={ref}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: CARD_W, height: CARD_H }}>
          <GiftCardVisual card={card} settings={settings} />
        </div>
      </div>
      <div className="gc-preview-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => download('png')} disabled={busy} title="Immagine da inviare su WhatsApp o per email">
          <Download size={15} /> Immagine PNG
        </button>
        <button type="button" className="btn btn-sm" onClick={() => download('pdf')} disabled={busy} title="PDF a grandezza reale (85,6 × 54 mm), per la tipografia">
          <FileDown size={15} /> PDF
        </button>
        <button type="button" className="btn btn-sm" onClick={() => download('print')} disabled={busy} title="Stampa su A4 con il bordo da ritagliare">
          <Printer size={15} /> Stampa
        </button>
      </div>
    </div>
  )
}

export const contentLabel = (c: Pick<GiftCard, 'kind' | 'amount' | 'items'>) => describeContent(c)
