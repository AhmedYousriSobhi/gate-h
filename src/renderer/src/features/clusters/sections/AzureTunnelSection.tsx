import { Cloud } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  AzureSubscription,
  AzureTunnelMode,
  AzureTunnelVerifyResult,
  AzureVmMatch,
  ClusterSummary
} from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

interface AzureTunnelSectionProps {
  form: FormState
  set: SetFormField
  setForm: Dispatch<SetStateAction<FormState>>
  initial?: ClusterSummary
  subscriptions: AzureSubscription[]
  subscriptionsError: string | null
  loadingSubscriptions: boolean
  loadSubscriptions: () => Promise<void>
  vmMatches: AzureVmMatch[]
  vmLookupError: string | null
  vmFoundMessage: string | null
  findingVm: boolean
  handleFindVm: () => Promise<void>
  applyVmMatch: (match: AzureVmMatch) => void
  verifyingTunnel: boolean
  verifyProgress: string | null
  verifyCommand: string | null
  verifyResult: AzureTunnelVerifyResult | null
  verifyFailure: string | null
  handleVerifyTunnel: () => Promise<void>
}

/** Always shows something for the last "Find subscription" click - searching, the error, the
 *  match found, or a picker for more than one - directly under the field it came from, so a
 *  search never looks like it did nothing. */
