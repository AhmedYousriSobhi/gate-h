// Slurm hostlist expansion (`gpu[01-03,07]` -> names), used by the main process (GPU sampling) and
// the Status panel (which jobs run on a node).

export const DEFAULT_HOSTLIST_LIMIT = 64

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

function expandRanges(ranges: string, limit: number): string[] {
  return ranges.split(',').flatMap((range) => {
    const [from, to] = range.split('-')
    if (to === undefined) return [from]
    const width = from.length
    const out: string[] = []
    for (let n = Number(from); n <= Number(to) && out.length <= limit; n++) {
      out.push(String(n).padStart(width, '0'))
    }
    return out
  })
}

/** Expands a Slurm hostlist, including several bracket groups (`r[1-2]-n[01-02]`), stopping at
 *  `limit` names. */
export function expandHostlist(list: string, limit = DEFAULT_HOSTLIST_LIMIT): string[] {
  const hosts: string[] = []
  for (const item of splitTopLevel(list.trim())) {
    const match = /^([^[]*)\[([^\]]+)\](.*)$/.exec(item)
    const names = match
      ? expandRanges(match[2], limit).flatMap((middle) =>
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
