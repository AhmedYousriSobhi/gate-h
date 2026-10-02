import { Waypoints } from 'lucide-react'
import type { ClusterSummary, SshAuthMethod } from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function JumpHostSection({
  form,
  set,
  initial
}: {
  form: FormState
  set: SetFormField
  initial?: ClusterSummary
}): React.JSX.Element {
  return (
    <div className="form-section">
      <SectionToggleHeader
        icon={Waypoints}
        label="Route through a jump host / bastion hop"
        checked={form.jumpHostEnabled && !form.useTeleport}
        disabled={form.useTeleport}
        onChange={(checked) => set('jumpHostEnabled', checked)}
      />
      {form.useTeleport ? (
        <p className="hint">
          Not available when connecting through Teleport (below) - every node it routes to presents
          a certificate host key this app&apos;s SSH library can&apos;t verify.
        </p>
      ) : !form.jumpHostEnabled ? (
        <SectionEmptyState icon={Waypoints}>
          Adds an intermediate SSH hop before reaching Host/Port above - for a bastion or firewall
          between you and the login node.
        </SectionEmptyState>
      ) : (
        <>
          <p className="hint">
            Reached first - directly, or through the Azure tunnel below if one&apos;s configured
            (the tunnel then reaches this jump host, not the target directly) - then a normal SSH
            hop from there reaches Host/Port above.
          </p>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="jumpHost">Jump host</label>
              <input
                id="jumpHost"
                value={form.jumpHost}
                onChange={(e) => set('jumpHost', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="jumpPort">Jump port</label>
              <input
                id="jumpPort"
                value={form.jumpPort}
                onChange={(e) => set('jumpPort', e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="jumpUsername">Jump username</label>
              <input
                id="jumpUsername"
                value={form.jumpUsername}
                onChange={(e) => set('jumpUsername', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="jumpAuthMethod">Jump auth method</label>
              <select
                id="jumpAuthMethod"
                value={form.jumpAuthMethod}
                onChange={(e) => set('jumpAuthMethod', e.target.value as SshAuthMethod)}
              >
                <option value="private-key">Private key</option>
                <option value="password">Password</option>
                <option value="agent">SSH agent</option>
              </select>
            </div>
          </div>
          {form.jumpAuthMethod === 'private-key' && (
            <div className="form-field">
              <label htmlFor="jumpPrivateKeyPath">Jump host private key path</label>
              <input
                id="jumpPrivateKeyPath"
                value={form.jumpPrivateKeyPath}
                onChange={(e) => set('jumpPrivateKeyPath', e.target.value)}
              />
            </div>
          )}
          {form.jumpAuthMethod !== 'agent' && (
            <div className="form-field">
              <label htmlFor="jumpHostSecret">
                {form.jumpAuthMethod === 'password'
                  ? 'Jump host password'
                  : 'Jump host key passphrase (if any)'}
              </label>
              <input
                id="jumpHostSecret"
                type="password"
                value={form.jumpHostSecret}
                onChange={(e) => set('jumpHostSecret', e.target.value)}
                placeholder={initial?.hasJumpHostSecret ? 'Unchanged - leave blank to keep' : ''}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
