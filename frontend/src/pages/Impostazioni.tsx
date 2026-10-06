import { ArrowDown, ArrowLeft, ArrowUp, Building2, CalendarDays, Check, ChevronRight, Database, LayoutGrid, Download, FileSpreadsheet, ImageUp, Gift, LogOut, Megaphone, Plus, RotateCcw, Save, Sparkles, Trash2, Upload, User } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { badgeColor, CATEGORIES, type Category } from '../../../shared/catalog.ts'
import { ColorInput, useColorPick } from '../components/ColorInput.tsx'
import type { CategoryId, Doctor, ImportResult, Service } from '../../../shared/types.ts'
import { useToast } from '../components/Toast.tsx'
import { api, EXPORT_URL, TEMPLATE_URL, type SessionUser } from '../lib/api.ts'
import type { AppDataState } from '../lib/useData.ts'
import { useCustomLogo } from '../lib/logo.ts'
import { FLYER_STYLES, MINT_THEME_BY_ID, THEME_BY_ID, type FlyerStyle } from '../flyer/flyerModel.ts'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { LOGO_OPTIONS, StudioLogo, type LogoType } from '../flyer/shapes.tsx'

interface Props {
  data: AppDataState
  user: SessionUser
  onLogout: () => void
}

type Section = 'studio' | 'dati' | 'moduli'

