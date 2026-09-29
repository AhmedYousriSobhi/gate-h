import type { GpuSample } from '../../shared/types'

// GPU usage for the nodes a user's jobs run on. Two sources: DCGM exporter metrics through the
// cluster's Grafana (../grafana/gpu.ts - no load on the cluster at all), or, where a site has no
// DCGM, a one-off nvidia-smi inside one of the user's own running jobs. Login nodes usually have
// no GPUs, and many sites forbid SSH to compute nodes, so nvidia-smi only ever runs as a job step.

/** Node names as Slurm prints them, once expanded - checked before they reach a shell or a
 *  PromQL regex. */
export const NODE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
/** A job's node list can be thousands of names; more than this is too many to chart anyway. */
export const MAX_GPU_HOSTS = 64

/** Splits on commas outside brackets: `gpu[01-02,05],cpu7` -> [`gpu[01-02,05]`, `cpu7`]. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '[') depth++
    else if (list[i] === ']') depth--
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts.filter(Boolean)
}

function expandRanges(ranges: string): string[] {
  return ranges.split(',').flatMap((range) => {
    const [from, to] = range.split('-')
    if (to === undefined) return [from]
    const width = from.length
    const out: string[] = []
    for (let n = Number(from); n <= Number(to) && out.length <= MAX_GPU_HOSTS; n++) {
      out.push(String(n).padStart(width, '0'))
    }
    return out
  })
}

/** Expands a Slurm hostlist, including several bracket groups (`r[1-2]-n[01-02]`), stopping at
 *  `limit` names. */
export function expandHostlist(list: string, limit = MAX_GPU_HOSTS): string[] {
  const hosts: string[] = []
  for (const item of splitTopLevel(list.trim())) {
    const match = /^([^[]*)\[([^\]]+)\](.*)$/.exec(item)
    const names = match
      ? expandRanges(match[2]).flatMap((middle) =>
          expandHostlist(`${match[1]}${middle}${match[3]}`, limit)
        )
      : [item]
    for (const name of names) {
      if (hosts.length >= limit) return hosts
      hosts.push(name)
    }
  }
  return hosts
}

const QUERY = 'index,name,utilization.gpu,memory.used,memory.total,temperature.gpu'

/** One nvidia-smi per node of the user's own running job, as an extra step sharing its
 *  resources: `--overlap` so it never waits behind the job, `--whole` so the step can see the
 *  job's GPUs where cgroups constrain devices (Slurm 21.08+). Each line is prefixed with the
 *  node's short hostname. */
export function nvidiaSmiCommand(jobId: string, nodes: number): string {
  if (!/^\d+(_\d+)?$/.test(jobId)) throw new Error(`Invalid job id: ${jobId}`)
  if (!Number.isInteger(nodes) || nodes < 1 || nodes > MAX_GPU_HOSTS) {
    throw new Error(`Can't sample ${nodes} nodes at once (at most ${MAX_GPU_HOSTS}).`)
  }
  return (
    `srun --jobid=${jobId} --overlap --whole --nodes=${nodes} --ntasks-per-node=1 ` +
    `sh -c 'h=$(hostname -s); nvidia-smi --query-gpu=${QUERY} --format=csv,noheader,nounits ` +
    `| sed "s/^/$h, /"'`
  )
}

function value(text: string | undefined): number | null {
  const n = Number(text?.trim())
  return text?.trim() && Number.isFinite(n) ? n : null
}

/** `host, index, name, util, mem used, mem total, temp` - nvidia-smi prints `[N/A]` for values a
 *  GPU doesn't report, which become null. */
export function parseNvidiaSmi(text: string): GpuSample[] {
  return text
    .split('\n')
    .map((line) => line.split(','))
    .filter((f) => f.length >= 7)
    .map((f) => ({
      host: f[0].trim(),
      gpu: f[1].trim(),
      model: f
        .slice(2, f.length - 4)
        .join(',')
        .trim(),
      utilizationPct: value(f[f.length - 4]),
      memoryUsedMiB: value(f[f.length - 3]),
      memoryTotalMiB: value(f[f.length - 2]),
      temperatureC: value(f[f.length - 1])
    }))
}
