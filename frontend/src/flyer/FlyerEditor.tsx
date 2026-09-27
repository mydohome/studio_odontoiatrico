import { toJpeg, toPng } from 'html-to-image'
import { Check, ChevronDown, Download, ImageIcon, Loader2, RotateCcw, Save, Share2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatMonth } from '../../../shared/dates.ts'
import type { CampaignSuggestion } from '../../../shared/types.ts'
import { useToast } from '../components/Toast.tsx'
import { api, type AppSettings } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'
import Flyer, { FLYER_HEIGHT, FLYER_WIDTH } from './Flyer.tsx'
import { LOGO_OPTIONS } from './shapes.tsx'
import { buildFlyer, ICON_LABELS, mergeFlyer, THEME_BY_ID, THEMES, type FlyerData, type IconId } from './flyerModel.ts'

interface Props {
  campaign: CampaignSuggestion
  month: string
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
  onClose: () => void
  /** Periodo della campagna (per le campagne personalizzate); altrimenti l'intero mese. */
  period?: { from: string; to: string }
  /** Testi salvati in precedenza (campagne personalizzate). */
  saved?: Record<string, unknown> | null
  /** Se presente, i testi del volantino si possono salvare con la campagna. */
  onSave?: (data: FlyerData) => Promise<void>
}

type Format = 'jpg' | 'png' | 'pdf'

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: 'jpg', label: 'JPG', hint: 'Consigliato per WhatsApp: arriva come foto con anteprima nella chat' },
  { id: 'png', label: 'PNG', hint: 'Qualità massima, file più pesante (social, siti)' },
  { id: 'pdf', label: 'PDF', hint: 'Pagina A4 pronta da stampare; su WhatsApp arriva come documento' },
]

