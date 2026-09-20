/** A Jira label/component (and Grafana tag) friendly slug of a cluster's own Gate-H name.
 *
 * HPC clusters typically expose several distinct hostnames - a login node, a range of compute
 * node names, a scheduler controller - none of which make a sensible cross-tool key, and none of
 * which a user should have to type into Jira/Grafana by hand. The cluster's Gate-H name is
 * already the one identifier that's unique, stable, and chosen by the user; this just normalizes
 * it into something safe to use as a label. See docs/JIRA_GUIDE.md for the full pattern.
 */
export function toClusterSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cluster'
  )
}
