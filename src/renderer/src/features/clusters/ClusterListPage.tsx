import { useEffect, useState } from 'react'
import type { ClusterInput, ClusterSummary } from '../../../../shared/types'
import ClusterForm from './ClusterForm'
import './clusters.css'

interface ClusterListPageProps {
  onConnect: (cluster: ClusterSummary) => void
}

export default function ClusterListPage({ onConnect }: ClusterListPageProps): React.JSX.Element {
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ClusterSummary | 'new' | null>(null)

  async function refresh(): Promise<void> {
    setLoading(true)
    setLoadError(null)
    try {
      setClusters(await window.api.clusters.list())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load clusters.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await window.api.clusters.list()
        if (!cancelled) setClusters(data)
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : 'Failed to load clusters.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(input: ClusterInput): Promise<void> {
    if (editing && editing !== 'new') {
      await window.api.clusters.update(editing.id, input)
    } else {
      await window.api.clusters.create(input)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(cluster: ClusterSummary): Promise<void> {
    if (!confirm(`Remove cluster "${cluster.name}"? This cannot be undone.`)) return
    await window.api.clusters.remove(cluster.id)
    await refresh()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>H-Gate — Clusters</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add cluster
        </button>
      </header>

      {loadError && (
        <div className="error-banner" style={{ margin: 16 }}>
          {loadError}
        </div>
      )}

      {!loading && clusters.length === 0 && !loadError && (
        <div className="empty-state">
          <p>No clusters yet. Add your first HPC cluster to get started.</p>
        </div>
      )}

      <div className="cluster-list">
        {clusters.map((cluster) => (
          <div className="cluster-card" key={cluster.id}>
            <h3>{cluster.name}</h3>
            <div className="meta">
              {cluster.connection.username}@{cluster.connection.host}:{cluster.connection.port}
            </div>
            {cluster.description && <div className="meta">{cluster.description}</div>}
            {cluster.tags.length > 0 && (
              <div className="tags">
                {cluster.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="badge-row">
              <span>{cluster.grafana ? '📊 Grafana' : ''}</span>
              <span>{cluster.jira ? '🎫 Jira' : ''}</span>
              {cluster.connection.jumpHost ? <span>via jump host</span> : null}
            </div>
            <div className="card-actions">
              <button className="btn btn-primary" onClick={() => onConnect(cluster)}>
                Connect
              </button>
              <button className="btn" onClick={() => setEditing(cluster)}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(cluster)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ClusterForm
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