const FORMAT_KEY = 'flyerFormat'
function loadFormat(): Format {
  try {
    const v = localStorage.getItem(FORMAT_KEY)
    return v === 'png' || v === 'pdf' ? v : 'jpg'
  } catch {
    return 'jpg'
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export default function FlyerEditor({ campaign, month, settings, onSettingsChange, onClose, period, saved, onSave }: Props) {
  const notify = useToast()
  // Testi proposti automaticamente (usati anche da "Ripristina testi proposti").
  const initial = useMemo(
    () =>
      buildFlyer(campaign, month, {
          studioName: settings.studioName,
          phone: settings.phone,
          address: settings.address,
          doctorName: settings.doctorName,
          logoType: settings.logoType,
        }, period),
    [campaign, month, settings.studioName], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [data, setData] = useState<FlyerData>(() => mergeFlyer(initial, saved))
  const [savedJson, setSavedJson] = useState(() => (saved ? JSON.stringify(mergeFlyer(initial, saved)) : ''))
  const unsaved = !!onSave && JSON.stringify(data) !== savedJson
  const [busy, setBusy] = useState<'download' | 'share' | 'save' | null>(null)
  const [format, setFormat] = useState<Format>(loadFormat)
  const customLogo = useCustomLogo(settings.logoVersion)
  // Con il logo caricato, l'esportazione aspetta che l'immagine sia pronta.
  const logoPending = data.logo === 'custom' && settings.logoVersion > 0 && !customLogo
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menuOpen) setMenuOpen(false)
      else close()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [unsaved, onClose, menuOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (unsaved && !window.confirm('I testi del volantino non sono salvati. Chiudere comunque?')) return
    onClose()
  }

  const baseName = `volantino-${month}-${slug(campaign.title)}`

  /** Genera il volantino nel formato richiesto. */
  const render = async (fmt: Format): Promise<Blob> => {
    await document.fonts.ready
    const node = flyerRef.current
    if (!node) throw new Error('Anteprima non pronta')
    const bg = THEME_BY_ID[data.theme].bg
    const opts = { width: FLYER_WIDTH, height: FLYER_HEIGHT, cacheBust: true }
    if (fmt === 'png') return (await fetch(await toPng(node, { ...opts, pixelRatio: 2 }))).blob()
    if (fmt === 'jpg') {
      return (await fetch(await toJpeg(node, { ...opts, pixelRatio: 2, quality: 0.92, backgroundColor: bg }))).blob()
    }
    // PDF A4 verticale: volantino centrato, bordi laterali nel colore dello sfondo (niente fasce bianche).
    const img = await toJpeg(node, { ...opts, pixelRatio: 3, quality: 0.95, backgroundColor: bg })
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    pdf.setProperties({ title: campaign.title, creator: settings.studioName })
    pdf.setFillColor(bg)
    pdf.rect(0, 0, 210, 297, 'F')
    const h = 297
    const w = (h * FLYER_WIDTH) / FLYER_HEIGHT
    pdf.addImage(img, 'JPEG', (210 - w) / 2, 0, w, h)
    return pdf.output('blob')
  }

  const chooseFormat = (f: Format) => {
    setFormat(f)
    setMenuOpen(false)
    try {
      localStorage.setItem(FORMAT_KEY, f)
    } catch {
      /* preferenza non salvata: nessun problema */
    }
  }

  // Chiude il menu dei formati cliccando fuori.
  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

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

  const saveTexts = async (quiet = false) => {
    if (!onSave || !unsaved) return
    await onSave(data)
    setSavedJson(JSON.stringify(data))
    if (!quiet) notify('Testi del volantino salvati con la campagna')
  }

  const save = async () => {
    setBusy('save')
    try {
      await saveTexts()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = async (fmt: Format = format) => {
    setBusy('download')
    setMenuOpen(false)
    try {
      const url = URL.createObjectURL(await render(fmt))
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.${fmt}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      await saveContactsIfNeeded()
      await saveTexts(true)
      notify(`Volantino scaricato in ${fmt.toUpperCase()}`)
    } catch (e) {
      notify(`Impossibile generare il volantino: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator
  const share = async () => {
    setBusy('share')
    try {
      // Sempre in JPG: su WhatsApp arriva come foto, con l'anteprima direttamente nella chat.
      const file = new File([await render('jpg')], `${baseName}.jpg`, { type: 'image/jpeg' })
      if (!navigator.canShare?.({ files: [file] })) {
        notify('Condivisione non supportata da questo browser: usa "Scarica".', 'error')
        return
      }
      await saveContactsIfNeeded()
      await saveTexts(true)
      await navigator.share({ files: [file], title: campaign.title, text: `${data.offerName} · ${data.cta}` })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const item = (i: number) => data.items[i] ?? { icon: 'check' as IconId, text: '' }

  return (
    <div className="flyer-modal" role="dialog" aria-modal="true" aria-labelledby="flyer-title" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flyer-dialog">
        <div className="flyer-dialog-head">
          <h2 id="flyer-title">
            <ImageIcon size={18} /> Volantino · {campaign.title}
            <span className="beta-badge">beta</span>
          </h2>
          <button className="btn btn-icon btn-ghost" onClick={close} aria-label="Chiudi">
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
                Logo
                <select className="input" value={data.logo === 'custom' && !settings.logoVersion ? 'famiglia' : data.logo} onChange={(e) => set('logo', e.target.value as FlyerData['logo'])}>
                  {LOGO_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  {settings.logoVersion > 0 && <option value="custom">Logo dello studio (caricato)</option>}
                </select>
              </label>
              <label>
                Nome del dottore (sotto "Studio odontoiatrico"; vuoto per nasconderlo)
                <input className="input" value={data.doctor} onChange={(e) => set('doctor', e.target.value)} maxLength={60} placeholder="es. Dott.ssa Maria Rossi" />
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
                <Flyer ref={flyerRef} data={data} logoSrc={customLogo} />
              </div>
            </div>
          </div>
        </div>

        <div className="flyer-dialog-foot">
          <button className="btn" onClick={() => setData(initial)} disabled={busy !== null}>
            <RotateCcw size={16} /> Ripristina testi proposti
          </button>
          <div className="toolbar">
            {onSave && (
              <button className="btn" onClick={save} disabled={busy !== null || !unsaved} title="Salva i testi con la campagna">
                {busy === 'save' ? <Loader2 size={16} /> : <Save size={16} />} {unsaved ? 'Salva testi' : 'Testi salvati'}
              </button>
            )}
            {canShare && (
              <button className="btn" onClick={share} disabled={busy !== null || logoPending} title="Invia come foto (JPG), con anteprima su WhatsApp">
                {busy === 'share' ? <Loader2 size={16} /> : <Share2 size={16} />} Condividi
              </button>
            )}
            <div className="split-btn" ref={menuRef}>
              <button className="btn btn-primary" onClick={() => download()} disabled={busy !== null || logoPending}>
                {busy === 'download' ? <Loader2 size={16} /> : <Download size={16} />} Scarica {format.toUpperCase()}
              </button>
              <button
                className="btn btn-primary split-caret"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={busy !== null || logoPending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Scegli il formato"
              >
                <ChevronDown size={16} />
              </button>
              {menuOpen && (
                <div className="format-menu" role="menu">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      role="menuitemradio"
                      aria-checked={format === f.id}
                      onClick={() => {
                        chooseFormat(f.id)
                        download(f.id)
                      }}
                    >
                      <span className="format-check">{format === f.id && <Check size={15} />}</span>
                      <span>
                        <strong>{f.label}</strong>
                        {f.id === 'jpg' && <span className="format-tag">consigliato</span>}
                        <span className="format-hint">{f.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
