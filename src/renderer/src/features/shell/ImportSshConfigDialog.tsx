import { useEffect, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import type { ClusterInput, SshConfigCandidate } from '../../../../shared/types'
import '../clusters/clusters.css'
import './import-ssh-config.css'

interface ImportSshConfigDialogProps {
  onClose: () => void
  /** Called once per successfully created cluster, so the sidebar picks it up without a full
   *  reload. */
  onImported: () => void
}

function toClusterInput(candidate: SshConfigCandidate): ClusterInput {
  return {
    name: candidate.name,
    description: '',
    tags: [],
    connection: {
      host: candidate.host,
      port: candidate.port,
      username: candidate.username ?? '',
      authMethod: candidate.privateKeyPath ? 'private-key' : 'agent',
      privateKeyPath: candidate.privateKeyPath
    },
    grafana: null,
    jira: null,
    azureTunnel: null,
    teleport: null,
    scheduler: null,
    storage: null
  }
}

/** Reads ~/.ssh/config once on open and lets the user pick which Host entries become clusters -
 *  nothing is created until "Import selected" runs, and each pick still goes through the normal
 *  clusters:create path, so it ends up exactly like a cluster added by hand. */
export default function ImportSshConfigDialog({
  onClose,
  onImported
}: ImportSshConfigDialogProps): React.JSX.Element {
  const [candidates, setCandidates] = useState<SshConfigCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    window.api.clusters
      .importFromSshConfig()
      .then((list) => {
        if (!cancelled) setCandidates(list)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function toggle(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function importSelected(): Promise<void> {
    if (!candidates) return
    setImporting(true)
    const picked = candidates.filter((c) => selected.has(c.name))
    for (const candidate of picked) {
      try {
        await window.api.clusters.create(toClusterInput(candidate))
        onImported()
        setResults((prev) => ({ ...prev, [candidate.name]: 'ok' }))
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [candidate.name]: err instanceof Error ? err.message : 'Failed to import.'
        }))
      }
    }
    setImporting(false)
  }

  const done = candidates && candidates.every((c) => results[c.name])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal import-ssh-modal">
        <div className="files-header">
          <h2>Import from ~/.ssh/config</h2>
          <button className="btn-icon" title="Close" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {loadError && <div className="error-banner">{loadError}</div>}

        {!loadError && !candidates && <p className="hint">Reading ~/.ssh/config...</p>}

        {candidates && candidates.length === 0 && (
          <p className="hint">
            No importable entries found - only concrete <code>Host</code> blocks (no wildcards)
            count, and <code>~/.ssh/config</code> may not exist yet.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <>
            <p className="hint">
              Pick which entries to add as clusters. Only Host/HostName/User/Port/IdentityFile are
              read - nothing here is ever written back to your SSH config.
            </p>
            <div className="import-ssh-list">
              {candidates.map((candidate) => {
                const result = results[candidate.name]
                return (
                  <label key={candidate.name} className="import-ssh-row">
                    <input
                      type="checkbox"
                      checked={selected.has(candidate.name)}
                      disabled={importing || Boolean(result)}
                      onChange={() => toggle(candidate.name)}
                    />
                    <span className="import-ssh-row-main">
                      <span className="import-ssh-row-name">{candidate.name}</span>
                      <span className="import-ssh-row-host mono">
                        {candidate.username ? `${candidate.username}@` : ''}
                        {candidate.host}:{candidate.port}
                      </span>
                    </span>
                    {candidate.hasProxy && (
                      <span
                        className="import-ssh-row-warning"
                        title="Uses ProxyJump/ProxyCommand - not imported, add a jump host by hand after importing"
                      >
                        <TriangleAlert size={13} strokeWidth={2} />
                      </span>
                    )}
                    {result && (
                      <span
                        className={result === 'ok' ? 'import-ssh-row-ok' : 'import-ssh-row-error'}
                      >
                        {result === 'ok' ? 'Added' : result}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-sm" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {candidates && candidates.length > 0 && !done && (
            <button
              className="btn btn-sm btn-primary"
              disabled={importing || selected.size === 0}
              onClick={() => void importSelected()}
            >
              {importing ? 'Importing...' : `Import selected (${selected.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
