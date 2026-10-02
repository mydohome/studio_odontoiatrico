// Pagina pubblica aperta dal paziente con il link ricevuto su WhatsApp: niente accesso, solo il
// riepilogo dell'appuntamento e il pulsante di conferma.

import { CalendarCheck2, CheckCircle2, Clock, Loader2, MapPin, MessageCircle, Phone, Stethoscope } from 'lucide-react'
import { useEffect, useState } from 'react'
import { endTime, whatsAppNumber } from '../../../shared/appointments.ts'
import { formatLongDay } from '../../../shared/dates.ts'
import type { PublicAppointment } from '../../../shared/types.ts'
import { LOGO_PREVIEWS } from '../flyer/logoPreview.ts'
import { StudioLogo, type LogoType } from '../flyer/shapes.tsx'
import { api, ApiError } from '../lib/api.ts'
import { useCustomLogo } from '../lib/logo.ts'

function Logo({ studio }: { studio: PublicAppointment['studio'] }) {
  const custom = useCustomLogo(studio.logoType === 'custom' ? studio.logoVersion : 0)
  if (studio.logoType === 'custom') return <span className="login-logo">{custom && <img src={custom} alt="" />}</span>
  const preview = LOGO_PREVIEWS[studio.flyerStyle ?? 'smile']
  return (
    <span className="login-logo login-logo-tile" style={{ background: preview.bg }}>
      <StudioLogo type={studio.logoType as LogoType} height={56} colors={preview.colors} />
    </span>
  )
}

export default function Conferma({ token }: { token: string }) {
  const [data, setData] = useState<PublicAppointment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [justConfirmed, setJustConfirmed] = useState(false)

  useEffect(() => {
    document.title = 'Conferma appuntamento'
    api
      .publicAppointment(token)
      .then((d) => {
        setData(d)
        document.title = `Conferma appuntamento · ${d.studio.name}`
      })
      .catch((e) => setError((e as Error).message))
  }, [token])

  const confirm = async () => {
    setBusy(true)
    try {
      setData(await api.confirmAppointment(token))
      setJustConfirmed(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 410 && data) setData({ ...data, past: true })
      else setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="login public-page">
        <div className="card public-card">
          {error ? (
            <div className="public-state">
              <CalendarCheck2 size={34} />
              <p>{error}</p>
              <p className="small muted">Se pensi che sia un errore, contatta lo studio.</p>
            </div>
          ) : (
            <div className="public-state">
              <Loader2 className="spin" size={28} />
            </div>
          )}
        </div>
      </div>
    )
  }

  const { studio } = data
  const wa = studio.phone ? whatsAppNumber(studio.phone) : null
  const maps = studio.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(studio.address)}` : null

  return (
    <div className="login public-page">
      <div className="card public-card">
        <div className="login-brand">
          <Logo studio={studio} />
          <div className="login-studio">{studio.name}</div>
        </div>

        <p className="public-hello">
          Gentile {data.firstName}, ecco il suo appuntamento:
        </p>
        <div className="public-when">
          <div className="public-day">{formatLongDay(data.day)}</div>
          <div className="public-time">
            <Clock size={18} /> ore {data.time}
            <span className="muted"> – {endTime(data.time, data.duration)}</span>
          </div>
          {data.serviceName && (
            <div className="public-line">
              <Stethoscope size={16} /> {data.serviceName}
            </div>
          )}
          {studio.address && (
            <a className="public-line" href={maps!} target="_blank" rel="noopener noreferrer">
              <MapPin size={16} /> {studio.address}
            </a>
          )}
        </div>

        {data.confirmed ? (
          <div className="alert alert-good public-done">
            <CheckCircle2 size={22} style={{ flex: 'none' }} />
            <span>
              <strong>{justConfirmed ? 'Grazie, appuntamento confermato!' : 'Appuntamento confermato.'}</strong>
              <br />
              La aspettiamo.
            </span>
          </div>
        ) : data.past ? (
          <div className="alert alert-warn">Questo appuntamento è già passato: non è più possibile confermarlo.</div>
        ) : (
          <button className="btn btn-primary public-confirm" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />} Confermo l'appuntamento
          </button>
        )}
        {error && <div className="alert alert-danger">{error}</div>}

        {(studio.phone || wa) && (
          <div className="public-contact">
            <p className="small muted">Per spostare o annullare l'appuntamento contatti lo studio:</p>
            <div className="public-contact-actions">
              {studio.phone && (
                <a className="btn" href={`tel:${studio.phone.replace(/[^\d+]/g, '')}`}>
                  <Phone size={16} /> Chiama {studio.phone}
                </a>
              )}
              {wa && (
                <a className="btn btn-whatsapp" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
