import { useEffect, useMemo, useState } from 'react'
import { FileCode2, Plus, Save, Send, Trash2, X } from 'lucide-react'
import type { ClusterSummary, JobTemplate } from '../../../../shared/types'
import { renderTemplate, templatePlaceholders } from '../../../../shared/templates'
import './templates.css'

interface TemplatesDialogProps {
  cluster: ClusterSummary
  onClose: () => void
}

const STARTER = `#!/bin/bash
#SBATCH --job-name={{name:my-job}}
#SBATCH --partition={{partition:gpu}}
#SBATCH --nodes={{nodes:1}}
#SBATCH --gpus-per-node={{gpus:1}}
#SBATCH --time={{time:01:00:00}}
#SBATCH --output=%x-%j.out

srun {{command:python train.py}}
`

type Draft = { id?: string; name: string; body: string }

/** The profile's batch script templates: edit them, fill in their {{placeholders}}, review the
 *  rendered script, and submit it to this cluster. Submitting is confirmed once more in a native
 *  dialog by the main process before sbatch runs. */
export default function TemplatesDialog({
  cluster,
  onClose
}: TemplatesDialogProps): React.JSX.Element {
  const [templates, setTemplates] = useState<JobTemplate[]>([])
  const [draft, setDraft] = useState<Draft>({ name: 'New template', body: STARTER })
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.templates
      .list()
      .then((list) => {
        if (cancelled) return
        setTemplates(list)
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

  const placeholders = useMemo(() => templatePlaceholders(draft.body), [draft.body])
  const rendered = renderTemplate(draft.body, values)
  const dirty =
    !draft.id ||
    templates.find((t) => t.id === draft.id)?.body !== draft.body ||
    templates.find((t) => t.id === draft.id)?.name !== draft.name

  function select(next: Draft): void {
    setDraft(next)
    setValues({})
    setPreviewing(false)
    setNotice(null)
    setError(null)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.api.templates.save(draft)
      setTemplates(await window.api.templates.list())
      setDraft(saved)
      setNotice(`Saved "${saved.name}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the template.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!draft.id) return
    setBusy(true)
    try {
      await window.api.templates.remove(draft.id)
      const list = await window.api.templates.list()
      setTemplates(list)
      select(list[0] ?? { name: 'New template', body: STARTER })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the template.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const jobId = await window.api.scheduler.submit(cluster.id, rendered, draft.name)
      setNotice(jobId ? `Submitted batch job ${jobId} to ${cluster.name}.` : 'Not submitted.')
      if (jobId) setPreviewing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sbatch failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal templates-modal">
        <div className="files-header">
          <h2>Job templates</h2>
          <button className="btn-icon" title="Close" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="templates-layout">
          <div className="templates-list">
            {templates.map((template) => (
              <button
                key={template.id}
                className={`templates-item${template.id === draft.id ? ' templates-item-active' : ''}`}
                onClick={() => select(template)}
              >
                <FileCode2 size={13} strokeWidth={2} />
                {template.name}
              </button>
            ))}
            <button
              className="templates-item"
              onClick={() => select({ name: 'New template', body: STARTER })}
            >
              <Plus size={13} strokeWidth={2} />
              New template
            </button>
          </div>

          <div className="templates-editor">
            {!previewing ? (
              <>
                <input
                  className="templates-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="Template name"
                />
                <textarea
                  className="templates-body"
                  value={draft.body}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  aria-label="Batch script"
                />
                {placeholders.length > 0 && (
                  <div className="templates-fields">
                    {placeholders.map((placeholder) => (
                      <label key={placeholder.name} className="form-field">
                        <span>{placeholder.name}</span>
                        <input
                          value={values[placeholder.name] ?? ''}
                          placeholder={placeholder.defaultValue}
                          onChange={(e) =>
                            setValues({ ...values, [placeholder.name]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="templates-actions">
                  {draft.id && (
                    <button className="btn btn-sm" disabled={busy} onClick={() => void remove()}>
                      <Trash2 size={13} strokeWidth={2} />
                      Delete
                    </button>
                  )}
                  <span className="slurm-grow" />
                  <button
                    className="btn btn-sm"
                    disabled={busy || !dirty}
                    onClick={() => void save()}
                  >
                    <Save size={13} strokeWidth={2} />
                    Save
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy || !cluster.scheduler}
                    title={cluster.scheduler ? undefined : 'Turn on Slurm for this cluster first'}
                    onClick={() => setPreviewing(true)}
                  >
                    Review for {cluster.name}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="hint">
                  This runs <code>sbatch --parsable</code> on {cluster.name} as{' '}
                  {cluster.connection.username}, with exactly this script on standard input:
                </p>
                <pre className="templates-preview">{rendered}</pre>
                <div className="templates-actions">
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => setPreviewing(false)}
                  >
                    Back
                  </button>
                  <span className="slurm-grow" />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    <Send size={13} strokeWidth={2} />
                    {busy ? 'Submitting...' : 'Submit...'}
                  </button>
                </div>
              </>
            )}
            {error && <div className="error-banner">{error}</div>}
            {notice && <p className="hint">{notice}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
