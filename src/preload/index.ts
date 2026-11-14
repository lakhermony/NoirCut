import { contextBridge, ipcRenderer } from 'electron'
import type { MediaItem, NoirCutApi, ProxyUpdate } from '../shared/types'

const api: NoirCutApi = {
  getEngineInfo: () => ipcRenderer.invoke('engine:info'),
  importMedia: () => ipcRenderer.invoke('media:import'),
  onMediaOpened: (cb) => {
    const handler = (_e: unknown, items: MediaItem[]) => cb(items)
    ipcRenderer.on('media:opened', handler)
    return () => ipcRenderer.removeListener('media:opened', handler)
  },
  onProxyUpdate: (cb) => {
    const handler = (_e: unknown, u: ProxyUpdate) => cb(u)
    ipcRenderer.on('media:proxy-update', handler)
    return () => ipcRenderer.removeListener('media:proxy-update', handler)
  },
  getPeaks: (mediaId) => ipcRenderer.invoke('media:peaks', mediaId),
  exportProject: (req) => ipcRenderer.invoke('export:run', req),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => {
    const handler = (_e: unknown, percent: number) => cb(percent)
    ipcRenderer.on('export:progress', handler)
    return () => ipcRenderer.removeListener('export:progress', handler)
  },
  importLut: () => ipcRenderer.invoke('lut:import'),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  loadProject: () => ipcRenderer.invoke('project:load')
}

contextBridge.exposeInMainWorld('noircut', api)
