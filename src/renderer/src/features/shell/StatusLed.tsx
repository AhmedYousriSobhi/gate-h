import type { ReachabilityStatus } from '../../../../shared/types'

interface StatusLedProps {
  status: ReachabilityStatus | undefined
}

const LABELS: Record<ReachabilityStatus, string> = {
  online: 'Reachable',
  offline: 'Unreachable',
  checking: 'Checking...'
}

export default function StatusLed({ status }: StatusLedProps): React.JSX.Element {
  const resolved = status ?? 'checking'
  return <span className={`status-led status-led-${resolved}`} title={LABELS[resolved]} />
}
