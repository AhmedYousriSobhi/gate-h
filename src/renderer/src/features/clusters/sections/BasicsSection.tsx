import type { FormState, SetFormField } from '../formState'

export default function BasicsSection({
  form,
  set
}: {
  form: FormState
  set: SetFormField
}): React.JSX.Element {
  return (
    <>
      <div className="form-field">
        <label htmlFor="name">Name</label>
        <input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div className="form-field">
        <label htmlFor="tags">Tags (comma separated)</label>
        <input id="tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
      </div>
    </>
  )
}
