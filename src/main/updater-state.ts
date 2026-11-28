import type { UpdateStatus } from '../shared/types'

export const UPDATER_SOURCE = {
  provider: 'github',
  owner: 'lakhermony',
  repo: 'NoirCut'
} as const

export const UPDATER_DEFAULT_CONFIG = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowDowngrade: false,
  allowPrerelease: false
} as const

export type UpdaterEvent =
  | { type: 'checking-for-update'; currentVersion: string; at?: string }
  | {
      type: 'update-available'
      currentVersion: string
      latestVersion: string
      releaseNotes?: string
      at?: string
    }
  | { type: 'update-not-available'; currentVersion: string; latestVersion?: string; at?: string }
  | { type: 'download-progress'; currentVersion: string; percent: number }
  | { type: 'update-downloaded'; currentVersion: string; latestVersion: string }
  | { type: 'error'; currentVersion: string; message: string; at?: string }

export function createInitialUpdaterState(currentVersion: string): UpdateStatus {
  return {
    state: 'idle',
    currentVersion
  }
}

export function reduceUpdaterState(prev: UpdateStatus, event: UpdaterEvent): UpdateStatus {
  const now = () => new Date().toISOString()
  switch (event.type) {
    case 'checking-for-update':
      return {
        state: 'checking',
        currentVersion: event.currentVersion,
        message: 'GitHub Releases üzerinden güncellemeler denetleniyor…',
        lastCheckedAt: event.at ?? now()
      }
    case 'update-available':
      return {
        state: 'available',
        currentVersion: event.currentVersion,
        latestVersion: event.latestVersion,
        releaseNotes: event.releaseNotes,
        message: `Yeni sürüm bulundu: NoirCut v${event.latestVersion}`,
        lastCheckedAt: event.at ?? now()
      }
    case 'update-not-available': {
      const remoteVer = event.latestVersion ?? event.currentVersion
      return {
        state: 'not-available',
        currentVersion: event.currentVersion,
        latestVersion: remoteVer,
        message: `NoirCut v${event.currentVersion} — En güncel sürümü kullanıyorsunuz (GitHub: v${remoteVer})`,
        lastCheckedAt: event.at ?? now()
      }
    }
    case 'download-progress': {
      const pct = Math.round(event.percent)
      return {
        ...prev,
        state: 'downloading',
        currentVersion: event.currentVersion,
        progress: event.percent,
        message: `Güncelleme indiriliyor… (%${pct})`
      }
    }
    case 'update-downloaded':
      return {
        ...prev,
        state: 'downloaded',
        currentVersion: event.currentVersion,
        latestVersion: event.latestVersion,
        progress: 100,
        message: `NoirCut v${event.latestVersion} indirildi ve kuruluma hazır.`
      }
    case 'error':
      return {
        state: 'error',
        currentVersion: event.currentVersion,
        message: `Güncelleme denetlenemedi: ${event.message}`,
        lastCheckedAt: event.at ?? now()
      }
  }
}

/**
 * Renderer'dan gelen updater:* IPC çağrılarının kaynak URL veya yapılandırma argümanı
 * geçirmesini engeller (yalnızca parametresiz tetiklemeye izin verilir).
 */
export function assertNoUpdaterArgs(args: unknown[]): void {
  if (args.length > 0) {
    throw new Error('updater IPC kanalları dış argüman veya kaynak URL kabul etmez')
  }
}
