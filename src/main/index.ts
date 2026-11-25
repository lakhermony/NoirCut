import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { parseCubeLut } from '../shared/lut'
import type { NoirCutProject } from '../shared/project'
import type { ExportRequest, NoirSoundscapeId } from '../shared/timeline'
import { getEngineInfo, initEngine } from './engine/ffmpeg-engine'
import {
  cancelActiveExport,
  exportTimeline,
  pauseActiveExport,
  resumeActiveExport
} from './export/export-service'
import { probeHardwareEncoders } from './export/hw-probe'
import {
  ensureSoundscapeItemSync,
  generateBatchProxies,
  getMediaItem,
  getPeaksForMedia,
  getProxyConfig,
  importFromDialog,
  importPaths,
  reconnectMediaItem,
  registerMediaProtocol,
  registerMediaScheme,
  selectProxyDirectory,
  setProxyConfig
} from './media/media-service'
import {
  dismissAutosaveRecovery,
  getAutosaveStatus,
  markCleanExitSync,
  readAutosaveSnapshot,
  writeAutosaveSnapshot
} from './project-backup'
import {
  checkForAppUpdates,
  downloadAppUpdate,
  initAutoUpdater,
  quitAndInstallAppUpdate
} from './updater'
import { cancelActiveTranscription, transcribeMediaFile } from './transcribe/transcribe-service'
import {
  detectAudioTransients,
  detectSceneCuts,
  extractClipsMetadata
} from './media/media-analysis'

// Özel protokol 'ready' öncesi kaydedilmek zorunda
registerMediaScheme()
if (process.platform === 'win32') {
  app.setAppUserModelId('com.noircut.studio')
}

// NVIDIA / Linux Donanım Video Çözme (Hardware Video Decode) ve AppImage Sandbox Uyumluluğu
if (process.platform === 'linux' && process.env['APPIMAGE']) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
if (!process.env['NOIRCUT_SAFE_GPU']) {
  app.commandLine.appendSwitch('enable-zero-copy')
}
app.commandLine.appendSwitch(
  'enable-features',
  'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,UseChromeOSDirectVideoDecoder'
)

function resolveWindowIcon() {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../../build/icon.png'),
    resolve(process.cwd(), 'resources', 'icon.png'),
    resolve(process.cwd(), 'build', 'icon.png')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return undefined
}

