import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { ReachabilityStatus } from '../../../../shared/types'
import { timeAgo } from '../../lib/timeAgo'

interface StatusPillProps {
  status: ReachabilityStatus | undefined
  latencyMs?: number
  checkedAt?: string
}

const ICON: Record<
  ReachabilityStatus,
  React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
  online: CheckCircle2,
  offline: XCircle,
  checking: Loader2
}

/** Status is never color-only: every reading pairs an icon and text with the semantic color, and
 *  spells out latency or how long ago it was last checked so "is it up?" doesn't need a hover. */
export default function StatusPill({
  status,
  latencyMs,
  checkedAt
}: StatusPillProps): React.JSX.Element {
  const resolved = status ?? 'checking'
  const Icon = ICON[resolved]

  let detail: string | null = null
  if (resolved === 'online' && latencyMs != null) detail = `${latencyMs} ms`
  else if (resolved === 'offline' && checkedAt) detail = timeAgo(checkedAt)

  const label =
    resolved === 'online' ? 'Online' : resolved === 'offline' ? 'Unreachable' : 'Checking…'

  return (
    <span className={`status-pill status-pill-${resolved}`}>
      <Icon size={12} strokeWidth={2} className={resolved === 'checking' ? 'spin' : undefined} />
      {label}
      {detail && <span className="status-pill-detail"> · {detail}</span>}
    </span>
  )
}
