import type { MediaItem } from '../../../shared/types'

/**
 * NoirCut Çoklu Kare Filmstrip Önbelleği (Multi-Frame Filmstrip Thumbnail Cache)
 *
 * - Her video kaynağı (mediaId) için arka planda tek bir sessiz <video> + <canvas>
 *   işçisi (worker queue) kullanarak klip boyunca farklı zaman damgalarından
 *   orijinal en-boy oranını koruyan küçük kareler (160px genişlik tabanlı) üretir.
 * - Üretilen kareler `${mediaId}:${bucketKey}` anahtarıyla RAM'de (LRU) tutulur.
 * - Yakınlaştırma (zoom), kaydırma (scroll) veya kırpma (trim) sırasında
 *   kesinlikle siyah kare (black flash) veya titreme (flicker) oluşmaz:
 *   henüz çıkarılmamış bir kare istendiğinde anında en yakın önbellek karesi
 *   veya medyanın ana küçük resmi (m.thumbnail) gösterilir ve kare hazır olduğunda
 *   abone olan FilmstripCanvas bileşenleri yumuşakça yeniden çizilir.
 */

const MAX_CACHED_FRAMES = 360
const TIME_BUCKET_SEC = 0.5

type FrameListener = () => void

interface VideoExtractorWorker {
  mediaId: string
  url: string
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  ready: boolean
  failed: boolean
  busy: boolean
  queue: number[]
   queuedSet: Set<number>
}

const frameCache = new Map<string, HTMLCanvasElement>()
const baseImageCache = new Map<string, HTMLImageElement>()
const baseImageLoading = new Set<string>()
const workers = new Map<string, VideoExtractorWorker>()
const listenersByMedia = new Map<string, Set<FrameListener>>()

function quantizeTime(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.round(sec / TIME_BUCKET_SEC) * TIME_BUCKET_SEC
}

function makeCacheKey(mediaId: string, bucketSec: number): string {
  return `${mediaId}:${bucketSec.toFixed(2)}`
}

function notifyListeners(mediaId: string): void {
  const set = listenersByMedia.get(mediaId)
  if (!set) return
  set.forEach((fn) => {
    try {
      fn()
    } catch {
      // listener hatalarını yut
    }
  })
}

function touchCache(key: string, canvas: HTMLCanvasElement): void {
  if (frameCache.has(key)) {
    frameCache.delete(key)
  }
  frameCache.set(key, canvas)
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const oldestKey = frameCache.keys().next().value
    if (!oldestKey) break
    frameCache.delete(oldestKey)
  }
}

export function subscribeFilmstripMedia(mediaId: string, fn: FrameListener): () => void {
  let set = listenersByMedia.get(mediaId)
  if (!set) {
    set = new Set()
    listenersByMedia.set(mediaId, set)
  }
  set.add(fn)
  return () => {
    const cur = listenersByMedia.get(mediaId)
    if (!cur) return
    cur.delete(fn)
    if (cur.size === 0) listenersByMedia.delete(mediaId)
  }
}

/**
 * Medyanın ana küçük resmini (m.thumbnail veya görsel ise m.url) HTMLImageElement
 * olarak yükler ve önbelleğe alır.
 */
export function getBaseThumbnailImage(media: MediaItem | undefined): HTMLImageElement | null {
  if (!media) return null
  const src = media.thumbnail || (media.mediaKind === 'image' ? media.url : null)
  if (!src) return null

  const existing = baseImageCache.get(media.id)
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return existing
  }

  const loadKey = `${media.id}:${src.slice(0, 64)}`
  if (!baseImageLoading.has(loadKey)) {
    baseImageLoading.add(loadKey)
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      baseImageCache.set(media.id, img)
      notifyListeners(media.id)
    }
    img.onerror = () => {
      baseImageLoading.delete(loadKey)
    }
    img.src = src
  }

  return existing && existing.complete && existing.naturalWidth > 0 ? existing : null
}

function ensureWorker(media: MediaItem): VideoExtractorWorker | null {
  if (media.mediaKind === 'audio' || media.mediaKind === 'image') return null
  const playUrl = media.proxyUrl || media.url
  if (!playUrl) return null

  const existing = workers.get(media.id)
  if (existing && existing.url === playUrl) {
    return existing
  }

  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'

  const aspect =
    media.width > 0 && media.height > 0
      ? Math.max(0.5, Math.min(2.6, media.width / media.height))
      : 16 / 9
  const targetH = 96
  const targetW = Math.max(64, Math.round(targetH * aspect))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d', { alpha: false })

  const worker: VideoExtractorWorker = {
    mediaId: media.id,
    url: playUrl,
    video,
    canvas,
    ctx,
    ready: false,
    failed: false,
    busy: false,
    queue: [],
    queuedSet: new Set()
  }

  video.addEventListener(
    'loadeddata',
    () => {
      worker.ready = true
      pumpWorker(worker)
    },
    { once: true }
  )

  video.addEventListener('error', () => {
    worker.failed = true
    worker.queue.length = 0
    worker.queuedSet.clear()
  })

  video.src = playUrl
  workers.set(media.id, worker)
  return worker
}