function createWindow(): BrowserWindow {
  const icon = resolveWindowIcon()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#08080A',
    autoHideMenuBar: true,
    title: 'NoirCut',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Preload yalnızca contextBridge ve ipcRenderer kullanır; Node API gerekmediği için sandbox etkindir
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Sürükle-bırak ile dosya açıldığında uygulamanın başka sayfaya gitmesini engelle
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://') && url.endsWith('index.html')) return
    e.preventDefault()
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[NoirCut] render-process-gone:', details)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** NOIRCUT_OPEN=dosya1.mp4:dosya2.mkv ile başlatılırsa bu dosyalar açılışta içe aktarılır. */
function openStartupMedia(win: BrowserWindow): void {
  const raw = process.env['NOIRCUT_OPEN']
  if (!raw) return
  const paths = raw.split(delimiter).filter(Boolean)
  win.webContents.once('did-finish-load', async () => {
    const { items } = await importPaths(paths)
    win.webContents.send('media:opened', items)
  })
}

app.on('child-process-gone', (_e, details) => {
  console.error('[NoirCut] child-process-gone:', details)
})

app.whenReady().then(async () => {
  await initEngine()
  registerMediaProtocol()

  ipcMain.handle('engine:info', () => getEngineInfo())
  ipcMain.handle('media:import', (e) => importFromDialog(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('media:peaks', (_e, mediaId: string) => getPeaksForMedia(mediaId))
  ipcMain.handle('soundscape:generate', (_e, presetId: NoirSoundscapeId) =>
    ensureSoundscapeItemSync(presetId)
  )
  ipcMain.handle('export:run', (e, req: ExportRequest) =>
    exportTimeline(req, BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle('export:cancel', () => cancelActiveExport())
  ipcMain.handle('export:pause', () => pauseActiveExport())
  ipcMain.handle('export:resume', () => resumeActiveExport())
  ipcMain.handle('export:get-hw-encoders', () => probeHardwareEncoders())
  ipcMain.handle('proxy:get-config', () => getProxyConfig())
  ipcMain.handle('proxy:set-config', (_e, patch) => setProxyConfig(patch))
  ipcMain.handle('proxy:select-dir', (e) =>
    selectProxyDirectory(BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle(
    'proxy:batch-generate',
    (_e, args: { mediaIds?: string[]; scale?: '1/2' | '1/4' | '1/8' }) =>
      generateBatchProxies(args?.mediaIds, args?.scale)
  )
  ipcMain.handle('media:reconnect', (e, mediaId: string) =>
    reconnectMediaItem(mediaId, BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle('media:extract-metadata', async (_e, mediaIds: string[]) => {
    if (!Array.isArray(mediaIds)) return []
    return extractClipsMetadata(mediaIds)
  })
  ipcMain.handle(
    'media:detect-scenes',
    async (_e, args: { mediaId: string; threshold?: number }) => {
      if (!args || typeof args.mediaId !== 'string') {
        return { ok: false, timestamps: [], error: 'Geçersiz mediaId.' }
      }
      return detectSceneCuts(args.mediaId, args.threshold)
    }
  )
  ipcMain.handle(
    'media:detect-transients',
    async (_e, args: { mediaId: string; sensitivity?: number }) => {
      if (!args || typeof args.mediaId !== 'string') {
        return { ok: false, timestamps: [], error: 'Geçersiz mediaId.' }
      }
      return detectAudioTransients(args.mediaId, args.sensitivity)
    }
  )
  ipcMain.handle('media:transcribe', async (e, args: { mediaId: string; language: string }) => {
    if (!args || typeof args.mediaId !== 'string' || !args.mediaId.trim()) {
      return { ok: false, engineMissing: false, error: 'Geçersiz medya kimliği' }
    }
    const language = typeof args.language === 'string' ? args.language : 'auto'
    const info = await getEngineInfo()
    const item = getMediaItem(args.mediaId)
    if (!item?.path || !existsSync(item.path)) {
      return { ok: false, engineMissing: false, error: 'Medya öğesi bulunamadı' }
    }
    return transcribeMediaFile({
      ffmpegPath: info.ffmpegPath,
      mediaPath: item.path,
      language,
      onProgress: (progress) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send('media:transcribe-progress', progress)
        }
      }
    })
  })

  ipcMain.handle('media:transcribe-cancel', () => cancelActiveTranscription())

  ipcMain.handle('project:archive', async (e, project: NoirCutProject) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      return { ok: false, error: 'Geçersiz proje verisi' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Proje Arşiv Klasörü Seç (Consolidate)',
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const rawRefPath =
        typeof project.mediaRefs?.[0]?.path === 'string' ? project.mediaRefs[0].path : ''
      const safeName =
        basename(rawRefPath || 'NoirCut-Project').replace(/[^a-zA-Z0-9_-]/g, '_') ||
        'NoirCut-Project'
      const archiveDir = join(res.filePaths[0], `${safeName}-Archive-${Math.floor(Date.now() / 1000)}`)
      const mediaDir = resolve(archiveDir, 'media')
      await mkdir(mediaDir, { recursive: true })
      const cloned: NoirCutProject = JSON.parse(JSON.stringify(project))
      const used = new Set<string>()
      let copiedFiles = 0
      for (const r of cloned.mediaRefs ?? []) {
        if (!r || typeof r.path !== 'string' || !isAbsolute(r.path) || !existsSync(r.path)) continue
        const orig = basename(r.path)
        if (!orig || orig === '.' || orig === '..') continue
        let destName = orig
        let n = 1
        while (used.has(destName)) {
          destName = `${n}_${orig}`
          n++
        }
        const destPath = resolve(mediaDir, destName)
        if (!destPath.startsWith(mediaDir + (process.platform === 'win32' ? '\\' : '/'))) continue
        used.add(destName)
        await copyFile(r.path, destPath)
        r.path = `./media/${destName}`
        copiedFiles++
      }
      await writeFile(join(archiveDir, 'project.noircut'), JSON.stringify(cloned, null, 2), 'utf-8')
      return { ok: true, dirPath: archiveDir, copiedFiles }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'snapshot:save',
    async (e, args: { dataUrl: string; defaultName: string }) => {
      if (!args || typeof args.dataUrl !== 'string' || !args.dataUrl.startsWith('data:image/png;base64,')) {
        return { ok: false, error: 'Geçersiz PNG veri URL\'si' }
      }
      const rawName = typeof args.defaultName === 'string' && args.defaultName.trim()
        ? args.defaultName.trim()
        : 'noircut-snapshot.png'
      const safeDefaultName =
        basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'noircut-snapshot.png'
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts: Electron.SaveDialogOptions = {
        title: 'Kare Anlık Görüntüsü Kaydet (PNG)',
        defaultPath: safeDefaultName,
        filters: [{ name: 'PNG Görsel', extensions: ['png'] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        const b64 = args.dataUrl.slice('data:image/png;base64,'.length)
        await writeFile(res.filePath, Buffer.from(b64, 'base64'))
        return { ok: true, path: res.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
  ipcMain.handle('lut:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: '3D LUT Dosyası Seç (.cube)',
      properties: ['openFile'],
      filters: [{ name: '3D LUT (.cube)', extensions: ['cube'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const filePath = res.filePaths[0]
    try {
      const text = await readFile(filePath, 'utf-8')
      const rawName = basename(filePath, '.cube')
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const lut = parseCubeLut(text, id, rawName)
      return { lut }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('shell:reveal', (_e, filePath: string) => {
    if (filePath) shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'file:saveText',
    async (
      e,
      args: { defaultName: string; content: string; filterName: string; extension: string }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts: Electron.SaveDialogOptions = {
        title: `${args.filterName} Dışa Aktar`,
        defaultPath: args.defaultName,
        filters: [{ name: args.filterName, extensions: [args.extension] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        const suffix = `.${args.extension}`
        const target = res.filePath.endsWith(suffix) ? res.filePath : `${res.filePath}${suffix}`
        await writeFile(target, args.content, 'utf-8')
        return { ok: true, path: target }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('noirfilm:openLook', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Noir Look veya 3D LUT İçe Aktar',
      properties: ['openFile'],
      filters: [{ name: 'Noir Look / 3D LUT', extensions: ['noirlook', 'cube'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const filePath = res.filePaths[0]
    try {
      const content = await readFile(filePath, 'utf-8')
      const lower = filePath.toLowerCase()
      const ext = lower.endsWith('.cube') ? 'cube' : 'noirlook'
      const name = basename(filePath).replace(/\.(noirlook|cube)$/i, '')
      return { ext, name, content }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('project:save', async (e, project: NoirCutProject) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = {
      title: 'NoirCut Projesini Kaydet',
      defaultPath: 'Proje.noircut',
      filters: [{ name: 'NoirCut Projesi (.noircut)', extensions: ['noircut'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      const target = res.filePath.endsWith('.noircut') ? res.filePath : `${res.filePath}.noircut`
      await writeFile(target, JSON.stringify(project, null, 2), 'utf-8')
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  async function hydrateProject(project: NoirCutProject, filePath?: string) {
    if (!project || project.version !== 1 || !Array.isArray(project.clips)) {
      return { ok: false, error: 'Geçersiz .noircut proje dosyası.' }
    }
    const regularPaths: string[] = []
    const sfxItems = []
    const baseDir = filePath ? dirname(filePath) : process.cwd()
    for (const r of project.mediaRefs ?? []) {
      if (r.id.startsWith('sfx-')) {
        const presetId = r.id.slice(4) as NoirSoundscapeId
        sfxItems.push(ensureSoundscapeItemSync(presetId))
      } else if (r.path) {
        regularPaths.push(isAbsolute(r.path) ? r.path : resolve(baseDir, r.path))
      }
    }
    const imported =
      regularPaths.length > 0 ? await importPaths(regularPaths) : { items: [], errors: [] }
    return {
      ok: true,
      project,
      mediaItems: [...imported.items, ...sfxItems],
      mediaErrors: imported.errors,
      path: filePath
    }
  }

  async function loadProjectFromPath(filePath: string) {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const project = JSON.parse(raw) as NoirCutProject
      return await hydrateProject(project, filePath)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle('project:load', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'NoirCut Projesi Aç',
      properties: ['openFile'],
      filters: [{ name: 'NoirCut Projesi (.noircut)', extensions: ['noircut'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
    return loadProjectFromPath(res.filePaths[0])
  })

  ipcMain.handle('project:load-path', async (_e, filePath: string) => {
    if (!filePath) return { ok: false, error: 'Geçersiz proje yolu.' }
    return loadProjectFromPath(filePath)
  })

  ipcMain.handle(
    'export:select-path',
    async (e, args: { format: 'mp4' | 'mov'; defaultName?: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const ext = args.format === 'mov' ? 'mov' : 'mp4'
      const opts: Electron.SaveDialogOptions = {
        title: `Render Hedefi Seç (${ext.toUpperCase()})`,
        defaultPath: args.defaultName || `NoirCut-Export.${ext}`,
        filters: [
          ext === 'mov'
            ? { name: 'QuickTime Movie (MOV)', extensions: ['mov'] }
            : { name: 'MP4 Video', extensions: ['mp4'] }
        ]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      return res.filePath.toLowerCase().endsWith(`.${ext}`)
        ? res.filePath
        : `${res.filePath}.${ext}`
    }
  )

  ipcMain.handle('autosave:write', async (_e, args: { project: NoirCutProject; label?: string }) => {
    const r = await writeAutosaveSnapshot(args.project, args.label)
    return { ok: r.ok }
  })
  ipcMain.handle('autosave:status', () => getAutosaveStatus())
  ipcMain.handle('autosave:restore', async (_e, snapshotId: string) => {
    const proj = await readAutosaveSnapshot(snapshotId)
    if (!proj) return { ok: false, error: 'Otomatik yedek bulunamadı veya bozuk.' }
    const res = await hydrateProject(proj)
    await dismissAutosaveRecovery()
    return res
  })
  ipcMain.handle('autosave:dismiss', () => dismissAutosaveRecovery())

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:licenses', async () => {
    const baseDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
    const readDoc = async (filename: string, fallback: string): Promise<string> => {
      const candidates = [join(baseDir, filename), join(process.cwd(), filename)]
      for (const p of candidates) {
        if (existsSync(p)) {
          try {
            return await readFile(p, 'utf-8')
          } catch {
            // sonraki adayı dene
          }
        }
      }
      return fallback
    }
    const [gplText, thirdPartyText] = await Promise.all([
      readDoc('LICENSE', 'LICENSE dosyası bulunamadı. https://www.gnu.org/licenses/gpl-3.0.txt'),
      readDoc(
        'THIRD-PARTY-LICENSES.txt',
        'THIRD-PARTY-LICENSES.txt dosyası henüz üretilmemiş. "npm run licenses:generate" komutunu çalıştırın.'
      )
    ])
    return { gplText, thirdPartyText }
  })
  ipcMain.handle('updater:check', () => checkForAppUpdates())
  ipcMain.handle('updater:download', () => downloadAppUpdate())
  ipcMain.handle('updater:quit-and-install', () => quitAndInstallAppUpdate())

  initAutoUpdater()
  const win = createWindow()
  openStartupMedia(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  markCleanExitSync()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
