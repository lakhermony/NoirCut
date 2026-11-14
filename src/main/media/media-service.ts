/**
 * Medya servisi: dosya seçici, medya kaydı, güvenli oynatma protokolü,
 * ses dalgası (peaks) önbelleği ve HEVC/ProRes vb. için otomatik Proxy üretimi.
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { BrowserWindow, dialog, net, protocol } from 'electron'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { ImportResult, MediaItem, PeaksResult, ProxyUpdate } from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { extractPeaks, makeThumbnail, probeMedia } from './media-probe'

export const MEDIA_SCHEME = 'noircut-media'
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv']

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

/** app 'ready' olduktan sonra çağrılmalı. */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = resolve(decodeURIComponent(url.pathname.slice(1)))
    if (!approvedPaths.has(filePath)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      bypassCustomProtocolHandlers: true
    })
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers
    })
  })
}

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(filePath)}`
}

export function getMediaItem(id: string): MediaItem | undefined {
  return mediaRegistry.get(id)
}

function broadcastProxyUpdate(update: ProxyUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('media:proxy-update', update)
    }
  }
}

function checkNeedsProxy(codec: string, hasAudio: boolean, audioCodec: string | null): boolean {
  const vOk = NATIVE_VIDEO_CODECS.has(codec.toLowerCase())
  const aOk = !hasAudio || !audioCodec || NATIVE_AUDIO_CODECS.has(audioCodec.toLowerCase())
  return !vOk || !aOk
}

/**
 * Oynamayan codec'ler (HEVC/H.265, ProRes, MPEG-4, AC-3 vb.) için
 * FFmpeg ile H.264 + AAC oynatılabilir proxy üretir.
 */
export function startProxyGeneration(item: MediaItem): Promise<void> {
  const existingJob = proxyJobs.get(item.id)
  if (existingJob) return existingJob

  const job = (async () => {
    try {
      const proxyDir = join(tmpdir(), 'noircut-proxies')
      await mkdir(proxyDir, { recursive: true })
      const outPath = resolve(join(proxyDir, `${item.id}-proxy.mp4`))

      if (existsSync(outPath)) {
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
      await new Promise<void>((resolvePromise, rejectPromise) => {
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
          'scale=min(1280\\,iw):-2,format=yuv420p',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23'
        ]
        if (item.hasAudio) {
          args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000')
        } else {
          args.push('-an')
        }
        args.push('-movflags', '+faststart', outPath)

        const proc = spawn(engine.ffmpegPath, args)
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
  const thumbnail = await makeThumbnail(filePath, Math.min(1, info.duration * 0.1))
  const id = createHash('sha1').update(filePath).digest('hex').slice(0, 12)
  const needsProxy = checkNeedsProxy(info.codec, info.hasAudio, info.audioCodec)

  const item: MediaItem = {
    id,
    path: filePath,
    name: basename(filePath),
    ...info,
    thumbnail,
    url: mediaUrl(filePath),
    needsProxy,
    proxyState: needsProxy ? 'building' : 'none',
    proxyProgress: 0,
    proxyUrl: null
  }
  mediaRegistry.set(id, item)

  if (needsProxy) {
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

/** Dosya seçici (MP4 / MOV / MKV) açar ve seçilenleri içe aktarır. */
export async function importFromDialog(win: BrowserWindow | null): Promise<ImportResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Video Seç',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video (MP4, MOV, MKV)', extensions: VIDEO_EXTENSIONS },
      { name: 'Tüm Dosyalar', extensions: ['*'] }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || res.filePaths.length === 0) return { items: [], errors: [], canceled: true }
  return { ...(await importPaths(res.filePaths)), canceled: false }
}
