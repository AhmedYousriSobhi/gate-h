import { useEffect, useState } from 'react'
import { ArrowUp, Download, File, Folder, Home, Link2, Upload, X } from 'lucide-react'
import type { ClusterSummary, FileTransferEvent, RemoteDirectory } from '../../../../shared/types'
import './files.css'

interface FilesDialogProps {
  cluster: ClusterSummary
  onClose: () => void
}

function size(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

function parent(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const at = trimmed.lastIndexOf('/')
  return at <= 0 ? '/' : trimmed.slice(0, at)
}

/** Browse a cluster's files and transfer them over SFTP on the terminal's existing connection.
 *  Where files land (or come from) locally is always picked in a native dialog. */
export default function FilesDialog({ cluster, onClose }: FilesDialogProps): React.JSX.Element {
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<FileTransferEvent[]>([])

  async function open(path?: string): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.files.list(cluster.id, path)
      setDirectory(next)
      setPathInput(next.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list the directory.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    window.api.files
      .list(cluster.id)
      .then((home) => {
        if (cancelled) return
        setDirectory(home)
        setPathInput(home.path)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const off = window.api.files.onTransfer((event) => {
      if (event.clusterId !== cluster.id) return
      setTransfers((prev) => [event, ...prev.filter((t) => t.id !== event.id)].slice(0, 20))
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [cluster.id, onClose])

  async function download(name: string): Promise<void> {
    if (!directory) return
    try {
      await window.api.files.download(cluster.id, `${directory.path.replace(/\/+$/, '')}/${name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.')
    }
  }

  async function upload(): Promise<void> {
    if (!directory) return
    try {
      if ((await window.api.files.upload(cluster.id, directory.path)) > 0)
        await open(directory.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal files-modal">
        <div className="files-header">
          <h2>Files on {cluster.name}</h2>
          <button className="btn-icon" title="Close" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <form
          className="files-pathbar"
          onSubmit={(e) => {
            e.preventDefault()
            void open(pathInput.trim())
          }}
        >
          <button type="button" className="btn-icon" title="Home" onClick={() => void open()}>
            <Home size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="Up one level"
            disabled={!directory || directory.path === '/'}
            onClick={() => directory && void open(parent(directory.path))}
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!directory}
            onClick={() => void upload()}
          >
            <Upload size={13} strokeWidth={2} />
            Upload here
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}
        <div className="files-list">
          {loading && <p className="hint">Loading...</p>}
          {!loading && directory?.entries.length === 0 && (
            <p className="hint">This folder is empty.</p>
          )}
          {!loading &&
            directory?.entries.map((entry) => {
              const Icon = entry.type === 'dir' ? Folder : entry.type === 'link' ? Link2 : File
              const isDir = entry.type === 'dir'
              // A link may point at a folder (`scratch -> /lustre/...`) or a file; opening one
              // that's a file just shows the listing error.
              const canOpen = isDir || entry.type === 'link'
              const openEntry = (): void => {
                if (canOpen) void open(`${directory.path.replace(/\/+$/, '')}/${entry.name}`)
              }
              return (
                <div
                  key={entry.name}
                  className={`files-row${canOpen ? ' files-row-dir' : ''}`}
                  onDoubleClick={openEntry}
                >
                  <Icon size={14} strokeWidth={2} />
                  <button className="files-name" onClick={openEntry} disabled={!canOpen}>
                    {entry.name}
                  </button>
                  <span className="files-meta">{isDir ? '' : size(entry.size)}</span>
                  <span className="files-meta">{new Date(entry.modifiedAt).toLocaleString()}</span>
                  {!isDir ? (
                    <button
                      className="btn-icon"
                      title={`Download ${entry.name}`}
                      onClick={() => void download(entry.name)}
                    >
                      <Download size={14} strokeWidth={2} />
                    </button>
                  ) : (
                    <span className="files-action-spacer" />
                  )}
                </div>
              )
            })}
        </div>

        {transfers.length > 0 && (
          <div className="files-transfers">
            {transfers.map((t) => {
              const fraction = t.total ? t.transferred / t.total : 0
              return (
                <div key={t.id} className="files-transfer">
                  <span>
                    {t.direction === 'download' ? '↓' : '↑'} {t.name}
                  </span>
                  <span className={t.error ? 'slurm-error' : 'files-meta'}>
                    {t.error ??
                      (t.done
                        ? 'Done'
                        : t.total
                          ? `${Math.round(fraction * 100)}% of ${size(t.total)}`
                          : 'Starting...')}
                  </span>
                  {!t.done && (
                    <div className="storage-bar files-transfer-bar">
                      <div className="storage-bar-fill" style={{ width: `${fraction * 100}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
