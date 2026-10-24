// Carta fedeltà stampabile (formato carta di credito, 85,6 × 54 mm) con logo, nome dello studio e QR
// della carta di quel cliente: si scarica in PNG o PDF a grandezza reale, oppure si stampa su A4.

import { toPng } from 'html-to-image'
import { Download, FileDown, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LoyaltyCardDetail } from '../../../shared/loyalty.ts'
import { useToast } from '../components/Toast.tsx'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { StudioLogo, type LogoType } from '../flyer/shapes.tsx'
import type { AppSettings } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'
import { loyaltyTheme } from './theme.ts'
import '@fontsource/lobster/latin-400.css'
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-700.css'

const W = 856
const H = 540

function CardFace({ card, settings, qr }: { card: LoyaltyCardDetail; settings: AppSettings; qr: string | null }) {
  const style = settings.flyerStyle
  const theme = loyaltyTheme(style)
  const logo = useCustomLogo(settings.logoType === 'custom' ? settings.logoVersion : 0)
  const preview = LOGO_PREVIEWS[style]
  return (
    <div className="lc-print-card" style={{ width: W, height: H, background: theme.bg, color: theme.ink }}>
      <div className="lc-print-top">
        <StudioLogo type={settings.logoType as LogoType} height={70} colors={preview.colors} customSrc={logo} />
        <div className="lc-print-studio">{settings.studioName}</div>
      </div>
      <div className="lc-print-body">
        <div className="lc-print-text">
          <div className="lc-print-kind" style={{ color: theme.sub }}>
            CARTA FEDELTÀ
          </div>
          <div className="lc-print-title">{card.stampsRequired} timbri</div>
          <div className="lc-print-reward">{card.reward}</div>
          <div className="lc-print-holder">{card.holderName.split(/\s+/)[0]}</div>
        </div>
        <div className="lc-print-qr">
          {qr && <img src={qr} alt="" width={230} height={230} />}
          <div className="lc-print-code">
            {card.shortCode.slice(0, 4)}-{card.shortCode.slice(4)}
          </div>
        </div>
      </div>
      <div className="lc-print-foot" style={{ color: theme.sub }}>
        {[settings.phone, settings.address].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

export default function CardPrint({ card, settings }: { card: LoyaltyCardDetail; settings: AppSettings }) {
  const notify = useToast()
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (card.url) QRCode.toDataURL(card.url, { margin: 1, width: 460, errorCorrectionLevel: 'M' }).then(setQr, () => {})
  }, [card.url])

  // La carta è a grandezza piena (856 × 540) e si riduce alla larghezza disponibile.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!card.url) {
    return <div className="alert alert-warn small">Per stampare la carta serve il dominio delle carte (CARD_BASE_URL nel .env): il QR contiene il link.</div>
  }

  const png = () => toPng(box.current!.firstElementChild!.firstElementChild as HTMLElement, { pixelRatio: 2, cacheBust: true, width: W, height: H, style: { transform: 'none' } })

  const run = async (kind: 'png' | 'pdf' | 'print') => {
    setBusy(true)
    try {
      const data = await png()
      const name = `carta-fedelta-${card.shortCode}`
      if (kind === 'png') {
        const a = document.createElement('a')
        a.href = data
        a.download = `${name}.png`
        a.click()
        return
      }
      const { jsPDF } = await import('jspdf')
      if (kind === 'pdf') {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 54] })
        doc.addImage(data, 'PNG', 0, 0, 85.6, 54)
        doc.save(`${name}.pdf`)
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
    <div className="lc-print-wrap">
      <div className="lc-print-preview" ref={box}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: W, height: H }}>
          <CardFace card={card} settings={settings} qr={qr} />
        </div>
      </div>
      <p className="small muted">Stampata su carta o plastica, la carta con il QR fa da tessera: lo scanner dello studio la legge come quella sul telefono.</p>
      <div className="lc-actions">
        <button className="btn btn-sm btn-primary" disabled={busy || !qr} onClick={() => run('png')}>
          <Download size={15} /> Immagine PNG
        </button>
        <button className="btn btn-sm" disabled={busy || !qr} onClick={() => run('pdf')} title="PDF a grandezza reale (85,6 × 54 mm), per la tipografia">
          <FileDown size={15} /> PDF
        </button>
        <button className="btn btn-sm" disabled={busy || !qr} onClick={() => run('print')} title="Stampa su A4 con il bordo da ritagliare">
          <Printer size={15} /> Stampa
        </button>
      </div>
    </div>
  )
}
