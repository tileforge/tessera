import { useI18n } from '../i18n/context'
import type { HealthResponse } from '../api/detector'

type HealthStatusProps = {
  health?: HealthResponse
  pending: boolean
  unavailable: boolean
}

export function HealthStatus({ health, pending, unavailable }: HealthStatusProps) {
  const { messages } = useI18n()
  let state: 'checking' | 'unavailable' | 'deterministic' | 'full'
  let message: string
  let reason: string | undefined

  if (pending) {
    state = 'checking'
    message = messages.checkingHealth
  } else if (unavailable || !health) {
    state = 'unavailable'
    message = messages.unavailable
  } else if (!health.ner) {
    state = 'deterministic'
    message = messages.deterministicHealth
    reason = health.ner_off_reason ?? messages.nerUnavailable
  } else {
    state = 'full'
    message = messages.fullHealth
  }

  return (
    <div className="health-status" role="status" aria-live="polite" data-state={state}>
      <span>{message}</span>
      {reason && <span> {reason}</span>}
    </div>
  )
}
