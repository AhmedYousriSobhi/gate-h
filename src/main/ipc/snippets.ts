import { ipcMain } from 'electron'
import { listSnippets, removeSnippet, saveSnippet } from '../snippets'
import type { SnippetInput } from '../../shared/types'

export function registerSnippetIpcHandlers(): void {
  ipcMain.handle('snippets:list', () => listSnippets())
  ipcMain.handle('snippets:save', (_event, input: SnippetInput) => saveSnippet(input))
  ipcMain.handle('snippets:remove', (_event, id: string) => removeSnippet(id))
}
