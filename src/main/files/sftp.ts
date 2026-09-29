import { basename } from 'path'
import { randomUUID } from 'crypto'
import type { Client, FileEntryWithStats, SFTPWrapper } from 'ssh2'
import { getCluster } from '../clusters'
import { getLiveClient } from '../ssh/manager'
import type { FileTransferEvent, RemoteDirectory, RemoteEntry } from '../../shared/types'

// File transfer over SFTP on the connection a cluster's terminal already holds - no new login,
// as with scheduler commands (../scheduler/exec.ts). One SFTP channel per connection, opened on
// first use and dropped when it closes. Local paths only ever come from native file dialogs in
// the main process (see ../ipc/files.ts), never from the renderer.

const channels = new WeakMap<Client, Promise<SFTPWrapper>>()

function openSftp(client: Client): Promise<SFTPWrapper> {
  const existing = channels.get(client)
  if (existing) return existing
  const opened = new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err)
      sftp.on('close', () => channels.delete(client))
      resolve(sftp)
    })
  })
  channels.set(client, opened)
  opened.catch(() => channels.delete(client))
  return opened
}

export function sftpFor(clusterId: string): Promise<SFTPWrapper> {
  const cluster = getCluster(clusterId)
  if (!cluster) return Promise.reject(new Error('Cluster not found'))
  if (cluster.teleport) {
    return Promise.reject(new Error("File transfer isn't available for Teleport clusters yet."))
  }
  const client = getLiveClient(clusterId)
  if (!client) return Promise.reject(new Error('Waiting for a terminal session.'))
  return openSftp(client)
}

function call<T>(fn: (cb: (err: Error | undefined | null, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))))
}

/** Joins onto an absolute remote directory; SFTP paths are always POSIX. */
export function remoteJoin(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** A directory's entries, folders first; `path` defaults to the remote home directory. */
export async function listDirectory(clusterId: string, path?: string): Promise<RemoteDirectory> {
  const sftp = await sftpFor(clusterId)
  const absolute = await call<string>((cb) => sftp.realpath(path || '.', cb))
  const list = await call<FileEntryWithStats[]>((cb) => sftp.readdir(absolute, cb))
  const entries: RemoteEntry[] = list
    .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
    .map((entry) => ({
      name: entry.filename,
      type: entry.attrs.isDirectory() ? 'dir' : entry.attrs.isSymbolicLink() ? 'link' : 'file',
      size: entry.attrs.size,
      modifiedAt: new Date(entry.attrs.mtime * 1000).toISOString()
    }))
  entries.sort(
    (a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name)
  )
  return { path: absolute, entries }
}

// Progress is reported at most this often per transfer, so a fast LAN copy doesn't flood IPC.
const PROGRESS_INTERVAL_MS = 200

export function transfer(
  clusterId: string,
  direction: 'download' | 'upload',
  remotePath: string,
  localPath: string,
  report: (event: FileTransferEvent) => void
): Promise<void> {
  const id = randomUUID()
  const name = basename(direction === 'download' ? remotePath : localPath)
  let last = 0
  const emit = (event: Partial<FileTransferEvent>): void =>
    report({ id, clusterId, direction, name, transferred: 0, total: 0, done: false, ...event })
  emit({})
  return sftpFor(clusterId)
    .then(
      (sftp) =>
        new Promise<void>((resolve, reject) => {
          const step = (transferred: number, _chunk: number, total: number): void => {
            if (Date.now() - last < PROGRESS_INTERVAL_MS) return
            last = Date.now()
            emit({ transferred, total })
          }
          const done = (err?: Error | null): void => (err ? reject(err) : resolve())
          if (direction === 'download') sftp.fastGet(remotePath, localPath, { step }, done)
          else sftp.fastPut(localPath, remotePath, { step }, done)
        })
    )
    .then(
      () => emit({ done: true }),
      (err: Error) => {
        emit({ done: true, error: err.message })
        throw err
      }
    )
}

export async function remoteExists(clusterId: string, path: string): Promise<boolean> {
  const sftp = await sftpFor(clusterId)
  return call((cb) => sftp.stat(path, cb)).then(
    () => true,
    () => false
  )
}
