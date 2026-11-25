import { contextBridge, ipcRenderer } from 'electron'
import type {
  MediaItem,
  NoirCutApi,
  ProxyUpdate,
  TranscribeProgress,
  UpdateStatus
} from '../shared/types'

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
  loadProject: () => ipcRenderer.invoke('project:load'),
  generateSoundscape: (presetId) => ipcRenderer.invoke('soundscape:generate', presetId),
  saveTextFile: (defaultName, content, filterName, extension) =>
    ipcRenderer.invoke('file:saveText', { defaultName, content, filterName, extension }),
  openLookFile: () => ipcRenderer.invoke('noirfilm:openLook'),
  loadProjectByPath: (filePath) => ipcRenderer.invoke('project:load-path', filePath),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdateStatus: (cb) => {
    const handler = (_e: unknown, status: UpdateStatus) => cb(status)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  selectExportPath: (format, defaultName) =>
    ipcRenderer.invoke('export:select-path', { format, defaultName }),
  writeAutosave: (project, label) => ipcRenderer.invoke('autosave:write', { project, label }),
  getAutosaveStatus: () => ipcRenderer.invoke('autosave:status'),
  restoreAutosave: (snapshotId) => ipcRenderer.invoke('autosave:restore', snapshotId),
  dismissAutosave: () => ipcRenderer.invoke('autosave:dismiss'),
  getProxyConfig: () => ipcRenderer.invoke('proxy:get-config'),
  setProxyConfig: (patch) => ipcRenderer.invoke('proxy:set-config', patch),
  selectProxyDir: () => ipcRenderer.invoke('proxy:select-dir'),
  generateBatchProxies: (mediaIds, scale) =>
    ipcRenderer.invoke('proxy:batch-generate', { mediaIds, scale }),
  reconnectMedia: (mediaId) => ipcRenderer.invoke('media:reconnect', mediaId),
  pauseExport: () => ipcRenderer.invoke('export:pause'),
  resumeExport: () => ipcRenderer.invoke('export:resume'),
  transcribeMedia: (mediaId, language) =>
    ipcRenderer.invoke('media:transcribe', { mediaId, language }),
  cancelTranscribe: () => ipcRenderer.invoke('media:transcribe-cancel'),
  onTranscribeProgress: (cb) => {
    const handler = (_e: unknown, p: TranscribeProgress) => cb(p)
    ipcRenderer.on('media:transcribe-progress', handler)
    return () => ipcRenderer.removeListener('media:transcribe-progress', handler)
  },
  archiveProject: (project) => ipcRenderer.invoke('project:archive', project),
  saveSnapshot: (dataUrl, defaultName) =>
    ipcRenderer.invoke('snapshot:save', { dataUrl, defaultName }),
  getLicenseInfo: () => ipcRenderer.invoke('app:licenses'),
  extractClipsMetadata: (mediaIds) => ipcRenderer.invoke('media:extract-metadata', mediaIds),
  detectSceneCuts: (mediaId, threshold) =>
    ipcRenderer.invoke('media:detect-scenes', { mediaId, threshold }),
  detectAudioTransients: (mediaId, sensitivity) =>
    ipcRenderer.invoke('media:detect-transients', { mediaId, sensitivity }),
  getHwEncoders: () => ipcRenderer.invoke('export:get-hw-encoders')
}

contextBridge.exposeInMainWorld('noircut', api)
