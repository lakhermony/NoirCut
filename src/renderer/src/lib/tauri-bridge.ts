/**
 * NoirCut Tauri v2 (Rust Backend) <-> Renderer IPC Köprüsü
 *
 * Uygulama Tauri v2 (Rust) penceresinde çalışırken (`window.__TAURI_INTERNALS__` mevcutken)
 * `window.noircut` nesnesini otomatik olarak Rust `invoke` ve `listen` komutlarına bağlar.
 * Böylece mevcut React + WebGL2 + NoirAudio arayüzü hiçbir kod değişikliği gerekmeden
 * doğrudan çok çekirdekli Rust backend üzerinde çalışır.
 */
import { parseCubeLut } from '../../../shared/lut'
import type { NoirCutProject } from '../../../shared/project'
import type { ExportRequest, NoirSoundscapeId } from '../../../shared/timeline'
import type {
  AutosaveStatus,
  EngineInfo,
  ExportResult,
  ImportResult,
  LutImportResult,
  MediaItem,
  NoirCutApi,
  PeaksResult,
  ProjectLoadResult,
  ProjectSaveResult,
  ProxyConfig,
  ProxyUpdate,
  UpdateStatus
} from '../../../shared/types'

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  transformCallback: (cb: (payload: unknown) => void, once?: boolean) => number
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
    __TAURI_EVENT_PLUGIN_INTERNALS__?: {
      unregisterListener?: (event: string, eventId: number) => void
    }
  }
}

function getTauri(): TauriInternals | null {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__?.invoke) {
    return window.__TAURI_INTERNALS__
  }
  return null
}

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const tauri = getTauri()
  if (!tauri) {
    throw new Error(`Tauri runtime bulunamadı (${cmd})`)
  }
  return tauri.invoke<T>(cmd, args)
}

function tauriListen<T>(event: string, handler: (payload: T) => void): () => void {
  const tauri = getTauri()
  if (!tauri) return () => {}

  let unlistenId: number | null = null
  let disposed = false

  const callbackId = tauri.transformCallback((raw: unknown) => {
    if (disposed) return
    const ev = raw as { payload?: T }
    if (ev && 'payload' in ev && ev.payload !== undefined) {
      handler(ev.payload)
    } else {
      handler(raw as T)
    }
  })

  tauri
    .invoke<number>('plugin:event|listen', {
      event,
      target: { kind: 'Any' },
      handler: callbackId
    })
    .then((id) => {
      unlistenId = id
      if (disposed && unlistenId !== null) {
        void tauri.invoke('plugin:event|unlisten', { event, eventId: unlistenId }).catch(() => {})
      }
    })
    .catch(() => {})

  return () => {
    disposed = true
    if (unlistenId !== null) {
      void tauri.invoke('plugin:event|unlisten', { event, eventId: unlistenId }).catch(() => {})
    }
  }
}

