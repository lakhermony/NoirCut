import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, delimiter, join } from 'path'
import { parseCubeLut } from '../shared/lut'
import type { NoirCutProject } from '../shared/project'
import type { ExportRequest } from '../shared/timeline'
import { getEngineInfo, initEngine } from './engine/ffmpeg-engine'
import { cancelActiveExport, exportTimeline } from './export/export-service'
import {
  getPeaksForMedia,
  importFromDialog,
  importPaths,
  registerMediaProtocol,
  registerMediaScheme
} from './media/media-service'

// Özel protokol 'ready' öncesi kaydedilmek zorunda
registerMediaScheme()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#08080A',
    autoHideMenuBar: true,
    title: 'NoirCut',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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
  ipcMain.handle('export:run', (e, req: ExportRequest) =>
    exportTimeline(req, BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle('export:cancel', () => cancelActiveExport())
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

  ipcMain.handle('project:load', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'NoirCut Projesi Aç',
      properties: ['openFile'],
      filters: [{ name: 'NoirCut Projesi (.noircut)', extensions: ['noircut'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
    const filePath = res.filePaths[0]
    try {
      const raw = await readFile(filePath, 'utf-8')
      const project = JSON.parse(raw) as NoirCutProject
      if (!project || project.version !== 1 || !Array.isArray(project.clips)) {
        return { ok: false, error: 'Geçersiz .noircut proje dosyası.' }
      }
      const paths = (project.mediaRefs ?? []).map((r) => r.path).filter(Boolean)
      const imported = paths.length > 0 ? await importPaths(paths) : { items: [], errors: [] }
      return {
        ok: true,
        project,
        mediaItems: imported.items,
        mediaErrors: imported.errors,
        path: filePath
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  const win = createWindow()
  openStartupMedia(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
