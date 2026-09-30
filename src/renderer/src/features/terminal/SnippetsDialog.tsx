import { useEffect, useState } from 'react'
import { FileCode2, Plus, Save, Trash2, X } from 'lucide-react'
import type { Snippet } from '../../../../shared/types'
import '../templates/templates.css'

interface SnippetsDialogProps {
  onClose: () => void
}

type Draft = { id?: string; name: string; body: string }

const BLANK: Draft = { name: 'New snippet', body: '' }

/** The profile's saved shell commands: create, edit and delete them. Inserting one into a
 *  terminal happens from that session's own Snippets popover, not here - this dialog only
 *  manages the list. */
export default function SnippetsDialog({ onClose }: SnippetsDialogProps): React.JSX.Element {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.snippets
      .list()
      .then((list) => {
        if (cancelled) return
        setSnippets(list)
        if (list[0]) setDraft(list[0])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
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

  const dirty =
    !draft.id ||
    snippets.find((s) => s.id === draft.id)?.body !== draft.body ||
    snippets.find((s) => s.id === draft.id)?.name !== draft.name

  function select(next: Draft): void {
    setDraft(next)
    setNotice(null)
    setError(null)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.api.snippets.save(draft)
      setSnippets(await window.api.snippets.list())
      setDraft(saved)
      setNotice(`Saved "${saved.name}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the snippet.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!draft.id) return
    setBusy(true)
    try {
      await window.api.snippets.remove(draft.id)
      const list = await window.api.snippets.list()
      setSnippets(list)
      select(list[0] ?? BLANK)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the snippet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal templates-modal">
        <div className="files-header">
          <h2>Snippets</h2>
          <button className="btn-icon" title="Close" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="templates-layout">
          <div className="templates-list">
            {snippets.map((snippet) => (
              <button
                key={snippet.id}
                className={`templates-item${snippet.id === draft.id ? ' templates-item-active' : ''}`}
                onClick={() => select(snippet)}
              >
                <FileCode2 size={13} strokeWidth={2} />
                {snippet.name}
              </button>
            ))}
            <button className="templates-item" onClick={() => select(BLANK)}>
              <Plus size={13} strokeWidth={2} />
              New snippet
            </button>
          </div>

          <div className="templates-editor">
            <input
              className="templates-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Snippet name"
            />
            <textarea
              className="templates-body"
              value={draft.body}
              spellCheck={false}
              placeholder="A command, or a few lines of them, to insert into a terminal"
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              aria-label="Snippet text"
            />
            <div className="templates-actions">
              {draft.id && (
                <button className="btn btn-sm" disabled={busy} onClick={() => void remove()}>
                  <Trash2 size={13} strokeWidth={2} />
                  Delete
                </button>
              )}
              <span className="slurm-grow" />
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                <Save size={13} strokeWidth={2} />
                Save
              </button>
            </div>
            {error && <div className="error-banner">{error}</div>}
            {notice && <p className="hint">{notice}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
