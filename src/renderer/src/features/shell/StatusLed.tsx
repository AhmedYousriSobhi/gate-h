import type { ReachabilityStatus } from '../../../../shared/types'

interface StatusLedProps {
  status: ReachabilityStatus | undefined
  /** Round-trip time of the probe that produced this reading, when online - shown in the
   *  tooltip so a slow-but-up login node reads differently from a fast one. */
  latencyMs?: number
}

const LABELS: Record<ReachabilityStatus, string> = {
  online: 'Reachable',
  offline: 'Unreachable',
  checking: 'Checking...'
}

export default function StatusLed({ status, latencyMs }: StatusLedProps): React.JSX.Element {
  const resolved = status ?? 'checking'
  const label =
    resolved === 'online' && latencyMs != null
      ? `${LABELS[resolved]} (${latencyMs}ms)`
      : LABELS[resolved]
  return <span className={`status-led status-led-${resolved}`} title={label} />
}
