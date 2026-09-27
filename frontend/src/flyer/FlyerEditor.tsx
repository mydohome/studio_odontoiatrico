import { toPng } from 'html-to-image'
import { Download, ImageIcon, Loader2, RotateCcw, Share2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatMonth } from '../../../shared/dates.ts'
import type { CampaignSuggestion } from '../../../shared/types.ts'
import { useToast } from '../components/Toast.tsx'
import { api, type AppSettings } from '../lib/api.ts'
import Flyer, { FLYER_HEIGHT, FLYER_WIDTH } from './Flyer.tsx'
import { buildFlyer, ICON_LABELS, THEMES, type FlyerData, type IconId } from './flyerModel.ts'

interface Props {
  campaign: CampaignSuggestion
  month: string
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
  onClose: () => void
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export default function FlyerEditor({ campaign, month, settings, onSettingsChange, onClose }: Props) {
  const notify = useToast()
  const initial = useMemo(
    () => buildFlyer(campaign, month, { studioName: settings.studioName, phone: settings.phone, address: settings.address }),
    [campaign, month, settings.studioName], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [data, setData] = useState<FlyerData>(initial)
  const [busy, setBusy] = useState<'png' | 'share' | null>(null)
  // Telefono e indirizzo si memorizzano nelle impostazioni per i volantini successivi.
  const [rememberContacts, setRememberContacts] = useState(!settings.phone || !settings.address)
  const flyerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)

  const set = <K extends keyof FlyerData>(k: K, v: FlyerData[K]) => setData((d) => ({ ...d, [k]: v }))
  const setItem = (i: number, patch: Partial<FlyerData['items'][number]>) =>
    setData((d) => {
      const items = [...d.items]
      while (items.length <= i) items.push({ icon: 'check', text: '' })
      items[i] = { ...items[i], ...patch }
      return { ...d, items }
    })
  const setTag = (i: number, v: string) =>
    setData((d) => {
      const tags = [...d.tags]
      tags[i] = v
      return { ...d, tags }
    })

  // Adatta l'anteprima allo spazio disponibile.
  useLayoutEffect(() => {
    const el = previewRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth - 32
      // Su schermi stretti l'anteprima sta sopra il modulo e scorre con esso: conta solo la larghezza.
      const h = window.matchMedia('(max-width: 860px)').matches ? Infinity : el.clientHeight - 32
      setScale(Math.max(0.2, Math.min(w / FLYER_WIDTH, h / FLYER_HEIGHT, 1)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc chiude la finestra.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const fileName = `volantino-${month}-${slug(campaign.title)}.png`

  const render = async () => {
    await document.fonts.ready
    const node = flyerRef.current
    if (!node) throw new Error('Anteprima non pronta')
    return toPng(node, { pixelRatio: 2, width: FLYER_WIDTH, height: FLYER_HEIGHT, cacheBust: true })
  }

  const saveContactsIfNeeded = async () => {
    const phone = data.phone.trim()
    const address = data.address.trim()
    if (!rememberContacts || (phone === settings.phone && address === settings.address)) return
    try {
      onSettingsChange(await api.saveSettings({ phone, address }))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const download = async () => {
    setBusy('png')
    try {
      const url = await render()
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      await saveContactsIfNeeded()
      notify('Volantino scaricato')
    } catch (e) {
      notify(`Impossibile generare l'immagine: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator
  const share = async () => {
    setBusy('share')
    try {
      const blob = await (await fetch(await render())).blob()
      const file = new File([blob], fileName, { type: 'image/png' })
      if (!navigator.canShare?.({ files: [file] })) {
        notify('Condivisione non supportata da questo browser: usa "Scarica PNG".', 'error')
        return
      }
      await saveContactsIfNeeded()
      await navigator.share({ files: [file], title: campaign.title, text: `${data.offerName} · ${data.cta}` })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const item = (i: number) => data.items[i] ?? { icon: 'check' as IconId, text: '' }

  return (
    <div className="flyer-modal" role="dialog" aria-modal="true" aria-labelledby="flyer-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flyer-dialog">
        <div className="flyer-dialog-head">
          <h2 id="flyer-title">
            <ImageIcon size={18} /> Volantino · {campaign.title}
            <span className="beta-badge">beta</span>
          </h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>

        <div className="flyer-dialog-body">
          <form className="flyer-form" onSubmit={(e) => e.preventDefault()}>
            <p className="small muted" style={{ margin: 0 }}>
              Testi proposti per la campagna di {formatMonth(month).toLowerCase()}: modificali liberamente, l'anteprima si
              aggiorna subito.
            </p>

            <label>
              Colori
              <div className="theme-swatches">
                {THEMES.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={data.theme === t.id}
                    style={{ background: `linear-gradient(135deg, ${t.bg} 55%, ${t.accent} 55%)` }}
                    onClick={() => set('theme', t.id)}
                  />
                ))}
              </div>
            </label>

            <fieldset>
              <legend>Titolo e periodo</legend>
              <label>
                Titolo grande
                <input className="input" value={data.headline} onChange={(e) => set('headline', e.target.value)} maxLength={16} />
              </label>
              <div className="row">
                <label>
                  Banner · prima riga
                  <input className="input" value={data.bannerTop} onChange={(e) => set('bannerTop', e.target.value)} maxLength={24} />
                </label>
                <label>
                  Banner · parola chiave
                  <input className="input" value={data.bannerMain} onChange={(e) => set('bannerMain', e.target.value.toUpperCase())} maxLength={16} />
                </label>
              </div>
              <div className="row">
                <label>
                  Dal
                  <input className="input" type="date" value={data.dateFrom} max={data.dateTo} onChange={(e) => set('dateFrom', e.target.value)} />
                </label>
                <label>
                  Al
                  <input className="input" type="date" value={data.dateTo} min={data.dateFrom} onChange={(e) => set('dateTo', e.target.value)} />
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Offerta</legend>
              <label>
                Nome dell'offerta
                <input className="input" value={data.offerName} onChange={(e) => set('offerName', e.target.value)} maxLength={28} />
              </label>
              {[0, 1, 2].map((i) => (
                <div className="item-row" key={i}>
                  <select
                    className="input"
                    value={item(i).icon}
                    onChange={(e) => setItem(i, { icon: e.target.value as IconId })}
                    aria-label={`Icona voce ${i + 1}`}
                  >
                    {(Object.keys(ICON_LABELS) as IconId[]).map((k) => (
                      <option key={k} value={k}>
                        {ICON_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder={i === 0 ? 'Voce principale' : 'Voce facoltativa'}
                    value={item(i).text}
                    onChange={(e) => setItem(i, { text: e.target.value })}
                    maxLength={40}
                    aria-label={`Voce ${i + 1}`}
                  />
                </div>
              ))}
              <label>
                Nota sotto l'offerta
                <input className="input" value={data.note} onChange={(e) => set('note', e.target.value)} maxLength={80} />
              </label>
              <label>
                Etichetta prezzo (es. 90€, -25%, GRATIS; vuota per nasconderla)
                <input className="input" value={data.badge} onChange={(e) => set('badge', e.target.value)} maxLength={8} />
              </label>
            </fieldset>

            <fieldset>
              <legend>Contatti</legend>
              <div className="row">
                <label>
                  Invito
                  <input className="input" value={data.cta} onChange={(e) => set('cta', e.target.value)} maxLength={20} />
                </label>
                <label>
                  Telefono / WhatsApp
                  <input
                    className="input"
                    inputMode="tel"
                    value={data.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    maxLength={20}
                    placeholder="347 1234567"
                  />
                </label>
              </div>
              <label>
                Indirizzo dello studio (in basso a destra)
                <input
                  className="input"
                  value={data.address}
                  onChange={(e) => set('address', e.target.value)}
                  maxLength={120}
                  placeholder="Via Roma 12, 20100 Milano"
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={rememberContacts} onChange={(e) => setRememberContacts(e.target.checked)} />
                Ricorda telefono e indirizzo per i prossimi volantini
              </label>
            </fieldset>

            <fieldset>
              <legend>Altri testi</legend>
              <label>
                Nome dello studio
                <input className="input" value={data.studioName} onChange={(e) => set('studioName', e.target.value)} maxLength={30} />
              </label>
              <label>
                Frase in alto a destra
                <input className="input" value={data.topQuote} onChange={(e) => set('topQuote', e.target.value)} maxLength={60} />
              </label>
              <label>
                Frase in basso (mostrata se l'indirizzo è vuoto)
                <input className="input" value={data.footer} onChange={(e) => set('footer', e.target.value)} maxLength={60} />
              </label>
              <div className="row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                {[0, 1, 2].map((i) => (
                  <label key={i}>
                    Parola {i + 1}
                    <input className="input" value={data.tags[i] ?? ''} onChange={(e) => setTag(i, e.target.value)} maxLength={12} />
                  </label>
                ))}
              </div>
            </fieldset>
          </form>

          <div className="flyer-preview" ref={previewRef}>
            <div className="flyer-preview-frame" style={{ width: FLYER_WIDTH * scale, height: FLYER_HEIGHT * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: FLYER_WIDTH, height: FLYER_HEIGHT }}>
                <Flyer ref={flyerRef} data={data} />
              </div>
            </div>
          </div>
        </div>

        <div className="flyer-dialog-foot">
          <button className="btn" onClick={() => setData(initial)} disabled={busy !== null}>
            <RotateCcw size={16} /> Ripristina testi proposti
          </button>
          <div className="toolbar">
            {canShare && (
              <button className="btn" onClick={share} disabled={busy !== null}>
                {busy === 'share' ? <Loader2 size={16} /> : <Share2 size={16} />} Condividi
              </button>
            )}
            <button className="btn btn-primary" onClick={download} disabled={busy !== null}>
              {busy === 'png' ? <Loader2 size={16} /> : <Download size={16} />} Scarica PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