/** Account e logout, nella testata della pagina. */
function AccountBar({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  return (
    <div className="toolbar">
      <span className="badge" title={user.email ?? undefined}>
        <User size={13} /> {user.username}
      </span>
      <button
        className="btn"
        onClick={async () => {
          await api.logout().catch(() => {})
          onLogout()
        }}
      >
        <LogOut size={16} /> Esci
      </button>
    </div>
  )
}

export default function Impostazioni({ data, user, onLogout }: Props) {
  // Studio, Dati e Moduli si aprono in un menu a parte; medici, categorie e prestazioni restano qui.
  const [section, setSection] = useState<Section | null>(null)
  const m = data.settings.modules
  const activeModules = [m.appointments, m.campaigns, m.giftcards].filter(Boolean).length
  const manualDays = new Set(data.records.filter((r) => r.q - (r.a ?? 0) > 0).map((r) => r.d)).size

  const SECTIONS: { id: Section; label: string; text: string; icon: ReactNode }[] = [
    { id: 'studio', label: 'Studio', text: 'Nome, indirizzi, logo e modello dei volantini, prezzi', icon: <Building2 size={22} /> },
    { id: 'dati', label: 'Dati', text: `Importazione ed esportazione Excel, eliminazione · ${manualDays} giornate registrate`, icon: <Database size={22} /> },
    { id: 'moduli', label: 'Moduli', text: `Appuntamenti, campagne, gift card · ${activeModules} di 3 attivi`, icon: <LayoutGrid size={22} /> },
  ]

  if (section) {
    const current = SECTIONS.find((x) => x.id === section)!
    return (
      <>
        <div className="page-head">
          <div className="settings-crumb">
            <button className="btn btn-sm" onClick={() => setSection(null)}>
              <ArrowLeft size={15} /> Impostazioni
            </button>
            <h1>{current.label}</h1>
          </div>
          <AccountBar user={user} onLogout={onLogout} />
        </div>
        {section === 'studio' && (
          <div className="settings-narrow">
            <StudioCard data={data} />
          </div>
        )}
        {section === 'dati' && (
          <div className="grid grid-2-even" style={{ alignItems: 'start' }}>
            <ImportCard data={data} />
            <DataCard data={data} />
          </div>
        )}
        {section === 'moduli' && (
          <div className="settings-narrow">
            <ModulesCard data={data} />
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Impostazioni</h1>
          <p>Studio, dati e moduli; sotto medici, categorie e prestazioni.</p>
        </div>
        <AccountBar user={user} onLogout={onLogout} />
      </div>
      <div className="settings-tiles">
        {SECTIONS.map((x) => (
          <button key={x.id} className="settings-tile" onClick={() => setSection(x.id)}>
            <span className="settings-tile-icon">{x.icon}</span>
            <span className="settings-tile-text">
              <strong>{x.label}</strong>
              <span className="small muted">{x.text}</span>
            </span>
            <ChevronRight size={18} className="muted" />
          </button>
        ))}
      </div>
      <div className="grid grid-2-even" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="grid">
          {data.settings.modules.appointments && <DoctorsCard data={data} />}
          <CategoriesCard data={data} />
        </div>
        <ServicesCard data={data} />
      </div>
    </>
  )
}

const MODULES: { id: 'appointments' | 'campaigns' | 'giftcards'; label: string; text: string; icon: ReactNode }[] = [
  {
    id: 'appointments',
    label: 'Appuntamenti',
    text: "Agenda, promemoria WhatsApp e conferma dei pazienti. Spento: la scheda sparisce, ma gli appuntamenti restano salvati, i link già inviati funzionano e quelli confermati contano ancora nelle statistiche.",
    icon: <CalendarDays size={17} />,
  },
  {
    id: 'campaigns',
    label: 'Campagne',
    text: 'Campagne suggerite e personalizzate, con i volantini. Spento: la scheda sparisce, ma le campagne restano salvate.',
    icon: <Megaphone size={17} />,
  },
  {
    id: 'giftcards',
    label: 'Gift card',
    text: 'Gift card a credito o a prestazioni (anche da pacchetti) con codice a barre, da verificare e scalare in studio. Spento: la scheda sparisce, ma le gift card restano salvate.',
    icon: <Gift size={17} />,
  },
]

/** Moduli dell'app: si possono nascondere senza perdere i dati, e riattivare quando servono. */
function ModulesCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [saving, setSaving] = useState(false)
  const modules = data.settings.modules

  const toggle = async (id: 'appointments' | 'campaigns' | 'giftcards', value: boolean) => {
    setSaving(true)
    try {
      data.setSettings(await api.saveSettings({ modules: { ...modules, [id]: value } }))
      const label = MODULES.find((m) => m.id === id)!.label
      notify(value ? `${label}: modulo attivato` : `${label}: modulo nascosto (i dati restano)`)
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h2>Moduli</h2>
      {MODULES.map((m) => (
        <div className="setting-toggle" key={m.id}>
          <div>
            <label htmlFor={`module-${m.id}`} className="module-label">
              {m.icon} {m.label}
            </label>
            <p className="small muted">{m.text}</p>
          </div>
          <label className="switch">
            <input id={`module-${m.id}`} type="checkbox" checked={modules[m.id]} disabled={saving} onChange={(e) => toggle(m.id, e.target.checked)} />
            <span />
          </label>
        </div>
      ))}
    </div>
  )
}

function StudioCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [name, setName] = useState(data.settings.studioName)
  const [savingPrices, setSavingPrices] = useState(false)
  const [phone, setPhone] = useState(data.settings.phone)
  const [address, setAddress] = useState(data.settings.address)
  const [doctorName, setDoctorName] = useState(data.settings.doctorName)
  const [publicUrl, setPublicUrl] = useState(data.settings.publicUrl)
  const changed =
    name.trim() !== data.settings.studioName ||
    doctorName.trim() !== data.settings.doctorName ||
    phone.trim() !== data.settings.phone ||
    address.trim() !== data.settings.address ||
    publicUrl.trim() !== data.settings.publicUrl
  const { showPrices } = data.settings

  const togglePrices = async (value: boolean) => {
    setSavingPrices(true)
    try {
      data.setSettings(await api.saveSettings({ showPrices: value }))
      notify(value ? 'Prezzi visibili' : 'Prezzi nascosti')
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setSavingPrices(false)
    }
  }

  return (
    <div className="card">
      <h2>Studio</h2>
      <p className="sub">Dati mostrati nell'intestazione, nei volantini e nei messaggi degli appuntamenti.</p>
      <form
        className="studio-form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            const r = await api.saveSettings({
              studioName: name.trim(),
              doctorName: doctorName.trim(),
              phone: phone.trim(),
              address: address.trim(),
              publicUrl: publicUrl.trim(),
            })
            data.setSettings(r)
            setName(r.studioName)
            setDoctorName(r.doctorName)
            setPhone(r.phone)
            setAddress(r.address)
            setPublicUrl(r.publicUrl)
            notify('Dati dello studio salvati')
          } catch (err) {
            notify((err as Error).message, 'error')
          }
        }}
      >
        <label>
          Nome dello studio
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label>
          Nome del dottore
          <input
            className="input"
            placeholder="es. Dott.ssa Maria Rossi"
            value={doctorName}
            maxLength={80}
            onChange={(e) => setDoctorName(e.target.value)}
          />
        </label>
        <label>
          Telefono / WhatsApp
          <input
            className="input"
            type="tel"
            inputMode="tel"
            placeholder="es. 347 1234567"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label>
          Indirizzo
          <input
            className="input"
            placeholder="es. Via Roma 12, 20100 Milano"
            value={address}
            maxLength={120}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        {data.settings.modules.appointments && (
        <label>
          Indirizzo dei link di conferma degli appuntamenti
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder={`es. https://conferma.dominio.it (vuoto: ${window.location.origin})`}
            value={publicUrl}
            maxLength={200}
            onChange={(e) => setPublicUrl(e.target.value)}
          />
          <span className="small muted" style={{ fontWeight: 400 }}>
            Meglio un dominio separato dal gestionale, inoltrato in Nginx Proxy Manager alla porta 8081 del container (o
            CONFIRM_PORT): lì risponde solo la pagina di conferma, e il gestionale può restare chiuso al pubblico.
          </span>
        </label>
        )}
        <div>
          <button className="btn btn-primary" disabled={!name.trim() || !changed}>
            <Save size={16} /> Salva
          </button>
        </div>
      </form>
      {data.settings.modules.campaigns && <StylePicker data={data} />}
      <LogoPicker data={data} />
      <div className="setting-toggle">
        <div>
          <label htmlFor="show-prices">Mostra prezzi</label>
          <p className="small muted">
            Prezzi medi e fatturato stimato nella dashboard, nell'elenco delle prestazioni e nei file Excel.
          </p>
        </div>
        <label className="switch">
          <input
            id="show-prices"
            type="checkbox"
            checked={showPrices}
            disabled={savingPrices}
            onChange={(e) => togglePrices(e.target.checked)}
          />
          <span />
        </label>
      </div>
    </div>
  )
}