function pumpWorker(worker: VideoExtractorWorker): void {
  if (worker.busy || worker.failed || !worker.ready) return
  const nextBucket = worker.queue.shift()
  if (nextBucket === undefined) return
  worker.queuedSet.delete(nextBucket)

  const key = makeCacheKey(worker.mediaId, nextBucket)
  if (frameCache.has(key)) {
    pumpWorker(worker)
    return
  }

  worker.busy = true
  const video = worker.video
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3600
  const targetTime = Math.max(0, Math.min(Math.max(0, dur - 0.04), nextBucket))

  let finished = false
  const finish = (captured: boolean) => {
    if (finished) return
    finished = true
    video.removeEventListener('seeked', onSeeked)
    clearTimeout(timer)

    if (captured && worker.video.readyState >= 2) {
      const vw = worker.video.videoWidth || 160
      const vh = worker.video.videoHeight || 90
      const frameCanvas = document.createElement('canvas')
      const h = 92
      const w = Math.max(52, Math.round((vw / Math.max(1, vh)) * h))
      frameCanvas.width = w
      frameCanvas.height = h
      const fctx = frameCanvas.getContext('2d', { alpha: false })
      if (fctx) {
        fctx.drawImage(worker.video, 0, 0, w, h)
        touchCache(key, frameCanvas)
        notifyListeners(worker.mediaId)
      }
    }

    worker.busy = false
    // Ana iş parçacığını (UI thread) bloklamamak için bir sonraki kareyi boşta işle
    setTimeout(() => pumpWorker(worker), 32)
  }

  const onSeeked = () => finish(true)
  const timer = setTimeout(() => finish(false), 650)

  video.addEventListener('seeked', onSeeked, { once: true })
  try {
    if (Math.abs(video.currentTime - targetTime) < 0.02 && video.readyState >= 2) {
      finish(true)
    } else {
      video.currentTime = targetTime
    }
  } catch {
    finish(false)
  }
}

/**
 * Belirli bir medya ve kaynak zaman damgası (saniye) için kareyi döndürür.
 * Tam eşleşen kare henüz yoksa:
 *  1) Arka plan kuyruğuna ekler
 *  2) Aynı medyaya ait en yakın önbellek karesini veya ana thumbnail'i döndürür (sıfır siyah kare).
 */
export function requestFilmstripFrame(
  media: MediaItem | undefined,
  sourceTimeSec: number
): CanvasImageSource | null {
  if (!media) return null

  const baseImg = getBaseThumbnailImage(media)
  if (media.mediaKind === 'image' || media.mediaKind === 'audio') {
    return baseImg
  }

  // Ağır video için arka planda Smart Proxy üretiliyorken ham 4K/Long-GOP videoya ardışık seek atıp arayüzü dondurma;
  // proxy tamamlandığında (-g 1 All-Intra) filmstrip kareleri milisaniyeler içinde çıkarılır.
  if (media.needsProxy && media.proxyState === 'building' && !media.proxyUrl) {
    return baseImg
  }

  const maxDur = media.duration > 0 ? Math.max(0, media.duration - 0.05) : sourceTimeSec
  const clamped = Math.max(0, Math.min(maxDur, sourceTimeSec))
  const bucket = quantizeTime(clamped)
  const exactKey = makeCacheKey(media.id, bucket)

  const exact = frameCache.get(exactKey)
  if (exact) {
    return exact
  }

  // Arka planda çıkarım kuyruğuna ekle
  const worker = ensureWorker(media)
  if (worker && !worker.failed && !worker.queuedSet.has(bucket)) {
    // Kuyruk çok uzadıysa en eski talepleri kırp (zoom değişiminde güncel görünümü önceliklendir)
    if (worker.queue.length > 14) {
      const removed = worker.queue.shift()
      if (removed !== undefined) worker.queuedSet.delete(removed)
    }
    worker.queue.push(bucket)
    worker.queuedSet.add(bucket)
    pumpWorker(worker)
  }

  // En yakın çıkarılmış kareyi bul (varsa)
  let nearest: HTMLCanvasElement | null = null
  let nearestDist = Infinity
  const prefix = `${media.id}:`
  for (const [k, val] of frameCache.entries()) {
    if (!k.startsWith(prefix)) continue
    const t = Number(k.slice(prefix.length))
    const d = Math.abs(t - bucket)
    if (d < nearestDist) {
      nearestDist = d
      nearest = val
    }
  }

  return nearest ?? baseImg
}