function VmSearchStatus({
  findingVm,
  vmMatches,
  vmLookupError,
  vmFoundMessage,
  applyVmMatch
}: Pick<
  AzureTunnelSectionProps,
  'findingVm' | 'vmMatches' | 'vmLookupError' | 'vmFoundMessage' | 'applyVmMatch'
>): React.JSX.Element | null {
  if (findingVm) {
    return <p className="hint">Searching every subscription you can see...</p>
  }
  if (vmMatches.length > 0) {
    return (
      <div className="form-field">
        <label htmlFor="azureVmMatches">
          {vmMatches.length} matches found across your subscriptions - pick one
        </label>
        <select
          id="azureVmMatches"
          value=""
          onChange={(e) => {
            const match = vmMatches.find((m) => m.id === e.target.value)
            if (match) applyVmMatch(match)
          }}
        >
          <option value="" disabled>
            Choose the subscription / resource group...
          </option>
          {vmMatches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.subscriptionName} / {m.resourceGroup}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (vmLookupError) return <p className="hint">{vmLookupError}</p>
  if (vmFoundMessage) return <p className="hint">{vmFoundMessage}</p>
  return null
}

export default function AzureTunnelSection({
  form,
  set,
  setForm,
  initial,
  subscriptions,
  subscriptionsError,
  loadingSubscriptions,
  loadSubscriptions,
  vmMatches,
  vmLookupError,
  vmFoundMessage,
  findingVm,
  handleFindVm,
  applyVmMatch,
  verifyingTunnel,
  verifyProgress,
  verifyCommand,
  verifyResult,
  verifyFailure,
  handleVerifyTunnel
}: AzureTunnelSectionProps): React.JSX.Element {
  return (
    <div className="form-section">
      <SectionToggleHeader
        icon={Cloud}
        label="Azure tunnel"
        checked={form.useAzureTunnel}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            useAzureTunnel: checked,
            useTeleport: checked ? false : prev.useTeleport
          }))
        }
      />
      {!form.useAzureTunnel ? (
        <SectionEmptyState icon={Cloud}>
          Reach the target through an Azure Bastion or <code>az ssh vm</code> tunnel - for a VM with
          no direct SSH access.
        </SectionEmptyState>
      ) : (
        <>
          <p className="hint">
            Before connecting, Gate-H signs in with the Azure CLI (az), selects this subscription,
            and opens a tunnel. SSH then connects to 127.0.0.1 on the local port. Without a jump
            host above, Host/Port above are the tunnel&apos;s far end - the target VM&apos;s real
            hostname or IP (Bastion), or the login node as the VM reaches it (az ssh vm). With a
            jump host above, the tunnel reaches the jump host instead, and Host/Port above stay the
            final target, reached from there. Either way, never localhost - that field is what
            host-key trust is pinned to, not the actual tunnel address. Needs az on PATH. See the
            README section on clusters reachable only through Azure.
          </p>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="azureMode">Tunnel through</label>
              <select
                id="azureMode"
                value={form.azureMode}
                onChange={(e) => set('azureMode', e.target.value as AzureTunnelMode)}
              >
                <option value="bastion">Azure Bastion</option>
                <option value="az-ssh">VM via az ssh vm</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="azureLocalPort">Local port</label>
              <input
                id="azureLocalPort"
                placeholder="2222"
                value={form.azureLocalPort}
                onChange={(e) => set('azureLocalPort', e.target.value)}
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="azureRemotePort">Remote port (optional)</label>
            <input
              id="azureRemotePort"
              placeholder={`Defaults to ${form.jumpHostEnabled && !form.useTeleport ? 'jump host' : 'Host/Port above'}'s port`}
              value={form.azureRemotePort}
              onChange={(e) => set('azureRemotePort', e.target.value)}
            />
            <p className="hint">
              The port the tunnel targets on the far side - usually the same as the SSH port above,
              so you rarely need to set this. Set it independently when it isn&apos;t:
              Bastion&apos;s IP-based connect (no resource ID/VM name) only ever allows 22 or 3389
              here, regardless of the real sshd port.
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="azureSubscription">Subscription (ID or name)</label>
            <div className="form-inline">
              <input
                id="azureSubscription"
                placeholder="Subscription ID or name"
                value={form.azureSubscription}
                onChange={(e) => set('azureSubscription', e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={loadSubscriptions}
                disabled={loadingSubscriptions}
              >
                {loadingSubscriptions ? 'Loading...' : 'Load from az'}
              </button>
            </div>
            {subscriptions.length > 0 && (
              <select
                aria-label="Pick a subscription fetched from az"
                value=""
                onChange={(e) => {
                  if (e.target.value) set('azureSubscription', e.target.value)
                }}
              >
                <option value="">
                  {subscriptions.length} subscription
                  {subscriptions.length === 1 ? '' : 's'} found - pick one...
                </option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id}){s.isDefault ? ' - az default' : ''}
                  </option>
                ))}
              </select>
            )}
            {subscriptionsError && <p className="hint">{subscriptionsError}</p>}
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="azureResourceGroup">Resource group</label>
              <input
                id="azureResourceGroup"
                value={form.azureResourceGroup}
                onChange={(e) => set('azureResourceGroup', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="azureTenant">Tenant ID (optional)</label>
              <input
                id="azureTenant"
                value={form.azureTenant}
                onChange={(e) => set('azureTenant', e.target.value)}
              />
            </div>
          </div>
          {form.azureMode === 'bastion' ? (
            <>
              <div className="form-field">
                <label htmlFor="azureBastionName">Bastion name</label>
                <input
                  id="azureBastionName"
                  value={form.azureBastionName}
                  onChange={(e) => set('azureBastionName', e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="azureTargetResourceId">Target VM resource ID (optional)</label>
                <input
                  id="azureTargetResourceId"
                  placeholder="/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/virtualMachines/..."
                  value={form.azureTargetResourceId}
                  onChange={(e) => set('azureTargetResourceId', e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="azureVmName">or VM name</label>
                <div className="form-inline">
                  <input
                    id="azureVmName"
                    placeholder="Resolved to a resource ID via `az vm show` when opened"
                    value={form.azureVmName}
                    onChange={(e) => set('azureVmName', e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleFindVm}
                    disabled={findingVm || !form.azureVmName.trim()}
                  >
                    {findingVm ? 'Searching...' : 'Find subscription'}
                  </button>
                </div>
                <VmSearchStatus
                  findingVm={findingVm}
                  vmMatches={vmMatches}
                  vmLookupError={vmLookupError}
                  vmFoundMessage={vmFoundMessage}
                  applyVmMatch={applyVmMatch}
                />
              </div>
              <div className="form-field">
                <label htmlFor="azureTargetIpAddress">or IP address</label>
                <input
                  id="azureTargetIpAddress"
                  placeholder="No VM resource id needed - e.g. a different resource group"
                  value={form.azureTargetIpAddress}
                  onChange={(e) => set('azureTargetIpAddress', e.target.value)}
                />
                <p className="hint">
                  Needs &quot;IP-based connection&quot; enabled on this Bastion host. Use this when
                  the target isn&apos;t in this Bastion&apos;s resource group (or
                  subscription/tenant), or isn&apos;t an Azure VM resource at all.
                </p>
              </div>
            </>
          ) : (
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="azureVmName">VM name</label>
                <div className="form-inline">
                  <input
                    id="azureVmName"
                    value={form.azureVmName}
                    onChange={(e) => set('azureVmName', e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleFindVm}
                    disabled={findingVm || !form.azureVmName.trim()}
                  >
                    {findingVm ? 'Searching...' : 'Find subscription'}
                  </button>
                </div>
                <VmSearchStatus
                  findingVm={findingVm}
                  vmMatches={vmMatches}
                  vmLookupError={vmLookupError}
                  vmFoundMessage={vmFoundMessage}
                  applyVmMatch={applyVmMatch}
                />
              </div>
              <div className="form-field">
                <label htmlFor="azureLocalUser">Local VM user (optional)</label>
                <input
                  id="azureLocalUser"
                  placeholder="Blank = Entra ID login"
                  value={form.azureLocalUser}
                  onChange={(e) => set('azureLocalUser', e.target.value)}
                />
              </div>
            </div>
          )}
          {initial && (
            <div className="form-field">
              <div className="form-inline">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleVerifyTunnel}
                  disabled={verifyingTunnel}
                >
                  {verifyingTunnel ? 'Verifying...' : 'Verify tunnel'}
                </button>
              </div>
              <p className="hint">
                Opens (or reuses) this cluster&apos;s actual tunnel and waits for a live SSH banner
                through it - confirms the tunnel really carries traffic, not just that az reports it
                open. Uses the saved configuration, not unsaved edits above.
              </p>
              {verifyingTunnel && verifyProgress && <p className="hint">{verifyProgress}</p>}
              {verifyFailure && <p className="hint">Could not verify: {verifyFailure}</p>}
              {verifyResult && !verifyResult.tunnelOpened && (
                <p className="hint">Tunnel failed to open: {verifyResult.tunnelError}</p>
              )}
              {verifyResult && verifyResult.tunnelOpened && (
                <p className="hint">
                  Tunnel is open and an SSH banner arrived in {verifyResult.latencyMs}ms - the path
                  to sshd is working end to end.
                </p>
              )}
              {verifyCommand && (
                <p className="hint">
                  <code>{verifyCommand}</code>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
