import { CalendarClock, Check, ClipboardCheck, Copy, Link2, MessageCircle, Pencil, Phone, RotateCcw, Stethoscope, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { endTime, LINK_DAYS_AFTER, linkExpiry, whatsAppLink, whatsAppWebLink } from '../../../shared/appointments.ts'
import { formatDay, formatLongDay, today } from '../../../shared/dates.ts'
import type { Appointment } from '../../../shared/types.ts'
import { api, type AppSettings } from '../lib/api.ts'
import { confirmUrl, linkWarning, messageFor, needsReminder, STATUS } from '../lib/appointments.ts'
import { useToast } from './Toast.tsx'

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Senza HTTPS gli appunti non sono disponibili: si usa una casella temporanea.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** Telefono o tablet: lì il link wa.me apre l'app WhatsApp con il messaggio (icone comprese) già scritto. */
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))

const PASTE_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd + V' : 'Ctrl + V'

interface Props {
  appointment: Appointment
  settings: AppSettings
  onChange: (a: Appointment) => void
  onEdit: () => void
  onDelete: () => Promise<void>
  onClose: () => void
}

export default function AppointmentDetail({ appointment: a, settings, onChange, onEdit, onDelete, onClose }: Props) {
  const notify = useToast()
  // Dal computer il messaggio già scritto arriva intatto solo senza icone; con le icone va incollato.
  const [icons, setIcons] = useState(IS_MOBILE)
  // Sollecito deciso all'apertura: il testo non cambia mentre si invia il primo messaggio.
  const [reminder] = useState(() => needsReminder(a))
  const [message, setMessage] = useState(() => messageFor(settings, a, { icons: IS_MOBILE, reminder }))
  const [busy, setBusy] = useState(false)
  const [pasteHint, setPasteHint] = useState(false)
  const status = STATUS[a.status]
  const confirmed = a.status === 'confermato-link' || a.status === 'confermato-manuale'
  const valid = whatsAppLink(a.patientPhone) !== null
  const warning = linkWarning(settings)
  const linkUntil = linkExpiry(a.day)
  const expired = linkUntil < today()

  // Se cambiano l'appuntamento o la scelta delle icone, il messaggio si rigenera.
  useEffect(() => {
    setMessage(messageFor(settings, a, { icons, reminder }))
    setPasteHint(false)
  }, [a.day, a.time, a.patientName, a.serviceName, a.token, icons]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Ogni invio (anche i solleciti) viene contato.
  const markSent = async () => {
    try {
      onChange(await api.appointmentSent(a.id))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  /**
   * Apre la chat del paziente. Il messaggio è già scritto, tranne dal computer con le icone:
   * lì la chat si apre vuota e il messaggio va incollato dagli appunti (le icone restano intatte).
   */
  const send = async (where: 'app' | 'web') => {
    const paste = icons && !IS_MOBILE
    const make = where === 'web' ? whatsAppWebLink : whatsAppLink
    const link = make(a.patientPhone, paste ? undefined : message)
    if (!link) return
    // Va aperto subito, nello stesso clic: altrimenti il browser lo blocca come popup.
    window.open(link, '_blank', 'noopener')
    if (paste) {
      if (!(await copy(message))) {
        notify('Impossibile copiare il messaggio: usa "Copia messaggio"', 'error')
        return
      }
      setPasteHint(true)
    }
    markSent()
  }

  const copyMessage = async () => {
    if (await copy(message)) {
      notify('Messaggio copiato: incollalo nella chat del paziente')
      markSent()
    } else notify('Impossibile copiare il messaggio', 'error')
  }

  const copyLink = async () => {
    if (await copy(confirmUrl(settings, a))) notify('Link di conferma copiato')
  }

  const setConfirmed = async (value: boolean) => {
    setBusy(true)
    try {
      onChange(await api.appointmentConfirmation(a.id, value))
      notify(value ? 'Appuntamento segnato come confermato' : 'Conferma annullata')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Eliminare l'appuntamento di ${a.patientName}? Il link di conferma smetterà di funzionare.`)) return
    setBusy(true)
    try {
      await onDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ad-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog">
        <div className="modal-head">
          <h2 id="ad-title">{a.patientName}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body appt-detail">
          <div className="appt-facts">
            <span className={`appt-tag ${status.cls}`}>{status.label}</span>
            <div>
              <CalendarClock size={16} />
              <span>
                <strong>{formatLongDay(a.day)}</strong> · {a.time}–{endTime(a.time, a.duration)}
              </span>
            </div>
            {a.serviceName && (
              <div>
                <Stethoscope size={16} /> <span>{a.serviceName}</span>
              </div>
            )}
            <div>
              <Phone size={16} /> <a href={`tel:${a.patientPhone.replace(/[^\d+]/g, '')}`}>{a.patientPhone}</a>
            </div>
            {a.notes && <p className="appt-notes">{a.notes}</p>}
            <ul className="appt-history small muted">
              <li>
                Creato {stamp(a.createdAt)}
                {a.createdBy ? ` da ${a.createdBy}` : ''}
              </li>
              {a.sentAt && (
                <li>
                  Messaggio preparato {stamp(a.sentAt)}
                  {a.sendCount > 1 && a.lastSentAt ? ` · ${a.sendCount} invii, l'ultimo ${stamp(a.lastSentAt)}` : ''}
                </li>
              )}
              {a.callCount > 0 && a.lastCallAt && (
                <li>
                  Chiamato senza risposta {a.callCount === 1 ? 'una volta' : `${a.callCount} volte`}, l'ultima {stamp(a.lastCallAt)}
                </li>
              )}
              {a.confirmedAt && (
                <li>
                  {a.status === 'confermato-link' ? 'Confermato dal paziente con il link' : 'Confermato dallo studio'} {stamp(a.confirmedAt)}
                </li>
              )}
            </ul>
          </div>

          <div className="appt-message">
            <div className="appt-message-head">
              <span className="field-label">{reminder ? 'Sollecito di conferma' : 'Messaggio WhatsApp'}</span>
              {!IS_MOBILE && (
                <label className="small muted appt-icons-toggle" title="Dal computer WhatsApp altera le icone del messaggio già scritto: con le icone il messaggio va incollato">
                  <input type="checkbox" checked={icons} onChange={(e) => setIcons(e.target.checked)} />
                  Con le icone (da incollare con {PASTE_KEYS})
                </label>
              )}
            </div>
            {reminder && (
              <div className="alert alert-warn small">
                <TriangleAlert size={16} style={{ flex: 'none' }} />
                <span>
                  Messaggio già inviato {a.sendCount === 1 ? 'una volta' : `${a.sendCount} volte`}
                  {a.lastSentAt ? ` (l'ultima ${stamp(a.lastSentAt)})` : ''} e conferma non ancora arrivata: il testo è quello del sollecito.
                </span>
              </div>
            )}
            <textarea className="input" rows={17} value={message} onChange={(e) => setMessage(e.target.value)} />
            {expired && (
              <div className="alert alert-warn small">
                <TriangleAlert size={16} style={{ flex: 'none' }} />
                <span>Il link di conferma è scaduto il {formatDay(linkUntil)}: il paziente non può più aprirlo.</span>
              </div>
            )}
            {warning && !expired && (
              <div className="alert alert-warn small">
                <TriangleAlert size={16} style={{ flex: 'none' }} />
                <span>{warning}</span>
              </div>
            )}
            {!valid && (
              <div className="alert alert-danger small">
                Il numero {a.patientPhone} non sembra un numero WhatsApp valido: correggilo con Modifica.
              </div>
            )}
            <div className="appt-actions">
              {IS_MOBILE ? (
                <button type="button" className="btn btn-whatsapp" onClick={() => send('app')} disabled={!valid}>
                  <MessageCircle size={16} /> Apri in WhatsApp
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-whatsapp" onClick={() => send('app')} disabled={!valid} title="Apre la chat nell'app WhatsApp">
                    <MessageCircle size={16} /> App WhatsApp
                  </button>
                  <button type="button" className="btn" onClick={() => send('web')} disabled={!valid} title="Apre la chat in WhatsApp Web">
                    WhatsApp Web
                  </button>
                </>
              )}
              <button type="button" className="btn" onClick={copyMessage}>
                <Copy size={16} /> Copia messaggio
              </button>
              <button type="button" className="btn btn-ghost" onClick={copyLink} title="Solo il link personale di conferma">
                <Link2 size={16} /> Copia link
              </button>
            </div>
            {pasteHint && (
              <div className="alert alert-good small appt-paste-hint">
                <ClipboardCheck size={18} style={{ flex: 'none' }} />
                <span>
                  Messaggio copiato. Nella chat di WhatsApp premi <kbd>{PASTE_KEYS}</kbd> e poi invio.
                </span>
              </div>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Il link è personale: chi lo apre vede solo nome di battesimo, data, ora e prestazione, e può confermare.
              Smette di funzionare {LINK_DAYS_AFTER} giorni dopo l'appuntamento.
            </p>
          </div>
        </div>

        <div className="modal-foot appt-detail-foot">
          <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={busy}>
            <Trash2 size={16} /> Elimina
          </button>
          <span style={{ flex: 1 }} />
          {confirmed ? (
            <button type="button" className="btn" onClick={() => setConfirmed(false)} disabled={busy}>
              <RotateCcw size={16} /> Annulla conferma
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmed(true)} disabled={busy} title="Ad esempio se il paziente ha confermato al telefono">
              <Check size={16} /> Segna confermato
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onEdit} disabled={busy}>
            <Pencil size={16} /> Modifica
          </button>
        </div>
      </div>
    </div>
  )
}
