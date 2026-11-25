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
  if (!app.isPackaged) return
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.info('[NoirCut Updater] GitHub Releases üzerinden güncelleme denetleniyor...')
    broadcast({
      state: 'checking',
      currentVersion: app.getVersion(),
      message: 'GitHub Releases üzerinden güncellemeler denetleniyor…',
      lastCheckedAt: new Date().toISOString()
    })
  })

  autoUpdater.on('update-available', (info) => {
    console.info(`[NoirCut Updater] Yeni sürüm bulundu: v${info.version}`)
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
    console.info(`[NoirCut Updater] Güncel sürüm kullanılıyor: v${v}`)
    broadcast({
      state: 'not-available',
      currentVersion: v,
      latestVersion: v,
      message: `NoirCut v${v} — En güncel sürümü kullanıyorsunuz`,
      lastCheckedAt: new Date().toISOString()
    })
  })

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent)
    if (pct === 0 || pct === 25 || pct === 50 || pct === 75 || pct === 100) {
      console.info(`[NoirCut Updater] İndiriliyor: %${pct}`)
    }
    broadcast({
      ...latestStatus,
      state: 'downloading',
      currentVersion: app.getVersion(),
      progress: p.percent,
      message: `Güncelleme indiriliyor… (%${pct})`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.info(`[NoirCut Updater] Güncelleme indirildi ve kuruluma hazır: v${info.version}`)
    broadcast({
      ...latestStatus,
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      progress: 100,
      message: `NoirCut v${info.version} indirildi ve kuruluma hazır.`
    })
  })

  autoUpdater.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[NoirCut Updater] Güncelleme hatası:', msg)
    broadcast({
      state: 'error',
      currentVersion: app.getVersion(),
      message: `Güncelleme denetlenemedi: ${msg}`,
      lastCheckedAt: new Date().toISOString()
    })
  })
}

export async function checkForAppUpdates(): Promise<UpdateStatus> {
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

  initAutoUpdater()

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[NoirCut Updater] checkForUpdates hatası:', msg)
    const errStatus: UpdateStatus = {
      state: 'error',
      currentVersion: v,
      message: `Güncelleme denetlenemedi: ${msg}`,
      lastCheckedAt: now
    }
    broadcast(errStatus)
    return errStatus
  }
}

export async function downloadAppUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Otomatik güncelleme yalnızca paketlenmiş uygulamada çalışır.' }
  }
  initAutoUpdater()
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[NoirCut Updater] downloadUpdate hatası:', msg)
    return { ok: false, error: msg }
  }
}

export function quitAndInstallAppUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
