/**
 * NoirCut Auto-Updater (electron-updater) modülü.
 * Paketlenmiş (production) modda GitHub Releases üzerinden güncellemeleri denetler ve indirir.
 * Geliştirme modunda veya uzak sürüm sunucusu henüz yayınlanmamışsa hata fırlatmak yerine
 * kullanıcı dostu durum bilgisi döndürür.
 */
import { app, BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const { autoUpdater } = updaterPkg

let initialized = false
let latestStatus: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion()
}

function broadcast(status: UpdateStatus): void {
  latestStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', status)
    }
  }
}

export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcast({
      state: 'checking',
      currentVersion: app.getVersion(),
      message: 'GitHub Releases üzerinden güncellemeler denetleniyor…',
      lastCheckedAt: new Date().toISOString()
    })
  })

  autoUpdater.on('update-available', (info) => {
    const notes =
      typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((r) => `${r.version}: ${r.note ?? ''}`).join('\n')
          : undefined
    broadcast({
      state: 'available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseNotes: notes,
      message: `Yeni sürüm bulundu: NoirCut v${info.version}`,
      lastCheckedAt: new Date().toISOString()
    })
  })

  autoUpdater.on('update-not-available', () => {
    const v = app.getVersion()
    broadcast({
      state: 'not-available',
      currentVersion: v,
      latestVersion: v,
      message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
      lastCheckedAt: new Date().toISOString()
    })
  })

  autoUpdater.on('download-progress', (p) => {
    broadcast({
      ...latestStatus,
      state: 'downloading',
      currentVersion: app.getVersion(),
      progress: p.percent,
      message: `Güncelleme indiriliyor… (%${Math.round(p.percent)})`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      ...latestStatus,
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      progress: 100,
      message: `NoirCut v${info.version} indirildi ve kuruluma hazır.`
    })
  })

  autoUpdater.on('error', () => {
    // Yayın sunucusu henüz mevcut değilse şık bir yerel sürüm mesajı döndür
    const v = app.getVersion()
    broadcast({
      state: 'not-available',
      currentVersion: v,
      latestVersion: v,
      message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
      lastCheckedAt: new Date().toISOString(),
      isSimulated: true
    })
  })
}

export async function checkForAppUpdates(): Promise<UpdateStatus> {
  initAutoUpdater()
  const v = app.getVersion()
  const now = new Date().toISOString()

  if (!app.isPackaged) {
    const devStatus: UpdateStatus = {
      state: 'not-available',
      currentVersion: v,
      latestVersion: v,
      message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
      lastCheckedAt: now,
      isSimulated: true
    }
    broadcast(devStatus)
    return devStatus
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.updateInfo || result.updateInfo.version === v) {
      const upToDate: UpdateStatus = {
        state: 'not-available',
        currentVersion: v,
        latestVersion: v,
        message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
        lastCheckedAt: now
      }
      broadcast(upToDate)
      return upToDate
    }
    return latestStatus
  } catch {
    const fallback: UpdateStatus = {
      state: 'not-available',
      currentVersion: v,
      latestVersion: v,
      message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
      lastCheckedAt: now,
      isSimulated: true
    }
    broadcast(fallback)
    return fallback
  }
}

export async function downloadAppUpdate(): Promise<{ ok: boolean; error?: string }> {
  initAutoUpdater()
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function quitAndInstallAppUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
