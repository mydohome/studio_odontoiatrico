// Pagina pubblica della fidelity card (dominio dedicato, senza accesso): carta a timbri con i dentini,
// QR code da mostrare in studio e installazione sulla Home del telefono. Mostra solo il nome di
// battesimo: nessun dato sanitario né di appuntamenti.

import { Download, Loader2, Share } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { PublicLoyaltyCard } from '../../../shared/loyalty.ts'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { StudioLogo } from '../flyer/shapes.tsx'
import { api } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'
import StampGrid from '../loyalty/StampGrid.tsx'
import { loyaltyTheme } from '../loyalty/theme.ts'
import '../loyalty/loyalty.css'
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-700.css'

const longDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })

/** Metadati della pagina: non indicizzabile, nessun referrer e manifest della carta per installarla. */
function usePageMeta(token: string, card: PublicLoyaltyCard | null) {
  useEffect(() => {
    const added: HTMLElement[] = []
    const put = (tag: 'meta' | 'link', attrs: Record<string, string>) => {
      // Già presente in index.html (es. robots): non si duplica.
      if (tag === 'meta' && attrs.name && document.head.querySelector(`meta[name="${attrs.name}"]`)) return
      const el = document.createElement(tag)
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      document.head.appendChild(el)
      added.push(el)
    }
    put('meta', { name: 'robots', content: 'noindex, nofollow' })
    put('meta', { name: 'referrer', content: 'no-referrer' })
    put('link', { rel: 'manifest', href: `/api/public/cards/${encodeURIComponent(token)}/manifest.webmanifest` })
    put('link', { rel: 'apple-touch-icon', href: '/loyalty/apple-touch-icon.png' })
    put('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' })
    put('meta', { name: 'mobile-web-app-capable', content: 'yes' })
    return () => added.forEach((e) => e.remove())
  }, [token])

  useEffect(() => {
    if (!card) return
    document.title = `${card.studio.name} · Carta fedeltà`
    const theme = loyaltyTheme(card.studio.flyerStyle)
    const el = document.querySelector('meta[name="theme-color"]')
    const old = el?.getAttribute('content')
    el?.setAttribute('content', theme.chrome)
    return () => {
      if (old) el?.setAttribute('content', old)
    }
  }, [card])

  // Service worker: la carta si riapre anche senza rete, con l'ultimo stato visto.
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-card.js', { scope: '/f/' }).catch(() => {})
  }, [])
}

function StudioMark({ studio }: { studio: PublicLoyaltyCard['studio'] }) {
  const custom = useCustomLogo(studio.logoType === 'custom' ? studio.logoVersion : 0)
  if (studio.logoType === 'custom') return <span className="login-logo">{custom && <img src={custom} alt="" />}</span>
  const preview = LOGO_PREVIEWS[studio.flyerStyle ?? 'smile']
  return (
    <span className="login-logo login-logo-tile" style={{ background: preview.bg }}>
      <StudioLogo type={studio.logoType as never} height={56} colors={preview.colors} />
    </span>
  )
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>
}

export default function Carta({ token }: { token: string }) {
  const [card, setCard] = useState<PublicLoyaltyCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [install, setInstall] = useState<InstallEvent | null>(null)
  usePageMeta(token, card)

  useEffect(() => {
    let alive = true
    api
      .publicCard(token)
      .then((c) => alive && setCard(c))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [token])

  // Il QR contiene l'indirizzo completo della carta (lo scanner dello studio ne estrae il token).
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/f/${token}`, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr, () => {})
  }, [token])

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault()
      setInstall(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  if (error) {
    return (
      <div className="carta">
        <div className="carta-col carta-error">
          <h1>Carta non trovata</h1>
          <p className="muted">Il link non è valido o la carta non è più attiva. Chiedi in studio.</p>
        </div>
      </div>
    )
  }
  if (!card) {
    return (
      <div className="carta">
        <div className="carta-col" style={{ placeItems: 'center', marginTop: '30vh' }}>
          <Loader2 className="spin" size={28} />
        </div>
      </div>
    )
  }

  const theme = loyaltyTheme(card.studio.flyerStyle)
  const left = Math.max(0, card.stampsRequired - card.stamps)
  const done = card.status === 'completata'
  const expired = card.status === 'scaduta'
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone

  return (
    <div className="carta" style={{ fontFamily: "'Fredoka', system-ui, sans-serif" }}>
      <div className="carta-col">
        <div className="carta-brand">
          <StudioMark studio={card.studio} />
          <div className="carta-studio">{card.studio.name}</div>
        </div>

        <div className="carta-card" style={{ background: theme.bg, color: theme.ink }}>
          <div className="carta-kind" style={{ color: theme.sub }}>
            Carta fedeltà
          </div>
          {card.firstName && <div className="carta-hello">Ciao {card.firstName}!</div>}
          <div className="carta-count">
            <strong>{Math.min(card.stamps, card.stampsRequired)}</strong>
            <span style={{ color: theme.sub }}>di {card.stampsRequired} timbri</span>
          </div>
          <StampGrid stamps={card.stamps} required={card.stampsRequired} style={card.studio.flyerStyle} />
          <div className={`carta-reward ${card.studio.flyerStyle === 'mint' ? 'is-mint' : ''}`}>
            {done ? (
              <>
                <div className="carta-done">Premio raggiunto!</div>
                <div>Mostra questa carta in studio per ritirare: {card.reward}.</div>
              </>
            ) : expired ? (
              <div>Questa carta è scaduta. Chiedi in studio.</div>
            ) : (
              <div>
                {left === 1 ? 'Manca 1 timbro' : `Mancano ${left} timbri`} al premio: <strong>{card.reward}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="carta-info">
          <div>
            <span>Ultimo timbro</span>
            <strong>{card.lastStampAt ? longDate(card.lastStampAt) : 'ancora nessuno'}</strong>
          </div>
          <div>
            <span>Prossimo premio</span>
            <strong style={{ textAlign: 'right' }}>{done ? 'raggiunto' : card.reward}</strong>
          </div>
          {card.expiresOn && !done && (
            <div>
              <span>Valida fino al</span>
              <strong>{longDate(`${card.expiresOn}T12:00:00`)}</strong>
            </div>
          )}
        </div>

        <div className="carta-qr">
          {qr && <img src={qr} alt="QR code della carta" width={240} height={240} />}
          <div className="carta-code" aria-label="Codice della carta">
            {card.shortCode}
          </div>
          <div className="small" style={{ color: '#555' }}>
            Mostra questo codice in studio per ricevere il timbro.
          </div>
        </div>

        {!standalone && (install || isIos) && (
          <div className="carta-install small">
            {install ? (
              <button className="btn btn-primary" onClick={() => install.prompt().then(() => setInstall(null))}>
                <Download size={16} /> Aggiungi alla schermata Home
              </button>
            ) : (
              <span className="muted">
                Per averla sempre a portata di mano: <Share size={14} style={{ verticalAlign: '-2px' }} /> Condividi → «Aggiungi alla schermata Home».
              </span>
            )}
          </div>
        )}

        <div className="carta-foot">
          {card.studio.phone && <div>{card.studio.phone}</div>}
          {card.studio.address && <div>{card.studio.address}</div>}
        </div>
      </div>
    </div>
  )
}
