import { BarChart3 } from 'lucide-react'
import type { ClusterSummary } from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function GrafanaSection({
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
        icon={BarChart3}
        label="Grafana status"
        checked={form.useGrafana}
        onChange={(checked) => set('useGrafana', checked)}
      />
      {!form.useGrafana ? (
        <SectionEmptyState icon={BarChart3}>
          Show this cluster&apos;s dashboards and a health check from a Grafana instance.
        </SectionEmptyState>
      ) : (
        <>
          <div className="form-field">
            <label htmlFor="grafanaBaseUrl">Grafana base URL</label>
            <input
              id="grafanaBaseUrl"
              placeholder="https://grafana.example.org"
              value={form.grafanaBaseUrl}
              onChange={(e) => set('grafanaBaseUrl', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="grafanaDashboardUids">Dashboard UIDs (comma separated)</label>
            <input
              id="grafanaDashboardUids"
              value={form.grafanaDashboardUids}
              onChange={(e) => set('grafanaDashboardUids', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="grafanaApiToken">Service account API token</label>
            <input
              id="grafanaApiToken"
              type="password"
              value={form.grafanaApiToken}
              onChange={(e) => set('grafanaApiToken', e.target.value)}
              placeholder={initial?.hasGrafanaToken ? 'Unchanged - leave blank to keep' : ''}
            />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="grafanaGpuDatasourceUid">GPU metrics datasource UID (optional)</label>
              <input
                id="grafanaGpuDatasourceUid"
                placeholder="Prometheus datasource with DCGM metrics"
                value={form.grafanaGpuDatasourceUid}
                onChange={(e) => set('grafanaGpuDatasourceUid', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="grafanaGpuHostLabel">Node label</label>
              <input
                id="grafanaGpuHostLabel"
                placeholder="Hostname"
                value={form.grafanaGpuHostLabel}
                onChange={(e) => set('grafanaGpuHostLabel', e.target.value)}
              />
            </div>
          </div>
          <p className="hint">
            With a datasource set, the Slurm section shows GPU utilization, memory and temperature
            for your running jobs&apos; nodes from NVIDIA&apos;s DCGM exporter metrics. The node
            label must hold the node name as Slurm prints it.
          </p>
        </>
      )}
    </div>
  )
}
