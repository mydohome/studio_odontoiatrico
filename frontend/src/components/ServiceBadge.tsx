import { badgeColor } from '../../../shared/catalog.ts'
import type { Appointment } from '../../../shared/types.ts'

/** Badge pieno, scritta bianca, nel colore della prestazione (o della sua categoria). */
export function ServiceBadge({
  appointment: a,
  size = 'md',
}: {
  appointment: Pick<Appointment, 'serviceName' | 'serviceCategory' | 'serviceColor'>
  size?: 'sm' | 'md'
}) {
  if (!a.serviceName) return null
  return (
    <span className={`svc-badge svc-badge-${size}`} style={{ background: badgeColor(a.serviceCategory, a.serviceColor) }} title={a.serviceName}>
      {a.serviceName}
    </span>
  )
}

/** Pallino nel colore della prestazione, per gli appuntamenti troppo corti per il badge. */
export function ServiceDot({ appointment: a }: { appointment: Pick<Appointment, 'serviceName' | 'serviceCategory' | 'serviceColor'> }) {
  if (!a.serviceName) return null
  return <span className="svc-dot" style={{ background: badgeColor(a.serviceCategory, a.serviceColor) }} title={a.serviceName} />
}
