import { ipcMain } from './guard'
import { listTemplates, removeTemplate, saveTemplate } from '../templates'
import type { JobTemplateInput } from '../../shared/types'

export function registerTemplateIpcHandlers(): void {
  ipcMain.handle('templates:list', () => listTemplates())
  ipcMain.handle('templates:save', (_event, input: JobTemplateInput) => saveTemplate(input))
  ipcMain.handle('templates:remove', (_event, id: string) => removeTemplate(id))
}