export function initTauriBridgeIfNeeded(): void {
  if (typeof window === 'undefined') return
  if (window.noircut) return // Electron preload zaten tanımlamışsa dokunma
  if (!getTauri()) return

  const api: NoirCutApi = {
    getEngineInfo: () => tauriInvoke<EngineInfo>('engine_info'),

    importMedia: () => tauriInvoke<ImportResult>('media_import'),

    onMediaOpened: (cb: (items: MediaItem[]) => void) =>
      tauriListen<MediaItem[]>('media:opened', cb),

    onProxyUpdate: (cb: (update: ProxyUpdate) => void) =>
      tauriListen<ProxyUpdate>('media:proxy-update', cb),

    getPeaks: async (mediaId: string): Promise<PeaksResult | null> => {
      const res = await tauriInvoke<{ peaks: number[]; perSecond: number } | null>('media_peaks', {
        mediaId
      })
      if (!res) return null
      return {
        peaks: res.peaks instanceof Uint8Array ? res.peaks : new Uint8Array(res.peaks),
        perSecond: res.perSecond
      }
    },

    exportProject: (req: ExportRequest) => tauriInvoke<ExportResult>('export_run', { req }),

    cancelExport: () => tauriInvoke<void>('export_cancel'),

    pauseExport: () => tauriInvoke<boolean>('export_pause'),

    resumeExport: () => tauriInvoke<boolean>('export_resume'),

    onExportProgress: (cb: (percent: number) => void) =>
      tauriListen<number>('export:progress', cb),

    importLut: async (): Promise<LutImportResult> => {
      const res = await tauriInvoke<{
        canceled?: boolean
        id?: string
        name?: string
        content?: string
        error?: string
      }>('lut_import')
      if (res.canceled) return { canceled: true }
      if (res.error) return { error: res.error }
      if (res.content && res.id && res.name) {
        try {
          const lut = parseCubeLut(res.content, res.id, res.name)
          return { lut }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      }
      return { canceled: true }
    },

    revealInFolder: (filePath: string) => tauriInvoke<void>('shell_reveal', { filePath }),

    saveProject: (project: NoirCutProject) =>
      tauriInvoke<ProjectSaveResult>('project_save', { project }),

    loadProject: () => tauriInvoke<ProjectLoadResult>('project_load'),

    loadProjectByPath: (filePath: string) =>
      tauriInvoke<ProjectLoadResult>('project_load_path', { filePath }),

    generateSoundscape: (presetId: NoirSoundscapeId) =>
      tauriInvoke<MediaItem | null>('soundscape_generate', { presetId }),

    saveTextFile: (defaultName: string, content: string, filterName: string, extension: string) =>
      tauriInvoke<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>(
        'file_save_text',
        { defaultName, content, filterName, extension }
      ),

    openLookFile: () =>
      tauriInvoke<{
        canceled?: boolean
        ext?: 'noirlook' | 'cube'
        name?: string
        content?: string
        error?: string
      }>('noirfilm_open_look'),

    checkForUpdates: () =>
      Promise.resolve({
        state: 'not-available',
        currentVersion: '1.0.5',
        message: 'NoirCut v1.0.5 (Rust / Tauri v2 Engine) — En güncel sürüm'
      }),

    downloadUpdate: () =>
      Promise.resolve({
        ok: true
      }),

    quitAndInstallUpdate: () => Promise.resolve(),

    onUpdateStatus: (cb: (status: UpdateStatus) => void) =>
      tauriListen<UpdateStatus>('updater:status', cb),

    getAppVersion: () => tauriInvoke<string>('app_version'),

    selectExportPath: (format: 'mp4' | 'mov', defaultName?: string) =>
      tauriInvoke<string | null>('export_select_path', { format, defaultName }),

    writeAutosave: (project: NoirCutProject, label?: string) =>
      tauriInvoke<{ ok: boolean }>('autosave_write', { project, label }),

    getAutosaveStatus: () => tauriInvoke<AutosaveStatus>('autosave_status'),

    restoreAutosave: (snapshotId: string) =>
      tauriInvoke<ProjectLoadResult>('autosave_restore', { snapshotId }),

    dismissAutosave: () => tauriInvoke<void>('autosave_dismiss'),

    getProxyConfig: () => tauriInvoke<ProxyConfig>('proxy_get_config'),

    setProxyConfig: (patch: Partial<ProxyConfig>) =>
      tauriInvoke<ProxyConfig>('proxy_set_config', { patch }),

    selectProxyDir: () => tauriInvoke<string | null>('proxy_select_dir'),

    generateBatchProxies: (mediaIds?: string[], scale?: '1/2' | '1/4' | '1/8') =>
      tauriInvoke<{ started: number }>('proxy_batch_generate', { mediaIds, scale }),

    reconnectMedia: (mediaId: string) =>
      tauriInvoke<MediaItem | null>('media_reconnect', { mediaId })
  }

  window.noircut = api
}
