/**
 * Medya servisi: dosya seçici, medya kaydı, güvenli oynatma protokolü,
 * ses dalgası (peaks) önbelleği ve HEVC/ProRes vb. için otomatik Proxy üretimi.
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { app, BrowserWindow, dialog, protocol } from 'electron'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, extname, join, resolve } from 'path'
import { synthesizeNoirSoundscapeWav } from '../../shared/foley-wav'
import { NOIR_SOUNDSCAPE_PRESETS, type NoirSoundscapeId } from '../../shared/timeline'
import type { ImportResult, MediaItem, PeaksResult, ProxyConfig, ProxyUpdate } from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { extractPeaks, makeThumbnail, probeMedia, type ProbeResult } from './media-probe'

export const MEDIA_SCHEME = 'noircut-media'
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm']
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a']
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

const NATIVE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora'])
const NATIVE_AUDIO_CODECS = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_f32le',
  'pcm_u8'
])

/** Kullanıcının seçtiği dosyalar ve üretilen proxy dosyaları */
const approvedPaths = new Set<string>()
const mediaRegistry = new Map<string, MediaItem>()
const peaksCache = new Map<string, Promise<PeaksResult>>()
const proxyJobs = new Map<string, Promise<void>>()

/** app 'ready' olmadan ÖNCE çağrılmalı. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

function nodeStreamToWeb(filePath: string, start: number, end: number): ReadableStream<Uint8Array> {
  const rs = createReadStream(filePath, { start, end })
  let closed = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      rs.on('data', (chunk: Buffer | string) => {
        if (closed) return
        try {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        } catch {
          closed = true
          rs.destroy()
        }
      })
      rs.on('end', () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // akış zaten kapalı
        }
      })
      rs.on('error', (err) => {
        if (closed) return
        closed = true
        try {
          controller.error(err)
        } catch {
          // akış zaten kapalı
        }
      })
    },
    cancel() {
      closed = true
      rs.destroy()
    }
  })
}

/** app 'ready' olduktan sonra çağrılmalı (HTTP 206 Byte-Range destekli medya sunucusu). */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = resolve(decodeURIComponent(url.pathname.slice(1)))
    if (!approvedPaths.has(filePath)) return new Response('Forbidden', { status: 403 })

    let fileSize = 0
    try {
      const st = await stat(filePath)
      fileSize = st.size
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const contentType = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const baseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType
    }

    if (fileSize === 0) {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': '0' }
      })
    }

    const rangeHeader = request.headers.get('range') ?? request.headers.get('Range')
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
      if (!m) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` }
        })
      }
      let start = m[1] ? Number(m[1]) : NaN
      let end = m[2] ? Number(m[2]) : NaN
      if (Number.isNaN(start) && !Number.isNaN(end)) {
        // bytes=-suffix
        start = Math.max(0, fileSize - end)
        end = fileSize - 1
      } else {
        if (Number.isNaN(start)) start = 0
        if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1
      }
      if (start < 0 || start >= fileSize || end < start) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` }
        })
      }
      const chunkLength = end - start + 1
      const headers = {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': String(chunkLength)
      }
      if (request.method === 'HEAD') {
        return new Response(null, { status: 206, headers })
      }
      return new Response(nodeStreamToWeb(filePath, start, end), {
        status: 206,
        headers
      })
    }

    const headers = {
      ...baseHeaders,
      'Content-Length': String(fileSize)
    }
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }
    return new Response(nodeStreamToWeb(filePath, 0, fileSize - 1), {
      status: 200,
      headers
    })
  })
}

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(filePath)}`
}

export function getMediaItem(id: string): MediaItem | undefined {
  const existing = mediaRegistry.get(id)
  if (existing && existsSync(existing.path)) return existing
  if (id.startsWith('sfx-')) {
    const presetId = id.slice(4) as NoirSoundscapeId
    if (NOIR_SOUNDSCAPE_PRESETS.some((p) => p.id === presetId)) {
      return ensureSoundscapeItemSync(presetId)
    }
  }
  return existing
}

export function ensureSoundscapeItemSync(presetId: NoirSoundscapeId): MediaItem {
  const id = `sfx-${presetId}`
  const sfxDir = join(tmpdir(), 'noircut-soundscape')
  mkdirSync(sfxDir, { recursive: true })
  const outPath = resolve(join(sfxDir, `${id}.wav`))
  const { wav, peaks, duration, label } = synthesizeNoirSoundscapeWav(presetId, 48000)
  if (!existsSync(outPath)) {
    writeFileSync(outPath, wav)
  }
  approvedPaths.add(outPath)
  const item: MediaItem = {
    id,
    path: outPath,
    name: `SFX · ${label}`,
    mediaKind: 'audio',
    duration,
    width: 0,
    height: 0,
    codec: 'none',
    fps: 24,
    hasAudio: true,
    audioCodec: 'pcm_s16le',
    thumbnail: null,
    url: mediaUrl(outPath),
    needsProxy: false,
    proxyState: 'none',
    proxyProgress: 1,
    proxyUrl: null
  }
  mediaRegistry.set(id, item)
  peaksCache.set(id, Promise.resolve({ peaks, perSecond: 50 }))
  return item
}

function broadcastProxyUpdate(update: ProxyUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('media:proxy-update', update)
    }
  }
}

let customProxyDir: string | null = null
let proxyResolutionScale: '1/2' | '1/4' | '1/8' = '1/2'
let proxyPlaybackMode: 'auto' | 'proxy' | 'original' = 'auto'

function getProxyCacheDir(): string {
  if (customProxyDir && existsSync(customProxyDir)) return customProxyDir
  try {
    return join(app.getPath('userData'), 'proxy-cache')
  } catch {
    return join(tmpdir(), 'noircut-proxies')
  }
}

export function getProxyConfig(): ProxyConfig {
  return {
    resolutionScale: proxyResolutionScale,
    playbackMode: proxyPlaybackMode,
    proxyDir: getProxyCacheDir()
  }
}

export function setProxyConfig(patch: Partial<ProxyConfig>): ProxyConfig {
  if (patch.resolutionScale) proxyResolutionScale = patch.resolutionScale
  if (patch.playbackMode) proxyPlaybackMode = patch.playbackMode
  if (patch.proxyDir) {
    try {
      mkdirSync(patch.proxyDir, { recursive: true })
      customProxyDir = resolve(patch.proxyDir)
    } catch {
      // yoksay
    }
  }
  return getProxyConfig()
}

export async function selectProxyDirectory(win: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Proxy Önbellek Klasörü Seç',
    defaultPath: getProxyCacheDir(),
    properties: ['openDirectory', 'createDirectory']
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return null
  setProxyConfig({ proxyDir: res.filePaths[0] })
  return getProxyCacheDir()
}

export async function generateBatchProxies(
  mediaIds?: string[],
  scale?: '1/2' | '1/4' | '1/8'
): Promise<{ started: number }> {
  if (scale) proxyResolutionScale = scale
  const targets =
    mediaIds && mediaIds.length > 0
      ? mediaIds.map((id) => mediaRegistry.get(id)).filter((m): m is MediaItem => Boolean(m))
      : Array.from(mediaRegistry.values()).filter((m) => m.mediaKind === 'video')
  let started = 0
  for (const item of targets) {
    if (item.mediaKind !== 'video') continue
    started++
    void startProxyGeneration(item, proxyResolutionScale, true)
  }
  return { started }
}

export async function reconnectMediaItem(
  mediaId: string,
  win: BrowserWindow | null
): Promise<MediaItem | null> {
  const existing = mediaRegistry.get(mediaId)
  if (!existing) return null
  if (existsSync(existing.path)) return existing
  const opts: Electron.OpenDialogOptions = {
    title: `Eksik Medyayı Yeniden Bağla: ${existing.name}`,
    properties: ['openFile'],
    filters: [
      {
        name: 'Tüm Desteklenen Medya',
        extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]
      }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return null
  const newPath = resolve(res.filePaths[0])
  approvedPaths.add(newPath)
  existing.path = newPath
  existing.name = basename(newPath)
  existing.url = mediaUrl(newPath)
  if (existing.needsProxy) {
    void startProxyGeneration(existing, proxyResolutionScale, true)
  }
  return existing
}

/**
 * Otomatik Smart Proxy karar fonksiyonu:
 * - Tarayıcıda doğrudan çözülemeyen codec'ler (HEVC/H.265, ProRes, AC-3 vb.)
 * - 1080p'den büyük çözünürlüklü videolar (>1920x1080)
 * - Yüksek bit hızlı videolar (>18 Mbps) veya 10-bit/4:2:2 piksel formatları
 * - .MOV kapsayıcılı ağır kamera dosyaları
 */
function checkNeedsProxy(filePath: string, info: ProbeResult): boolean {
  const vOk = NATIVE_VIDEO_CODECS.has(info.codec.toLowerCase())
  const aOk =
    !info.hasAudio || !info.audioCodec || NATIVE_AUDIO_CODECS.has(info.audioCodec.toLowerCase())
  if (!vOk || !aOk) return true

  const ext = extname(filePath).toLowerCase()
  const isMov = ext === '.mov'
  const isOver1080p = Math.max(info.width, info.height) > 1920 || Math.min(info.width, info.height) > 1088
  const isHighBitrate = (info.bitrate ?? 0) > 18_000_000
  const is10BitOrChromaHeavy =
    Boolean(info.pixFmt) && info.pixFmt!.toLowerCase() !== 'yuv420p' && info.pixFmt!.toLowerCase() !== 'yuvj420p'

  return isMov || isOver1080p || isHighBitrate || is10BitOrChromaHeavy
}

/**
 * Ağır videolar (>1080p, yüksek bit hızı, .MOV, 10-bit, HEVC/ProRes vb.) için
 * arka planda 720p, yuv420p, -g 1 (All-Intra) ultra hızlı çözülen Smart Proxy üretir.
 * NVIDIA h264_nvenc varsa GPU ile, yoksa -preset ultrafast ile kodlar.
 */
export function startProxyGeneration(
  item: MediaItem,
  scaleOverride?: '1/2' | '1/4' | '1/8',
  forceRebuild = false
): Promise<void> {
  const existingJob = proxyJobs.get(item.id)
  if (existingJob && !forceRebuild) return existingJob

  const activeScale = scaleOverride ?? proxyResolutionScale
  const scaleTag = activeScale === '1/8' ? 's8' : activeScale === '1/4' ? 's4' : 's2'
  const srcW = item.width > 0 ? item.width : 1920
  const rawW =
    activeScale === '1/8'
      ? Math.min(480, Math.max(240, Math.floor(srcW / 8)))
      : activeScale === '1/4'
        ? Math.min(960, Math.max(360, Math.floor(srcW / 4)))
        : Math.min(1280, Math.max(480, Math.floor(srcW / 2)))
  const targetW = Math.floor(rawW / 2) * 2
  const vfScaleExpr = `scale=${targetW}:-2,format=yuv420p`

  const job = (async () => {
    try {
      const proxyDir = getProxyCacheDir()
      await mkdir(proxyDir, { recursive: true })
      const outPath = resolve(join(proxyDir, `${item.id}-smartproxy-${scaleTag}.mp4`))

      if (!forceRebuild && existsSync(outPath)) {
        approvedPaths.add(outPath)
        const url = mediaUrl(outPath)
        item.proxyState = 'ready'
        item.proxyProgress = 1
        item.proxyUrl = url
        broadcastProxyUpdate({ id: item.id, state: 'ready', progress: 1, proxyUrl: url })
        return
      }

      item.proxyState = 'building'
      item.proxyProgress = 0
      broadcastProxyUpdate({ id: item.id, state: 'building', progress: 0, proxyUrl: null })

      const engine = await getEngineInfo()
      const hasNvenc = Boolean(engine.availableEncoders?.includes('h264_nvenc'))

      const runProxyEncode = (useNvenc: boolean) =>
        new Promise<void>((resolvePromise, rejectPromise) => {
          const bin =
            useNvenc && engine.gpuFfmpegPath ? engine.gpuFfmpegPath : engine.ffmpegPath
          const args = [
            '-y',
            '-v',
            'error',
            '-progress',
            'pipe:1',
            '-nostats',
            '-i',
            item.path,
            '-vf',
            vfScaleExpr
          ]
          if (useNvenc) {
            args.push(
              '-c:v',
              'h264_nvenc',
              '-preset',
              'p1',
              '-cq',
              '23',
              '-g',
              '1',
              '-pix_fmt',
              'yuv420p'
            )
          } else {
            args.push(
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-tune',
              'fastdecode',
              '-crf',
              '23',
              '-g',
              '1',
              '-pix_fmt',
              'yuv420p'
            )
          }
          if (item.hasAudio) {
            args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000')
          } else {
            args.push('-an')
          }
          args.push('-movflags', '+faststart', outPath)

          const proc = spawn(bin, args, { windowsHide: true })
          let stderr = ''
          proc.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            const m = text.match(/out_time_us=(\d+)/) ?? text.match(/out_time_ms=(\d+)/)
            if (m && item.duration > 0) {
              const sec = Number(m[1]) / 1_000_000
              const p = Math.max(0, Math.min(0.99, sec / item.duration))
              item.proxyProgress = p
              broadcastProxyUpdate({ id: item.id, state: 'building', progress: p, proxyUrl: null })
            }
          })
          proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
          })
          proc.on('close', (code) => {
            if (code === 0 && existsSync(outPath)) resolvePromise()
            else rejectPromise(new Error(stderr.trim() || `FFmpeg proxy çıkış kodu: ${code}`))
          })
          proc.on('error', rejectPromise)
        })

      if (hasNvenc) {
        try {
          await runProxyEncode(true)
        } catch {
          await runProxyEncode(false)
        }
      } else {
        await runProxyEncode(false)
      }

      approvedPaths.add(outPath)
      const url = mediaUrl(outPath)
      item.proxyState = 'ready'
      item.proxyProgress = 1
      item.proxyUrl = url
      broadcastProxyUpdate({ id: item.id, state: 'ready', progress: 1, proxyUrl: url })
    } catch (err) {
      item.proxyState = 'error'
      broadcastProxyUpdate({
        id: item.id,
        state: 'error',
        progress: 0,
        proxyUrl: null,
        error: (err as Error).message
      })
    } finally {
      proxyJobs.delete(item.id)
    }
  })()

  proxyJobs.set(item.id, job)
  return job
}

async function buildItem(rawPath: string): Promise<MediaItem> {
  const filePath = resolve(rawPath)
  const info = await probeMedia(filePath)
  approvedPaths.add(filePath)
  const thumbnail =
    info.mediaKind === 'audio'
      ? null
      : await makeThumbnail(
          filePath,
          info.mediaKind === 'image' ? 0 : Math.min(1, info.duration * 0.1),
          info.mediaKind === 'image'
        )
  const id = createHash('sha1').update(filePath).digest('hex').slice(0, 12)
  const needsProxy = info.mediaKind === 'video' ? checkNeedsProxy(filePath, info) : false
  const scaleTag =
    proxyResolutionScale === '1/8' ? 's8' : proxyResolutionScale === '1/4' ? 's4' : 's2'
  const cachedProxyPath = resolve(join(getProxyCacheDir(), `${id}-smartproxy-${scaleTag}.mp4`))
  const hasCachedProxy = needsProxy && existsSync(cachedProxyPath)
  if (hasCachedProxy) {
    approvedPaths.add(cachedProxyPath)
  }

  const item: MediaItem = {
    id,
    path: filePath,
    name: basename(filePath),
    ...info,
    thumbnail,
    url: mediaUrl(filePath),
    needsProxy,
    proxyState: hasCachedProxy ? 'ready' : needsProxy ? 'building' : 'none',
    proxyProgress: hasCachedProxy ? 1 : 0,
    proxyUrl: hasCachedProxy ? mediaUrl(cachedProxyPath) : null
  }
  mediaRegistry.set(id, item)

  if (needsProxy && !hasCachedProxy) {
    void startProxyGeneration(item)
  }
  return item
}

/** İlgili medyanın gerçek ses dalgası tepe değerlerini döndürür (önbellekli). */
export async function getPeaksForMedia(mediaId: string): Promise<PeaksResult | null> {
  const item = mediaRegistry.get(mediaId)
  if (!item) return null
  if (!item.hasAudio) {
    return { peaks: new Uint8Array(Math.max(1, Math.ceil(item.duration * 50))), perSecond: 50 }
  }
  let p = peaksCache.get(mediaId)
  if (!p) {
    p = extractPeaks(item.path, item.duration, 50)
    peaksCache.set(mediaId, p)
  }
  return p
}

/** Verilen dosya yollarını analiz eder (hatalı olanları errors'a yazar). */
export async function importPaths(paths: string[]): Promise<Omit<ImportResult, 'canceled'>> {
  const items: MediaItem[] = []
  const errors: string[] = []
  for (const p of paths) {
    try {
      items.push(await buildItem(p))
    } catch (e) {
      errors.push(`${basename(p)}: ${(e as Error).message}`)
    }
  }
  return { items, errors }
}

/** Dosya seçici (Video / Ses / Görsel) açar ve seçilenleri içe aktarır. */
export async function importFromDialog(win: BrowserWindow | null): Promise<ImportResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Medya Seç (Video, Ses veya Görsel)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Tüm Desteklenen Medya',
        extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]
      },
      { name: 'Video (MP4, MOV, MKV, WEBM)', extensions: VIDEO_EXTENSIONS },
      { name: 'Ses (MP3, WAV, AAC, FLAC, OGG, M4A)', extensions: AUDIO_EXTENSIONS },
      { name: 'Görsel (PNG, JPG, WEBP)', extensions: IMAGE_EXTENSIONS },
      { name: 'Tüm Dosyalar', extensions: ['*'] }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || res.filePaths.length === 0) return { items: [], errors: [], canceled: true }
  return { ...(await importPaths(res.filePaths)), canceled: false }
}
