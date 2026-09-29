import { trimBaseUrl } from './client'
import type { GpuSample, GrafanaProfile } from '../../shared/types'

// GPU usage from NVIDIA's DCGM exporter metrics, queried through the cluster's Grafana with the
// service-account token it already has (`/api/ds/query` against the Prometheus datasource the
// cluster names). Costs the cluster nothing: Prometheus already scrapes these.

const METRICS = {
  util: 'DCGM_FI_DEV_GPU_UTIL',
  used: 'DCGM_FI_DEV_FB_USED',
  free: 'DCGM_FI_DEV_FB_FREE',
  temp: 'DCGM_FI_DEV_GPU_TEMP'
} as const
type Metric = keyof typeof METRICS

interface Frame {
  schema?: { fields?: Array<{ labels?: Record<string, string> }> }
  data?: { values?: unknown[][] }
}
interface QueryResponse {
  results?: Record<string, { frames?: Frame[]; error?: string }>
}

export function gpuQueryBody(uid: string, hostLabel: string, hosts: string[]): object {
  // Hosts are validated node names; only `.` needs escaping in the regex.
  const hostRegex = hosts.map((host) => host.replace(/\./g, '\\\\.')).join('|')
  return {
    from: 'now-5m',
    to: 'now',
    queries: (Object.keys(METRICS) as Metric[]).map((refId) => ({
      refId,
      datasource: { uid },
      expr: `${METRICS[refId]}{${hostLabel}=~"${hostRegex}"}`,
      instant: true,
      range: false
    }))
  }
}

/** Each metric's frames carry one labelled value field per series; the latest value wins. */
export function parseGpuResponse(response: QueryResponse, hostLabel: string): GpuSample[] {
  const samples = new Map<string, GpuSample>()
  for (const refId of Object.keys(METRICS) as Metric[]) {
    const result = response.results?.[refId]
    if (result?.error) throw new Error(`Grafana: ${result.error}`)
    for (const frame of result?.frames ?? []) {
      const fields = frame.schema?.fields ?? []
      fields.forEach((field, i) => {
        const labels = field.labels
        if (!labels?.[hostLabel]) return
        const column = frame.data?.values?.[i] ?? []
        const latest = Number(column[column.length - 1])
        if (!Number.isFinite(latest)) return
        const key = `${labels[hostLabel]}|${labels.gpu ?? '?'}`
        const sample = samples.get(key) ?? {
          host: labels[hostLabel],
          gpu: labels.gpu ?? '?',
          model: labels.modelName ?? '',
          utilizationPct: null,
          memoryUsedMiB: null,
          memoryTotalMiB: null,
          temperatureC: null
        }
        if (refId === 'util') sample.utilizationPct = latest
        if (refId === 'used') sample.memoryUsedMiB = latest
        if (refId === 'temp') sample.temperatureC = latest
        // DCGM reports used and free framebuffer; total is their sum.
        if (refId === 'free') sample.memoryTotalMiB = latest
        samples.set(key, sample)
      })
    }
  }
  return [...samples.values()]
    .map((s) => ({
      ...s,
      memoryTotalMiB:
        s.memoryTotalMiB !== null && s.memoryUsedMiB !== null
          ? s.memoryTotalMiB + s.memoryUsedMiB
          : null
    }))
    .sort((a, b) => a.host.localeCompare(b.host) || Number(a.gpu) - Number(b.gpu))
}

export async function getGpuUsage(
  profile: GrafanaProfile,
  token: string,
  hosts: string[]
): Promise<GpuSample[]> {
  if (!profile.gpuDatasourceUid) throw new Error('No GPU metrics datasource configured.')
  const hostLabel = profile.gpuHostLabel || 'Hostname'
  const res = await fetch(`${trimBaseUrl(profile.baseUrl)}/api/ds/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(gpuQueryBody(profile.gpuDatasourceUid, hostLabel, hosts)),
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`Grafana returned HTTP ${res.status} for the GPU query.`)
  return parseGpuResponse((await res.json()) as QueryResponse, hostLabel)
}
