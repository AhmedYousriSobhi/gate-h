import type { KeyRound } from 'lucide-react'

/** Marks a required field's label - an asterisk (not color alone, per WCAG 1.4.1) plus a
 *  screen-reader-only "(required)" the visual asterisk alone wouldn't announce. Used only on the
 *  three fields that are always required (Name, Host, Username) - every other field in this form
 *  is optional, behind its own section toggle - see the "* Required" note in ClusterForm's
 *  header. */
export function RequiredMark(): React.JSX.Element {
  return (
    <>
      <span className="required-mark" aria-hidden="true">
        {' '}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

/** An optional section's heading: a toggle switch rather than a checkbox, since it turns a whole
 *  group of fields on or off below it, not one item among independent choices - see
 *  https://developer.apple.com/design/human-interface-guidelines/toggles ("use a switch to let
 *  people turn on or off a group of settings"). */
export function SectionToggleHeader({
  icon: Icon,
  label,
  checked,
  disabled,
  onChange
}: {
  icon: typeof KeyRound
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="cluster-section-header">
      <h4>
        <Icon size={13} strokeWidth={2} />
        {label}
      </h4>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </label>
    </div>
  )
}

/** What a toggled-off optional section shows instead of blank space below its header - a brief
 *  explanation of what turning it on does, not nothing. */
export function SectionEmptyState({
  icon: Icon,
  children
}: {
  icon: typeof KeyRound
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="cluster-section-empty">
      <Icon size={28} strokeWidth={1.5} />
      <p>{children}</p>
    </div>
  )
}
