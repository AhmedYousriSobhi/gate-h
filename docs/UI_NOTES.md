# Overview dashboard - UI notes

## Tokens
No new color tokens were added - `assets/base.css` already had everything needed:
`--color-online/offline/checking/warning` (status, never decorative), `--color-text-1/2/3`,
`--color-surface*`, the 4px `--space-*` scale, and `--radius-*`. Only layout-only additions:
`.sr-only` and the card/summary/skeleton rules in `shell.css`.

## Card anatomy
```
┌──────────────────────────────────┐
│ [Av] Name              ⋮         │
│      ● Online · 42 ms            │
│ host.example.com          [copy] │
│ (description, if set)            │
│ [Grafana] [Jira]        [Connect]│
└──────────────────────────────────┘
```
`StatusPill` pairs an icon with text and a number (latency when online, "time ago" when
unreachable) so status is never conveyed by color alone. The primary action is state-aware
(Connect when online, Retry when unreachable); "View status" moved into a `⋯` overflow menu. The
whole card is a focusable, clickable control (`role="button"`) that mirrors the primary action.

## Key decisions
- **Summary strip doubles as the filter control.** The brief asked for both a clickable summary
  strip and a separate All/Needs-attention/Online selector; keeping both would have reintroduced
  the exact redundancy (sidebar vs. Overview) the redesign set out to remove. The four stat chips
  (Clusters/Online/Unreachable/With alerts) are the filter.
- **One "+ Add cluster" entry point** (sidebar) plus a dedicated empty-state CTA, replacing the
  two generic buttons that both called the same handler.
- **Insight row (Slurm/GPU/Jira) is intentionally absent.** That data is only fetched per-cluster
  on demand; fleet-wide polling would conflict with SPEC.md §3.10's scoped-polling requirement.
  Needs real infrastructure + a deliberate IPC design, not a renderer-only change.
- **Avatar collisions** ("Compute-1" vs. "compute-node-tsh", both "C") fall back to a two-letter
  initial only when another cluster shares the same single-letter one (`lib/avatarColor.ts`).
- **The "orphan text" bug had a concrete cause.** `cluster.tags` has always rendered with
  `className="tags"`/`"tag"`, but no CSS rule for either class existed anywhere in the app - a tag
  showed as bare, unstyled inline text with no visual relation to the rest of the card. Fixed with
  a small pill rule in `shell.css`, matching the existing `.standby-badge`/`.session-badge` look.
