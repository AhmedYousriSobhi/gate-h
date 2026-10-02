# Connecting Jira - and telling multiple clusters apart

This is a step-by-step guide to wiring a cluster's Jira project into Gate-H, and - since most
people running this have more than one cluster - how to make sure each cluster reliably shows
*its own* tickets instead of everyone's. It also covers where Confluence currently stands.

## 1. What you need first

- **Jira Cloud**: your Atlassian account email, plus an API token from
  `id.atlassian.com/manage-profile/security/api-tokens`. Prefer a *scoped* token (read/write only
  what Gate-H needs) if your Jira admin has scoped tokens enabled.
- **Jira Data Center / Server**: a Personal Access Token from your own Jira profile
  (`Profile → Personal Access Tokens`). Unlike Cloud scoped tokens, a Data Center PAT is always
  full-access - there's no scoping option on that side.
- Either way: the base URL of that Jira instance, and the project key your cluster's tickets live
  in (e.g. `HPC`).

## 2. Filling in the form

In **Add cluster** (or **Edit** on an existing one), tick **Jira** and fill in:

| Field | What goes here |
|---|---|
| Jira base URL | e.g. `https://yourorg.atlassian.net` (Cloud) or your Data Center's URL |
| Auth mode | Jira Cloud (email + API token) or Jira Data Center (PAT) |
| Account email | Cloud only - the account the API token belongs to |
| Default project key | The project this cluster's tickets live in, e.g. `HPC` |
| Default JQL filter | Optional - see section 3, this is the important one for multi-cluster setups |
| API token / PAT | Stored encrypted via the OS keychain, never shown again once saved |

Leaving **Default JQL filter** blank makes Gate-H fall back to
`project = "<project key>" ORDER BY updated DESC` - every ticket in that project, newest first.

## 3. The multi-cluster problem: hostnames don't work as a key

A single HPC cluster usually exposes several *different* hostnames - a login/head node you
actually SSH into, a range of compute node names (`cn[001-256]`, `gpu-a[01-16]`, ...), and a
scheduler controller (Slurm's `slurmctld` host, PBS's server host, etc.). Gate-H's SSH connection
profile only asks for one of these - the login node - because that's the only one it connects to
directly; compute nodes and the controller are normally reached indirectly, through the scheduler,
once you're already logged in.

None of those hostnames make a good cross-tool identifier:

- They differ completely from cluster to cluster, so there's no shared pattern to search on.
- Compute node ranges change over time as hardware is added/retired.
- Typing any of them into Jira by hand doesn't scale past a couple of clusters.

**The identifier that already exists and is stable is the cluster's own Gate-H name** - the one
you typed into the **Name** field, shown at the top of its sidebar row. The recommended pattern is
to reuse that name (normalized to something Jira-friendly) as a **label** or **component** on
every ticket that relates to that cluster, and to scope each cluster's **Default JQL filter** by
it. Gate-H helps with both ends of this:

- The **Default JQL filter** field now shows a live placeholder example built from the cluster's
  own name, e.g. for a cluster named "Frontier-Dev":
  ```
  project = HPC AND labels = "frontier-dev"
  ```
- When you file a ticket from the **Create ticket** box on a cluster's Status tab, Gate-H
  automatically adds a label matching that same slug to the new issue - so tickets created through
  the app already satisfy the JQL above without you tagging them by hand. (If your Jira project's
  create screen doesn't have a Labels field configured, the ticket is still created successfully,
  just without the label - add it manually in that case, or ask your Jira admin to add Labels to
  the create screen.)

You only need to apply the label yourself for tickets *not* filed through Gate-H (ones your team
files directly in Jira, or migrated from elsewhere).

## 4. JQL recipes for common setups

**All clusters share one Jira project, distinguished by label** (the recommended default):
```
project = HPC AND labels = "frontier-dev" ORDER BY updated DESC
```

**Distinguished by component instead of label** (if your team already organizes by component):
```
project = HPC AND component = "Frontier" ORDER BY updated DESC
```

**Each cluster has its own dedicated Jira project** - simplest case, leave the JQL field blank and
just set that cluster's **Default project key**.

**Only tickets still open** (hide resolved/closed noise):
```
project = HPC AND labels = "frontier-dev" AND statusCategory != Done ORDER BY updated DESC
```

**Tickets mentioning a specific compute node**: clicking a node in the Status tab's Slurm section
now runs this automatically (and offers a one-click "Create incident" if nothing matches), using
whichever project/JQL filter is already configured above:
```
project = HPC AND labels = "frontier-dev" AND text ~ "cn042"
```

## 5. Verifying it worked

Open the cluster's **Status** tab. The Jira section lists whatever your JQL (or the default
project-wide query) returns. If you see tickets from a *different* cluster in the list, that's the
"shared project, no label filter" gotcha from section 3 - add the label-scoped JQL and it'll narrow
down correctly.

## 6. Confluence: not integrated yet

Gate-H does not talk to Confluence today - there's no Confluence client, auth, or UI for it. If
you want a cluster's runbook/wiki page one click away in the meantime, the pragmatic workaround
that needs no code change is to paste the Confluence page URL into that cluster's **Description**
field in the Add/Edit form; it's plain text but at least keeps the link next to the cluster instead
of in a separate document.

Following the same identity pattern as above, a real Confluence integration would most naturally
work by searching Confluence for pages labeled with the cluster's slug (Confluence supports page
labels the same way Jira supports issue labels), rather than by any hostname. That's a real,
separate feature - not a small addition to the existing Jira client, since it needs its own
authentication and its own main-process client/IPC surface, mirroring how `src/main/jira/` and
`src/main/grafana/` were each built. Tracked as a possible next integration in
[docs/STATUS.md](./STATUS.md).
