import { Stethoscope } from 'lucide-react'
import type { Appointment } from '../../../shared/types.ts'
import { readableOn } from './ColorInput.tsx'

type WithDoctor = Pick<Appointment, 'doctorName' | 'doctorColor'>

/** Badge arrotondato nel colore del medico, con il suo nome. */
export function DoctorBadge({ appointment: a, size = 'md' }: { appointment: WithDoctor; size?: 'sm' | 'md' }) {
  if (!a.doctorName || !a.doctorColor) return null
  return (
    <span className={`svc-badge svc-badge-${size} doc-badge`} style={{ background: a.doctorColor, color: readableOn(a.doctorColor) }} title={`Medico: ${a.doctorName}`}>
      <Stethoscope size={size === 'sm' ? 11 : 13} aria-hidden /> {a.doctorName}
    </span>
  )
}

/** Pallino nel colore del medico, per gli appuntamenti troppo corti per il badge. */
export function DoctorDot({ appointment: a }: { appointment: WithDoctor }) {
  if (!a.doctorName || !a.doctorColor) return null
  return <span className="svc-dot doc-dot" style={{ background: a.doctorColor }} title={`Medico: ${a.doctorName}`} />
}

/** Nelle righe brevi: badge con il nome; dove c'è poco posto (appuntamenti affiancati) solo il pallino. */
export function DoctorTag({ appointment, compact }: { appointment: WithDoctor; compact: boolean }) {
  return compact ? <DoctorDot appointment={appointment} /> : <DoctorBadge appointment={appointment} size="sm" />
}
