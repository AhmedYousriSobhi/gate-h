import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import type { SshConfigCandidate } from '../shared/types'

// Reads ~/.ssh/config (and its Include files) into a list of candidate clusters, so setting one
// up in Gate-H doesn't mean retyping host/user/port/key that's already sitting in a config file
// most of this app's audience already has. Read-only: nothing here ever writes to ~/.ssh.

const DIRECTIVE_PATTERN = /^(\S+)\s+(.*)$/

function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path
}

/** Minimal `*` glob (the only wildcard real-world `Include` lines actually use) - matches
 *  filenames in `dir` against `pattern`, both taken from the already-split glob segment. */
function globFiles(dir: string, pattern: string): string[] {
  if (!existsSync(dir)) return []
  if (!pattern.includes('*')) {
    const full = join(dir, pattern)
    return existsSync(full) && statSync(full).isFile() ? [full] : []
  }
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
  return readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => join(dir, name))
    .filter((full) => statSync(full).isFile())
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** Reads one config file's lines, following `Include` directives inline (depth-limited against a
 *  cycle) - the same flattening ssh(1) itself does before evaluating `Host` blocks. */
function readLines(path: string, depth = 0): string[] {
  if (depth > 5 || !existsSync(path)) return []
  const lines: string[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = DIRECTIVE_PATTERN.exec(line)
    if (match && match[1].toLowerCase() === 'include') {
      const dir = dirname(path)
      for (const part of match[2].split(/\s+/)) {
        const expanded = expandHome(part)
        const abs = expanded.startsWith('/') ? expanded : resolve(dir, expanded)
        for (const file of globFiles(dirname(abs), abs.slice(dirname(abs).length + 1))) {
          lines.push(...readLines(file, depth + 1))
        }
      }
      continue
    }
    lines.push(line)
  }
  return lines
}

interface HostBlock {
  alias: string
  hostName?: string
  user?: string
  port?: string
  identityFile?: string
  proxyJump?: string
  proxyCommand?: string
}

/** Splits a `Host` line's value into alias tokens - a quoted, space-containing alias ("My Host")
 *  is one token, not two, the same as ssh_config's own tokenizing. */
function splitAliases(value: string): string[] {
  const tokens = value.match(/"[^"]*"|\S+/g) ?? []
  return tokens.map((t) => t.replace(/^"(.*)"$/, '$1'))
}

function parseBlocks(lines: string[]): HostBlock[] {
  const blocks: HostBlock[] = []
  // One `Host` line can list several aliases/patterns at once; they all receive the same
  // following directives (ssh_config's own matching model), so every alias in the line needs its
  // own block but all of them updated together - not just the last one parsed.
  let current: HostBlock[] = []
  for (const line of lines) {
    const match = DIRECTIVE_PATTERN.exec(line)
    if (!match) continue
    const [, keyRaw, valueRaw] = match
    const key = keyRaw.toLowerCase()
    // A bare value may be quoted ("My Host") - only the outer quotes are stripped, matching how
    // ssh_config treats a single quoted token.
    const value = valueRaw.trim().replace(/^"(.*)"$/, '$1')
    if (key === 'host') {
      current = splitAliases(valueRaw.trim()).map((alias) => ({ alias }))
      blocks.push(...current)
      continue
    }
    for (const block of current) {
      if (key === 'hostname') block.hostName = value
      else if (key === 'user') block.user = value
      else if (key === 'port') block.port = value
      else if (key === 'identityfile') block.identityFile = value
      else if (key === 'proxyjump') block.proxyJump = value
      else if (key === 'proxycommand') block.proxyCommand = value
    }
  }
  return blocks
}

/** Enabled subscriptions have nothing to do with this file - the name is generic on purpose: a
 *  pattern with `*`/`?` matches a family of hosts, not one real machine, so it can't become a
 *  single cluster. */
function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !alias.includes('*') && !alias.includes('?')
}

export function importFromSshConfig(): SshConfigCandidate[] {
  const path = join(homedir(), '.ssh', 'config')
  const blocks = parseBlocks(readLines(path))
  const seen = new Set<string>()
  const candidates: SshConfigCandidate[] = []
  for (const block of blocks) {
    if (!isConcreteAlias(block.alias) || seen.has(block.alias)) continue
    seen.add(block.alias)
    const port = Number(block.port)
    candidates.push({
      name: block.alias,
      host: block.hostName ?? block.alias,
      port: Number.isInteger(port) && port > 0 ? port : 22,
      username: block.user,
      privateKeyPath: block.identityFile,
      hasProxy: Boolean(block.proxyJump || block.proxyCommand)
    })
  }
  return candidates
}
