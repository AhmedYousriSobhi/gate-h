import { ShieldCheck } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function TeleportSection({
  form,
  set,
  setForm
}: {
  form: FormState
  set: SetFormField
  setForm: Dispatch<SetStateAction<FormState>>
}): React.JSX.Element {
  return (
    <div className="form-section">
      <SectionToggleHeader
        icon={ShieldCheck}
        label="Teleport"
        checked={form.useTeleport}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            useTeleport: checked,
            useAzureTunnel: checked ? false : prev.useAzureTunnel,
            // A jump host can't be combined with Teleport (see JumpHostConfig).
            jumpHostEnabled: checked ? false : prev.jumpHostEnabled
          }))
        }
      />
      {!form.useTeleport ? (
        <SectionEmptyState icon={ShieldCheck}>
          Reach the target through a Teleport proxy instead of connecting directly - for a cluster
          behind Teleport&apos;s access gateway.
        </SectionEmptyState>
      ) : (
        <>
          <p className="hint">
            The terminal runs tsh ssh through this proxy. If there&apos;s no valid tsh session, you
            log in right in the terminal: password and OTP prompts appear there, or your browser
            opens for SSO. Needs tsh on PATH. See docs/TELEPORT.md.
          </p>
          <div className="form-field">
            <label htmlFor="teleportProxy">Proxy address</label>
            <input
              id="teleportProxy"
              placeholder="teleport.example.com:443"
              value={form.teleportProxy}
              onChange={(e) => set('teleportProxy', e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="teleportCluster">Leaf cluster (optional)</label>
              <input
                id="teleportCluster"
                value={form.teleportCluster}
                onChange={(e) => set('teleportCluster', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="teleportUser">Teleport user (optional)</label>
              <input
                id="teleportUser"
                placeholder="Blank = your OS user"
                value={form.teleportUser}
                onChange={(e) => set('teleportUser', e.target.value)}
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="teleportAuthConnector">Auth connector (optional)</label>
            <input
              id="teleportAuthConnector"
              placeholder="Blank = the cluster's default"
              value={form.teleportAuthConnector}
              onChange={(e) => set('teleportAuthConnector', e.target.value)}
            />
          </div>
          <label className="form-field-checkbox">
            <input
              type="checkbox"
              checked={form.teleportInsecure}
              onChange={(e) => set('teleportInsecure', e.target.checked)}
            />
            Skip certificate verification (self-signed/lab proxy, no real CA)
          </label>
          {form.teleportInsecure && (
            <p className="hint">
              tsh won&apos;t verify this proxy&apos;s TLS certificate at all - only use this for a
              proxy you know is self-signed (a lab/test cluster), never on a network you don&apos;t
              trust. For a real organisation CA, use <code>SSL_CERT_FILE</code> instead and leave
              this off.
            </p>
          )}
        </>
      )}
    </div>
  )
}
