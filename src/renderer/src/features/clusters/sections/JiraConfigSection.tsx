import { Ticket } from 'lucide-react'
import type { ClusterSummary, JiraAuthMode } from '../../../../../shared/types'
import { toClusterSlug } from '../../../../../shared/clusterSlug'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function JiraConfigSection({
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
      <SectionToggleHeader
        icon={Ticket}
        label="Jira"
        checked={form.useJira}
        onChange={(checked) => set('useJira', checked)}
      />
      {!form.useJira ? (
        <SectionEmptyState icon={Ticket}>
          List and file Jira tickets scoped to this cluster.
        </SectionEmptyState>
      ) : (
        <>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="jiraBaseUrl">Jira base URL</label>
              <input
                id="jiraBaseUrl"
                placeholder="https://yourorg.atlassian.net"
                value={form.jiraBaseUrl}
                onChange={(e) => set('jiraBaseUrl', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="jiraAuthMode">Auth mode</label>
              <select
                id="jiraAuthMode"
                value={form.jiraAuthMode}
                onChange={(e) => set('jiraAuthMode', e.target.value as JiraAuthMode)}
              >
                <option value="cloud">Jira Cloud (email + API token)</option>
                <option value="datacenter">Jira Data Center (PAT)</option>
              </select>
            </div>
          </div>
          {form.jiraAuthMode === 'cloud' && (
            <div className="form-field">
              <label htmlFor="jiraEmail">Account email</label>
              <input
                id="jiraEmail"
                value={form.jiraEmail}
                onChange={(e) => set('jiraEmail', e.target.value)}
              />
            </div>
          )}
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="jiraProjectKey">Default project key</label>
              <input
                id="jiraProjectKey"
                value={form.jiraProjectKey}
                onChange={(e) => set('jiraProjectKey', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="jiraJql">Default JQL filter</label>
              <input
                id="jiraJql"
                value={form.jiraJql}
                onChange={(e) => set('jiraJql', e.target.value)}
                placeholder={`project = ${form.jiraProjectKey || 'HPC'} AND labels = "${toClusterSlug(form.name)}"`}
              />
            </div>
          </div>
          <p className="hint">
            With no JQL set, this cluster&apos;s tags are used as Jira labels (together with the
            project key), so only tickets carrying one of those labels are listed - and new tickets
            created here get them. Label your existing tickets, or write a JQL here to override.
            Hostnames differ per cluster and aren&apos;t a useful Jira key. See docs/JIRA_GUIDE.md
            for the recommended pattern.
          </p>
          <div className="form-field">
            <label htmlFor="jiraApiToken">
              {form.jiraAuthMode === 'cloud' ? 'API token' : 'Personal access token'}
            </label>
            <input
              id="jiraApiToken"
              type="password"
              value={form.jiraApiToken}
              onChange={(e) => set('jiraApiToken', e.target.value)}
              placeholder={initial?.hasJiraToken ? 'Unchanged - leave blank to keep' : ''}
            />
          </div>
        </>
      )}
    </div>
  )
}
