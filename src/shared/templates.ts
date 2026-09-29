// Placeholders in a batch script template: `{{name}}` or `{{name:default}}`. Shared, so the
// renderer can build the fill-in form and the main process never has to - it only ever receives
// the fully rendered script, which the user has reviewed.

export interface TemplatePlaceholder {
  name: string
  defaultValue: string
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::([^}]*))?\}\}/g

/** Each placeholder once, in order of first appearance; the first default given wins. */
export function templatePlaceholders(body: string): TemplatePlaceholder[] {
  const seen = new Map<string, string>()
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (!seen.has(match[1])) seen.set(match[1], (match[2] ?? '').trim())
  }
  return [...seen].map(([name, defaultValue]) => ({ name, defaultValue }))
}

/** Empty values fall back to the placeholder's default - the first one given, as listed by
 *  templatePlaceholders, so `{{name:job}} ... {{name}}` renders `job` both times. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  const defaults = new Map(
    templatePlaceholders(body).map(({ name, defaultValue }) => [name, defaultValue])
  )
  return body.replace(PLACEHOLDER, (_whole, name: string) =>
    values[name] ? values[name] : (defaults.get(name) ?? '')
  )
}
