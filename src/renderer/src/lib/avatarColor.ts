/** Deterministic, pleasant accent color per cluster name - so the sidebar reads as a set of
 *  distinct places at a glance (like workspace/channel avatars in Slack or Linear), without
 *  needing the user to pick or upload anything. */
export function avatarColorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 62%, 46%)`
}

function singleInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/** First letter of each of the name's first two words ("compute-node-tsh" -> "CN"), or its first
 *  two characters when it's a single word - used to tell apart two clusters that would otherwise
 *  show the same single-letter avatar (e.g. "Compute-1" and "compute-node-tsh" both start with
 *  "C"). */
function doubleInitial(name: string): string {
  const trimmed = name.trim()
  const words = trimmed.split(/[\s\-_]+/).filter(Boolean)
  if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase() || '?'
}

/** Single-letter initial by default; falls back to a two-letter one only for names that would
 *  otherwise collide with another cluster's initial, so color-blind users aren't left relying on
 *  avatar color alone to tell two clusters apart. */
export function initialFor(name: string, siblingNames: string[] = []): string {
  const mine = singleInitial(name)
  const collides = siblingNames.some((other) => other !== name && singleInitial(other) === mine)
  return collides ? doubleInitial(name) : mine
}
