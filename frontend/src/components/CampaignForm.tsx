import { Plus, Save, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { CATEGORIES } from '../../../shared/catalog.ts'
import type { CustomCampaignInput } from '../../../shared/types.ts'

export const CHANNEL_PRESETS = [
  'WhatsApp',
  'SMS',
  'Email',
  'Instagram',
  'Facebook',
  'Google Business',
  'Telefonata dalla segreteria',
  'In studio',
  'Volantini locali',
]

interface Props {
  title: string
  initial: CustomCampaignInput
  onSubmit: (value: CustomCampaignInput) => Promise<void>
  onClose: () => void
}

export default function CampaignForm({ title, initial, onSubmit, onClose }: Props) {
  const [v, setV] = useState<CustomCampaignInput>(initial)
  const [extraChannel, setExtraChannel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof CustomCampaignInput>(k: K, val: CustomCampaignInput[K]) => setV((x) => ({ ...x, [k]: val }))

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const toggleChannel = (c: string) =>
    set('channels', v.channels.includes(c) ? v.channels.filter((x) => x !== c) : [...v.channels, c])

  const addExtra = () => {
    const c = extraChannel.trim()
    if (c && !v.channels.includes(c)) set('channels', [...v.channels, c])
    setExtraChannel('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (v.dateTo < v.dateFrom) {
      setError('La data di fine è precedente a quella di inizio.')
      return
    }
    setBusy(true)
    try {
      await onSubmit({ ...v, title: v.title.trim() })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const extras = v.channels.filter((c) => !CHANNEL_PRESETS.includes(c))

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cf-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal-dialog" onSubmit={submit}>
        <div className="modal-head">
          <h2 id="cf-title">{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body form-grid">
          <label className="span-2">
            Titolo della campagna
            <input
              className="input"
              value={v.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={80}
              required
              autoFocus
              placeholder="es. Open day sbiancamento"
            />
          </label>
          <label>
            Categoria
            <select className="input" value={v.category} onChange={(e) => set('category', e.target.value as CustomCampaignInput['category'])}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row-2">
            <label>
              Dal
              <input className="input" type="date" value={v.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} required />
            </label>
            <label>
              Al
              <input className="input" type="date" value={v.dateTo} min={v.dateFrom} onChange={(e) => set('dateTo', e.target.value)} required />
            </label>
          </div>
          <label className="span-2">
            Offerta
            <textarea
              className="input"
              rows={2}
              value={v.offer}
              onChange={(e) => set('offer', e.target.value)}
              maxLength={300}
              placeholder="es. Sbiancamento professionale -30% e igiene inclusa"
            />
          </label>
          <label className="span-2">
            A chi è rivolta
            <input
              className="input"
              value={v.target}
              onChange={(e) => set('target', e.target.value)}
              maxLength={200}
              placeholder="es. Pazienti 25–50 anni con igiene negli ultimi 12 mesi"
            />
          </label>
          <div className="span-2">
            <div className="field-label">Canali</div>
            <div className="chips">
              {[...CHANNEL_PRESETS, ...extras].map((c) => (
                <button
                  type="button"
                  key={c}
                  className="chip-toggle"
                  aria-pressed={v.channels.includes(c)}
                  onClick={() => toggleChannel(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="settings-row" style={{ marginTop: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={extraChannel}
                onChange={(e) => setExtraChannel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addExtra()
                  }
                }}
                maxLength={40}
                placeholder="Altro canale (es. Radio locale)"
                aria-label="Altro canale"
              />
              <button type="button" className="btn" onClick={addExtra} disabled={!extraChannel.trim()}>
                <Plus size={16} /> Aggiungi
              </button>
            </div>
          </div>
          <label className="span-2">
            Note interne (non compaiono sul volantino)
            <textarea className="input" rows={3} value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
          </label>
          {error && <div className="alert alert-danger span-2">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={busy || !v.title.trim()}>
            <Save size={16} /> {busy ? 'Salvataggio…' : 'Salva campagna'}
          </button>
        </div>
      </form>
    </div>
  )
}
