import { KeyRound } from 'lucide-react'
import type { ClusterSummary, SshAuthMethod } from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'

export default function SshSection({
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
      <h4>
        <KeyRound size={13} strokeWidth={2} />
        SSH connection
      </h4>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="host">Host</label>
          <input id="host" value={form.host} onChange={(e) => set('host', e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="port">Port</label>
          <input id="port" value={form.port} onChange={(e) => set('port', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="authMethod">Auth method</label>
          <select
            id="authMethod"
            value={form.authMethod}
            onChange={(e) => set('authMethod', e.target.value as SshAuthMethod)}
          >
            <option value="private-key">Private key</option>
            <option value="password">Password</option>
            <option value="agent">SSH agent</option>
          </select>
        </div>
      </div>
      {form.authMethod === 'private-key' && (
        <div className="form-field">
          <label htmlFor="privateKeyPath">Private key path</label>
          <input
            id="privateKeyPath"
            placeholder="~/.ssh/id_ed25519"
            value={form.privateKeyPath}
            onChange={(e) => set('privateKeyPath', e.target.value)}
          />
        </div>
      )}
      {form.authMethod !== 'agent' && (
        <div className="form-field">
          <label htmlFor="connectionSecret">
            {form.authMethod === 'password' ? 'Password' : 'Key passphrase (if any)'}
          </label>
          <input
            id="connectionSecret"
            type="password"
            value={form.connectionSecret}
            onChange={(e) => set('connectionSecret', e.target.value)}
            placeholder={initial?.hasConnectionSecret ? 'Unchanged - leave blank to keep' : ''}
          />
        </div>
      )}
      {form.useTeleport && (
        <p className="hint">
          Connecting through Teleport (below): Host above is the Teleport node name and Username the
          login. Port, auth method, private key and password aren&apos;t used for that hop.
        </p>
      )}
    </div>
  )
}
