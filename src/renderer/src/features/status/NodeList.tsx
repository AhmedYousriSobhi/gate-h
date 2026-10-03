import { useState } from 'react'
import type { SlurmNode } from '../../../../shared/types'
import { nodeIsDown, nodeStateClass } from './slurmState'

interface NodeListProps {
  nodes: SlurmNode[]
  onSelect: (node: SlurmNode) => void
}

/** Problem nodes first, each with its reason; everything else folded into one collapsed group per
 *  state so a few hundred healthy nodes don't bury the ones that need fixing. */
export default function NodeList({ nodes, onSelect }: NodeListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matching = needle ? nodes.filter((n) => n.name.toLowerCase().includes(needle)) : nodes

  const byName = (a: SlurmNode, b: SlurmNode): number =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  const problems = matching
    .filter((n) => nodeIsDown(n.state))
    .sort((a, b) => a.state.localeCompare(b.state) || byName(a, b))
  // One row per cause: twenty nodes drained for the same reason are one thing to fix, not twenty.
  const byReason = new Map<string, SlurmNode[]>()
  for (const node of problems) {
    const reason = node.reason.trim()
    byReason.set(reason, [...(byReason.get(reason) ?? []), node])
  }
  const problemGroups = [...byReason].sort((a, b) => b[1].length - a[1].length)
  const groups = new Map<string, SlurmNode[]>()
  for (const node of matching) {
    if (nodeIsDown(node.state)) continue
    groups.set(node.state, [...(groups.get(node.state) ?? []), node])
  }

  return (
    <div className="node-list">
      <input
        className="slurm-user-filter"
        type="text"
        placeholder={`Find a node (${nodes.length})...`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Find a node by name"
      />
      {problemGroups.length > 0 && (
        <div className="node-problems">
          <div className="node-group-title">
            Needs attention · {problems.length} node{problems.length === 1 ? '' : 's'} ·{' '}
            {problemGroups.length} cause{problemGroups.length === 1 ? '' : 's'}
          </div>
          {problemGroups.map(([reason, group]) => (
            <div className="issue-row node-problem" key={reason}>
              <div>
                <div className="node-reason-title">{reason || 'No reason recorded'}</div>
                <div className="slurm-node-chips">
                  {group.map((node) => (
                    <button
                      key={node.name}
                      type="button"
                      className={`issue-status ${nodeStateClass(node.state)} slurm-node-chip`}
                      title={`${node.name}: ${node.state} - click for details`}
                      onClick={() => onSelect(node)}
                    >
                      {node.name}
                    </button>
                  ))}
                </div>
              </div>
              <span className="slurm-dim node-problem-side">
                {group.length} node{group.length === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}
      {[...groups]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([state, group]) => (
          <details className="node-group" key={state} open={needle.length > 0}>
            <summary>
              <span className={`issue-status ${nodeStateClass(state)}`}>{state}</span>
              <span className="slurm-dim">{group.length} nodes</span>
            </summary>
            <div className="slurm-node-chips">
              {group.sort(byName).map((node) => (
                <button
                  key={node.name}
                  type="button"
                  className={`issue-status ${nodeStateClass(node.state)} slurm-node-chip`}
                  title={`${node.name}: ${node.state}`}
                  onClick={() => onSelect(node)}
                >
                  {node.name}
                </button>
              ))}
            </div>
          </details>
        ))}
      {matching.length === 0 && <p className="hint">No node matches.</p>}
    </div>
  )
}