// Colori delle miniature dei modelli.
const PREVIEW = THEME_BY_ID.rosa
const MINT = MINT_THEME_BY_ID.capri

/** Miniatura schematica di un modello di volantino. */
function StyleThumb({ style }: { style: FlyerStyle }) {
  return style === 'mint' ? (
    <span className="style-thumb style-thumb-mint" aria-hidden="true">
      <i className="st-head" style={{ background: `linear-gradient(90deg, ${MINT.primary} 55%, ${MINT.accent} 55%)` }} />
      <i className="st-hero" style={{ background: `linear-gradient(128deg, ${MINT.primary}, ${MINT.accent})` }} />
      <i className="st-cards" />
      <i className="st-pill" style={{ background: MINT.primary }} />
    </span>
  ) : (
    <span className="style-thumb style-thumb-smile" aria-hidden="true" style={{ background: PREVIEW.bg }}>
      <i className="st-head" />
      <i className="st-hero" />
      <i className="st-banner" style={{ background: PREVIEW.accent }} />
      <i className="st-cards" />
      <i className="st-badge" style={{ background: PREVIEW.badge }} />
    </span>
  )
}

function StylePicker({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const current = data.settings.flyerStyle ?? 'smile'

  const choose = async (style: FlyerStyle) => {
    if (style === current) return
    setBusy(true)
    try {
      // Passando a Mint, un logo pronto di Smile diventa il "Dente stilizzato" (il logo caricato resta).
      const { logoType } = data.settings
      const switchLogo = style === 'mint' && logoType !== 'custom' && logoType !== 'linea'
      data.setSettings(await api.saveSettings(switchLogo ? { flyerStyle: style, logoType: 'linea' } : { flyerStyle: style }))
      notify(`Modello dei volantini: ${FLYER_STYLES.find((f) => f.id === style)?.label}${switchLogo ? ' (logo: Dente stilizzato)' : ''}`)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="logo-picker">
      <div className="field-label">Modello dei volantini</div>
      <div className="style-tiles" role="radiogroup" aria-label="Modello dei volantini">
        {FLYER_STYLES.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={current === f.id}
            className="logo-tile style-tile"
            disabled={busy}
            onClick={() => choose(f.id)}
          >
            <StyleThumb style={f.id} />
            <span className="style-tile-text">
              <span className="logo-tile-label">
                {current === f.id && <Check size={14} />} {f.label}
              </span>
              <span className="small muted">{f.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function LogoPicker({ data }: { data: AppDataState }) {
  const notify = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const { logoType, logoVersion } = data.settings
  const custom = useCustomLogo(logoVersion)
  const preview = LOGO_PREVIEWS[data.settings.flyerStyle ?? 'smile']

  const choose = async (type: LogoType) => {
    if (type === logoType) return
    setBusy(true)
    try {
      data.setSettings(await api.saveSettings({ logoType: type }))
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 1024 * 1024) {
      notify('Il logo supera 1 MB: riducilo e riprova.', 'error')
      return
    }
    setBusy(true)
    try {
      data.setSettings(await api.uploadLogo(file))
      notify('Logo caricato: ora è quello predefinito dei volantini')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm('Eliminare il logo caricato? I volantini torneranno a usare un logo pronto.')) return
    setBusy(true)
    try {
      data.setSettings(await api.deleteLogo())
      notify('Logo eliminato')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="logo-picker">
      <div className="field-label">Logo dei volantini</div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        I loghi pronti prendono i colori del tema del volantino; il tuo logo resta con i suoi colori.
      </p>
      <div className="logo-tiles" role="radiogroup" aria-label="Logo dei volantini">
        {LOGO_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={logoType === o.id}
            className="logo-tile"
            disabled={busy}
            onClick={() => choose(o.id)}
          >
            <span className="logo-tile-preview" style={{ background: preview.bg }}>
              <StudioLogo type={o.id} height={52} colors={preview.colors} />
            </span>
            <span className="logo-tile-label">
              {logoType === o.id && <Check size={14} />} {o.label}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={logoType === 'custom'}
          className="logo-tile"
          disabled={busy}
          onClick={() => (logoVersion ? choose('custom') : input.current?.click())}
        >
          <span className="logo-tile-preview logo-tile-custom">
            {custom ? <img src={custom} alt="Logo dello studio" /> : <ImageUp size={26} />}
          </span>
          <span className="logo-tile-label">
            {logoType === 'custom' && <Check size={14} />} {logoVersion ? 'Il tuo logo' : 'Carica il tuo logo'}
          </span>
        </button>
      </div>
      <div className="settings-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={16} /> {logoVersion ? 'Sostituisci logo' : 'Carica logo'}
        </button>
        {logoVersion > 0 && (
          <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={busy}>
            <Trash2 size={16} /> Elimina logo caricato
          </button>
        )}
        <span className="small muted">PNG, JPG, WebP o SVG · max 1 MB · meglio con sfondo trasparente</span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          hidden
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}

function ImportCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'replace' | 'sum'>('replace')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      notify('Seleziona un file Excel .xlsx', 'error')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await api.importExcel(file, mode)
      setResult(r)
      notify(`Importate ${r.imported} righe su ${r.days} giornate`)
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    upload(e.dataTransfer.files[0])
  }

  return (
    <div className="card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileSpreadsheet size={17} /> Importa da Excel
      </h2>
      <p className="sub">
        Scarica il template, compilalo (Data · Prestazione · Quantità) e caricalo qui. È accettato anche il formato con una
        colonna per ogni prestazione.
      </p>
      <div className="settings-row" style={{ marginBottom: 12 }}>
        <a className="btn" href={TEMPLATE_URL} download>
          <Download size={16} /> Scarica template Excel
        </a>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <Upload size={22} />
        <div>{busy ? 'Importazione in corso…' : 'Trascina qui il file .xlsx o clicca per selezionarlo'}</div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0', display: 'grid', gap: 6 }} className="small">
        <legend className="muted" style={{ marginBottom: 6 }}>
          Se una giornata è già presente:
        </legend>
        <label>
          <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> sostituisci i
          dati della giornata con quelli del file
        </label>
        <label>
          <input type="radio" name="mode" checked={mode === 'sum'} onChange={() => setMode('sum')} /> somma le quantità a
          quelle esistenti
        </label>
      </fieldset>
      {result && (
        <div className={`alert ${result.errors.length ? 'alert-warn' : 'alert-good'}`} style={{ marginTop: 12 }}>
          <div>
            <strong>
              {result.rows} righe lette, {result.days} giornate, {result.imported} valori importati.
            </strong>
            {result.errors.length > 0 && (
              <ul>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DataCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Solo le registrazioni a mano (quelle che si possono eliminare): gli appuntamenti hanno la loro scheda.
  const manual = data.records.filter((r) => r.q - (r.a ?? 0) > 0)
  const days = new Set(manual.map((r) => r.d)).size
  const total = manual.reduce((n, r) => n + r.q - (r.a ?? 0), 0)

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      notify(await fn())
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Database size={17} /> Dati
      </h2>
      <p className="sub">
        {days} giornate registrate · {total} prestazioni inserite a mano (più quelle degli appuntamenti confermati).
      </p>
      <div className="settings-row">
        <a className="btn" href={EXPORT_URL} download>
          <Download size={16} /> Esporta tutto in Excel
        </a>
        {/* Solo finché non ci sono registrazioni: non deve poter sostituire dati veri. */}
        {!days && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Generare 2 anni di dati dimostrativi per provare l\'app?')) return
              run(async () => {
                const r = await api.demo()
                return `Generate ${r.days} giornate dimostrative`
              })
            }}
          >
            <Sparkles size={16} /> Genera dati demo
          </button>
        )}
        <button className="btn btn-danger" disabled={busy || !days} onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} /> Elimina tutti i dati
        </button>
      </div>
      {confirmDelete && (
        <DeleteAllDialog
          days={days}
          total={total}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            run(async () => {
              await api.deleteAll(DELETE_PHRASE)
              return 'Tutte le registrazioni sono state eliminate'
            })
          }}
        />
      )}
    </div>
  )
}

const DELETE_PHRASE = 'ELIMINA DATI'
const FINAL_WAIT_S = 5

/**
 * Eliminazione di tutte le registrazioni in tre passaggi: avviso, frase da scrivere esattamente,
 * conferma finale attivabile solo dopo qualche secondo. Nessun passaggio si supera con Invio per sbaglio.
 */
function DeleteAllDialog({ days, total, onCancel, onConfirm }: { days: number; total: number; onCancel: () => void; onConfirm: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [phrase, setPhrase] = useState('')
  const [wait, setWait] = useState(FINAL_WAIT_S)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  useEffect(() => {
    if (step !== 3 || wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [step, wait])

  return (
    <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
      <div className="modal-dialog">
        <div className="modal-head">
          <h2 id="del-title">Elimina tutti i dati · passaggio {step} di 3</h2>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <div className="alert alert-danger">
                <span>
                  Stai per eliminare <strong>tutte le registrazioni delle prestazioni</strong>: {days} giornate, {total}{' '}
                  prestazioni in totale. L'operazione non si può annullare dall'app.
                </span>
              </div>
              <p className="small muted">
                Appuntamenti, campagne, utenti e impostazioni restano. Prima di continuare conviene usare «Esporta tutto in
                Excel»: il file si può reimportare.
              </p>
            </>
          )}
          {step === 2 && (
            <label>
              Per continuare scrivi esattamente <strong>{DELETE_PHRASE}</strong>
              <input
                className="input"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
            </label>
          )}
          {step === 3 && (
            <div className="alert alert-danger">
              <span>
                <strong>Ultima conferma.</strong> Eliminare definitivamente {days} giornate di registrazioni?
              </span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" autoFocus={step !== 2} onClick={onCancel}>
            Annulla
          </button>
          {step === 1 && (
            <button type="button" className="btn btn-danger" onClick={() => setStep(2)}>
              Continua
            </button>
          )}
          {step === 2 && (
            <button type="button" className="btn btn-danger" disabled={phrase !== DELETE_PHRASE} onClick={() => setStep(3)}>
              Continua
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn btn-danger" disabled={wait > 0} onClick={onConfirm}>
              <Trash2 size={16} /> {wait > 0 ? `Elimina definitivamente (${wait})` : 'Elimina definitivamente'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DoctorsCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [draft, setDraft] = useState({ name: '', color: '#2563eb' })

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) notify(ok)
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const remove = (d: Doctor) => {
    if (!window.confirm(`Eliminare "${d.name}"? Se ha appuntamenti verrà solo disattivato.`)) return
    return run(async () => {
      const r = await api.deleteDoctor(d.id)
      notify(r.deleted ? 'Medico eliminato' : 'Medico disattivato (ha appuntamenti)')
    })
  }

  return (
    <div className="card">
      <h2>Medici</h2>
      <p className="sub">
        Chi esegue le prestazioni. Ogni medico ha un colore: nell'agenda gli appuntamenti mostrano il suo badge e una striscia colorata, e nel modulo dell'appuntamento si sceglie il medico.
      </p>
      {data.doctors.length === 0 && <p className="small muted">Nessun medico: aggiungine uno qui sotto.</p>}
      <ul className="cat-list">
        {data.doctors.map((d) => (
          <DoctorRow key={d.id} d={d} onSave={(patch) => run(() => api.updateDoctor(d.id, { name: d.name, color: d.color, active: d.active, ...patch }))} onRemove={() => remove(d)} />
        ))}
      </ul>
      <form
        className="settings-row"
        style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            await api.createDoctor(draft)
            setDraft({ ...draft, name: '' })
          }, 'Medico aggiunto')
        }}
      >
        <input className="input" style={{ flex: '2 1 160px' }} placeholder="Nuovo medico (es. Dott. Bianchi)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
        <ColorInput value={draft.color} onCommit={(color) => setDraft((x) => ({ ...x, color }))} label="Colore del nuovo medico" />
        <button className="btn btn-primary" disabled={!draft.name.trim()}>
          <Plus size={16} /> Aggiungi
        </button>
      </form>
    </div>
  )
}

function DoctorRow({ d, onSave, onRemove }: { d: Doctor; onSave: (patch: Partial<Pick<Doctor, 'name' | 'color' | 'active'>>) => void; onRemove: () => void }) {
  const [name, setName] = useState(d.name)
  useEffect(() => setName(d.name), [d.name])
  const commitName = () => {
    const n = name.trim()
    if (n && n !== d.name) onSave({ name: n })
    else setName(d.name)
  }
  return (
    <li className="cat-row" style={{ opacity: d.active ? 1 : 0.55 }}>
      <span className="doc-swatch" style={{ background: d.color }} aria-hidden />
      <input
        className="input"
        style={{ flex: 1, minWidth: 0, padding: '5px 8px' }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={60}
        aria-label="Nome del medico"
      />
      <ColorInput value={d.color} onCommit={(color) => onSave({ color })} label={`Colore di ${d.name}`} />
      <label className="switch" title={d.active ? 'Attivo' : 'Disattivato: non si può scegliere nei nuovi appuntamenti'}>
        <input type="checkbox" checked={d.active} onChange={(e) => onSave({ active: e.target.checked })} aria-label={`${d.name} attivo`} />
        <span />
      </label>
      <button className="btn btn-icon btn-ghost btn-danger" onClick={onRemove} aria-label={`Elimina ${d.name}`}>
        <Trash2 size={16} />
      </button>
    </li>
  )
}

function CategoriesCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [draft, setDraft] = useState({ label: '', badge: '#0e7490' })
  const used = new Map<string, number>()
  for (const s of data.services) used.set(s.category, (used.get(s.category) ?? 0) + 1)

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) notify(ok)
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const move = (i: number, by: -1 | 1) => {
    const ids = data.categories.map((c) => c.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    return run(() => api.reorderCategories(ids))
  }

  const remove = (c: Category) => {
    if (!window.confirm(`Eliminare la categoria "${c.label}"?`)) return
    return run(() => api.deleteCategory(c.id), 'Categoria eliminata')
  }

  const add = () =>
    run(async () => {
      await api.createCategory(draft)
      setDraft({ ...draft, label: '' })
    }, 'Categoria aggiunta')

  return (
    <div className="card">
      <h2>Categorie</h2>
      <p className="sub">
        Raggruppano le prestazioni nella registrazione, nei grafici e nelle campagne. Puoi rinominarle, riordinarle e aggiungerne di nuove; una categoria si elimina solo se nessuna
        prestazione la usa.
      </p>
      <ul className="cat-list">
        {data.categories.map((c, i) => (
          <CategoryRow
            key={c.id}
            c={c}
            count={used.get(c.id) ?? 0}
            showBadge={data.settings.modules.appointments}
            first={i === 0}
            last={i === data.categories.length - 1}
            onSave={(label, badge) => run(() => api.updateCategory(c.id, { label, badge }))}
            onMove={(by) => move(i, by)}
            onRemove={() => remove(c)}
          />
        ))}
      </ul>
      <form
        className="settings-row"
        style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input className="input" style={{ flex: '2 1 160px' }} placeholder="Nuova categoria" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} maxLength={60} />
        {data.settings.modules.appointments && (
          <ColorInput value={draft.badge} onCommit={(badge) => setDraft((d) => ({ ...d, badge }))} label="Colore del badge della nuova categoria" />
        )}
        <button className="btn btn-primary" disabled={!draft.label.trim()}>
          <Plus size={16} /> Aggiungi
        </button>
      </form>
    </div>
  )
}

function CategoryRow({
  c,
  count,
  showBadge,
  first,
  last,
  onSave,
  onMove,
  onRemove,
}: {
  c: Category
  count: number
  /** Colore del badge negli appuntamenti: solo con il modulo attivo. */
  showBadge: boolean
  first: boolean
  last: boolean
  onSave: (label: string, badge: string) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  const [label, setLabel] = useState(c.label)
  useEffect(() => setLabel(c.label), [c.label])

  const commitLabel = () => {
    const l = label.trim()
    if (l && l !== c.label) onSave(l, c.badge)
    else setLabel(c.label)
  }

  return (
    <li className="cat-row">
      <span className="cat-move">
        <button type="button" className="btn btn-ghost btn-icon" disabled={first} onClick={() => onMove(-1)} aria-label={`Sposta su ${c.label}`}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" disabled={last} onClick={() => onMove(1)} aria-label={`Sposta giù ${c.label}`}>
          <ArrowDown size={14} />
        </button>
      </span>
      <input
        className="input"
        style={{ flex: 1, minWidth: 0, padding: '5px 8px' }}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={60}
        aria-label="Nome categoria"
      />
      {showBadge && <ColorInput value={c.badge} onCommit={(color) => onSave(label.trim() || c.label, color)} label={`Colore del badge di ${c.label}`} title="Colore del badge delle prestazioni negli appuntamenti" />}
      <span className="small muted cat-count">{count === 1 ? '1 prestazione' : `${count} prestazioni`}</span>
      <button
        className="btn btn-icon btn-ghost btn-danger"
        onClick={onRemove}
        disabled={count > 0}
        title={count > 0 ? 'Usata da alcune prestazioni: spostale prima in un\'altra categoria' : 'Elimina'}
        aria-label={`Elimina ${c.label}`}
      >
        <Trash2 size={16} />
      </button>
    </li>
  )
}

function ServicesCard({ data }: { data: AppDataState }) {
  const notify = useToast()
  const [draft, setDraft] = useState({ name: '', category: '' as CategoryId, price: '' })
  const { showPrices } = data.settings

  const update = async (s: Service, patch: Partial<Service>) => {
    try {
      await api.updateService(s.id, { ...s, ...patch })
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const remove = async (s: Service) => {
    if (!window.confirm(`Eliminare "${s.name}"? Se ha registrazioni verrà solo disattivata.`)) return
    try {
      const r = await api.deleteService(s.id)
      notify(r.deleted ? 'Prestazione eliminata' : 'Prestazione disattivata (ha dati storici)')
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const add = async () => {
    try {
      await api.createService({
        name: draft.name,
        category: draft.category || data.categories[0]?.id,
        price: !showPrices || draft.price === '' ? null : Number(draft.price),
        active: true,
      })
      setDraft({ ...draft, name: '', price: '' })
      notify('Prestazione aggiunta')
      data.reload()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="card">
      <h2>Prestazioni</h2>
      <p className="sub">
        Tipologie disponibili nella registrazione e nel template Excel.
        {showPrices ? ' Il prezzo medio serve a stimare il fatturato.' : ' I prezzi sono nascosti: attiva "Mostra prezzi" per modificarli.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome e categoria</th>
              {showPrices && <th className="r">Prezzo €</th>}
              <th>Attiva</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.services.map((s) => (
              <ServiceRow key={s.id} s={s} showPrice={showPrices} showBadge={data.settings.modules.appointments} onUpdate={update} onRemove={remove} />
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="settings-row"
        style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          className="input"
          style={{ flex: '2 1 160px' }}
          placeholder="Nuova prestazione"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={80}
        />
        <select
          className="input"
          style={{ flex: '1 1 150px' }}
          value={draft.category || data.categories[0]?.id}
          onChange={(e) => setDraft({ ...draft, category: e.target.value as CategoryId })}
          aria-label="Categoria"
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {showPrices && (
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            min={0}
            placeholder="€"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            aria-label="Prezzo medio"
          />
        )}
        <button className="btn btn-primary" disabled={!draft.name.trim()}>
          <Plus size={16} /> Aggiungi
        </button>
      </form>
    </div>
  )
}

function ServiceRow({
  s,
  showPrice,
  showBadge,
  onUpdate,
  onRemove,
}: {
  s: Service
  showPrice: boolean
  /** Colore del badge negli appuntamenti: solo con il modulo attivo. */
  showBadge: boolean
  onUpdate: (s: Service, p: Partial<Service>) => void
  onRemove: (s: Service) => void
}) {
  const [name, setName] = useState(s.name)
  const [price, setPrice] = useState(s.price === null ? '' : String(s.price))
  useEffect(() => setName(s.name), [s.name])
  useEffect(() => setPrice(s.price === null ? '' : String(s.price)), [s.price])

  const commitName = () => {
    if (name.trim() && name !== s.name) onUpdate(s, { name: name.trim() })
    else setName(s.name)
  }
  const commitPrice = () => {
    const p = price === '' ? null : Number(price)
    if (p !== s.price) onUpdate(s, { price: p })
  }

  return (
    <tr style={{ opacity: s.active ? 1 : 0.55 }}>
      <td>
        <input
          className="input"
          style={{ width: '100%', padding: '5px 8px' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Nome prestazione"
        />
        <div className="service-meta">
          <select
            className="input small"
            style={{ flex: 1, minWidth: 0, padding: '3px 6px', color: 'var(--text-2)' }}
            value={s.category}
            onChange={(e) => onUpdate(s, { category: e.target.value as CategoryId })}
            aria-label="Categoria"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {showBadge && <BadgeColor s={s} onChange={(color) => onUpdate(s, { color })} />}
        </div>
      </td>
      {showPrice && (
        <td className="r">
          <input
            className="input num"
            style={{ width: 80, padding: '5px 8px', textAlign: 'right' }}
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Prezzo medio"
          />
        </td>
      )}
      <td>
        <label className="switch" title={s.active ? 'Attiva' : 'Disattivata'}>
          <input type="checkbox" checked={s.active} onChange={(e) => onUpdate(s, { active: e.target.checked })} />
          <span />
        </label>
      </td>
      <td className="r">
        <button className="btn btn-icon btn-ghost btn-danger" onClick={() => onRemove(s)} aria-label={`Elimina ${s.name}`}>
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  )
}

/** Colore del badge della prestazione negli appuntamenti: anteprima, scelta e ritorno al colore della categoria. */
function BadgeColor({ s, onChange }: { s: Service; onChange: (color: string | null) => void }) {
  // Si salva a scelta finita (non a ogni valore digitato: ricaricando la pagina il selettore si chiuderebbe).
  const { draft, inputProps } = useColorPick(badgeColor(s.category, s.color), (color) => onChange(color))
  return (
    <span className="badge-color">
      <label className="svc-badge svc-badge-sm badge-color-preview" style={{ background: draft }} title="Colore del badge negli appuntamenti: clicca per cambiarlo">
        Badge
        <input {...inputProps} aria-label={`Colore del badge di ${s.name}`} />
      </label>
      {s.color && (
        <button type="button" className="btn btn-ghost btn-icon badge-color-reset" onClick={() => onChange(null)} title="Usa il colore della categoria">
          <RotateCcw size={13} />
        </button>
      )}
    </span>
  )
}
