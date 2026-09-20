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

export function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}
