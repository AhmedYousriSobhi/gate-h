// Checks for src/main/scheduler/gpu.ts and src/main/grafana/gpu.ts, run by test-pty-manager.mjs:
// Slurm hostlist expansion, the nvidia-smi job-step command and its output, and the Grafana
// /api/ds/query body and response (shaped like Grafana's data frames for instant queries).

import {
  expandHostlist,
  MAX_GPU_HOSTS,
  nvidiaSmiCommand,
  parseNvidiaSmi
} from '../src/main/scheduler/gpu'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { getGpuUsage, gpuQueryBody, parseGpuResponse } from '../src/main/grafana/gpu'

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

console.log('-- hostlists')
report(
  same(expandHostlist('gpu[07-09,12]'), ['gpu07', 'gpu08', 'gpu09', 'gpu12']),
  'ranges and singles, keeping zero padding'
)
report(
  same(expandHostlist('cpu1,gpu[1-2],login'), ['cpu1', 'gpu1', 'gpu2', 'login']),
  'top-level commas outside brackets'
)
report(
  same(expandHostlist('r[1-2]-n[01-02]'), ['r1-n01', 'r1-n02', 'r2-n01', 'r2-n02']),
  'several bracket groups'
)
report(expandHostlist('n[0001-9999]').length === MAX_GPU_HOSTS, `stops at ${MAX_GPU_HOSTS} names`)

console.log('-- nvidia-smi')
const cmd = nvidiaSmiCommand('48213', 2)
report(
  cmd.startsWith('srun --jobid=48213 --overlap --whole --nodes=2 --ntasks-per-node=1 ') &&
    cmd.includes('--format=csv,noheader,nounits'),
  "runs as an overlapping step inside the user's job, one task per node",
  cmd
)
report(
  throws(() => nvidiaSmiCommand('1;id', 1)) && throws(() => nvidiaSmiCommand('1', 0)),
  'job id and node count are validated'
)
const smi = parseNvidiaSmi(
  'gpu07, 0, NVIDIA A100-SXM4-80GB, 97, 71234, 81920, 64\ngpu07, 1, NVIDIA A100-SXM4-80GB, [N/A], 10, 81920, 41\nsrun: warning: something\n'
)
report(
  smi.length === 2 &&
    smi[0].host === 'gpu07' &&
    smi[0].utilizationPct === 97 &&
    smi[0].memoryTotalMiB === 81920,
  'parses one GPU per line, skipping srun chatter'
)
report(smi[1].utilizationPct === null && smi[1].temperatureC === 41, '[N/A] becomes null')

console.log('-- grafana')
const body = gpuQueryBody('prom-uid', 'Hostname', ['gpu07', 'node.1']) as {
  queries: Array<{ refId: string; expr: string; datasource: { uid: string }; instant: boolean }>
}
report(
  body.queries.length === 4 &&
    body.queries.every((q) => q.datasource.uid === 'prom-uid' && q.instant),
  'one instant query per metric against the datasource'
)
report(
  body.queries[0].expr === 'DCGM_FI_DEV_GPU_UTIL{Hostname=~"gpu07|node\\\\.1"}',
  'selects the nodes by label, escaping dots for the regex',
  body.queries[0].expr
)
const frame = (host: string, gpu: string, value: number): object => ({
  schema: {
    fields: [
      { name: 'Time' },
      { name: 'Value', labels: { Hostname: host, gpu, modelName: 'NVIDIA H100' } }
    ]
  },
  data: {
    values: [
      [1727600000000, 1727600015000],
      [value - 1, value]
    ]
  }
})
const samples = parseGpuResponse(
  {
    results: {
      util: { frames: [frame('gpu07', '1', 88), frame('gpu07', '0', 50)] },
      used: { frames: [frame('gpu07', '0', 30000), frame('gpu07', '1', 60000)] },
      free: { frames: [frame('gpu07', '0', 50000), frame('gpu07', '1', 20000)] },
      temp: { frames: [frame('gpu07', '0', 55), frame('gpu07', '1', 71)] }
    }
  },
  'Hostname'
)
report(
  samples.length === 2 && samples[0].gpu === '0',
  'one sample per node and GPU, in order',
  JSON.stringify(samples)
)
report(
  samples[0].utilizationPct === 50 &&
    samples[0].memoryUsedMiB === 30000 &&
    samples[0].memoryTotalMiB === 80000 &&
    samples[0].temperatureC === 55,
  'latest value per metric; total memory = used + free'
)
report(
  throws(() =>
    parseGpuResponse({ results: { util: { error: 'bad_data: parse error' } } }, 'Hostname')
  ),
  'a query error from Grafana is raised, not shown as no data'
)

async function overHttp(): Promise<void> {
  console.log('-- over http')
  let seen: { method?: string; url?: string; auth?: string; body?: string } = {}
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      seen = { method: req.method, url: req.url, auth: req.headers.authorization, body }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ results: { util: { frames: [frame('gpu07', '0', 42)] } } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const result = await getGpuUsage(
    { baseUrl: `http://127.0.0.1:${port}/`, dashboardUids: [], gpuDatasourceUid: 'prom-uid' },
    'secret-token',
    ['gpu07']
  )
  server.close()
  report(
    seen.method === 'POST' && seen.url === '/api/ds/query' && seen.auth === 'Bearer secret-token',
    "POSTs to /api/ds/query with the cluster's token",
    JSON.stringify(seen)
  )
  report(JSON.parse(seen.body ?? '{}').queries?.length === 4, 'sends all four metric queries')
  report(result.length === 1 && result[0].utilizationPct === 42, 'returns the parsed samples')
}

overHttp()
  .catch((err) => {
    console.error(err)
    failures++
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
    process.exit(failures ? 1 : 0)
  })
