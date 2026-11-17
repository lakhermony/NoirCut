/**
 * Medya analizi (ffprobe), küçük resim üretimi (ffmpeg) ve
 * gerçek ses dalga formu (PCM tepe genlikleri) çıkarma.
 */
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import type { MediaKind, PeaksResult } from '../../shared/types'
import { ffmpeg, getEngineInfo, probe } from '../engine/ffmpeg-engine'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const IMAGE_CODECS = new Set(['png', 'mjpeg', 'jpeg2000', 'webp', 'bmp', 'tiff'])

export interface ProbeResult {
  mediaKind: MediaKind
  duration: number
  width: number
  height: number
  codec: string
  fps: number
  hasAudio: boolean
  audioCodec: string | null
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  return d ? n / d : n || 0
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const data = await probe(filePath)
  const ext = extname(filePath).toLowerCase()
  const video = data.streams.find((s) => s.codec_type === 'video')
  const audio = data.streams.find((s) => s.codec_type === 'audio')

  // Statik görsel dosyaları (PNG, JPG, WEBP)
  const isImageByExt = IMAGE_EXTS.has(ext)
  const isImageByStream =
    Boolean(video) &&
    !audio &&
    IMAGE_CODECS.has((video?.codec_name ?? '').toLowerCase()) &&
    Number(data.format.duration ?? video?.duration ?? 0) <= 0.1
  if (isImageByExt || isImageByStream) {
    return {
      mediaKind: 'image',
      duration: 5,
      width: video?.width ?? 1920,
      height: video?.height ?? 1080,
      codec: video?.codec_name ?? 'image',
      fps: 24,
      hasAudio: false,
      audioCodec: null
    }
  }

  // Bağımsız ses dosyaları (MP3, WAV, FLAC, AAC, OGG, M4A)
  if (!video) {
    if (!audio) throw new Error('Dosyada video veya ses akışı bulunamadı')
    const duration = Number(data.format.duration ?? audio.duration ?? 0)
    if (!duration || !isFinite(duration)) throw new Error('Ses süresi okunamadı')
    return {
      mediaKind: 'audio',
      duration,
      width: 0,
      height: 0,
      codec: 'none',
      fps: 24,
      hasAudio: true,
      audioCodec: audio.codec_name ?? null
    }
  }

  const duration = Number(data.format.duration ?? video.duration ?? 0)
  if (!duration || !isFinite(duration)) throw new Error('Video süresi okunamadı')
  return {
    mediaKind: 'video',
    duration,
    width: video.width ?? 0,
    height: video.height ?? 0,
    codec: video.codec_name ?? 'unknown',
    fps: parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate) || 25,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null
  }
}

/** Video veya statik görselden küçük resim üretir, data: URL olarak döndürür. Hata olursa null. */
export function makeThumbnail(
  filePath: string,
  atSeconds: number,
  isImage = false
): Promise<string | null> {
  const out = join(tmpdir(), `noircut-thumb-${randomUUID()}.jpg`)
  return new Promise((resolve) => {
    const cmd = ffmpeg(filePath)
    if (!isImage) cmd.seekInput(atSeconds)
    cmd
      .frames(1)
      .outputOptions(['-vf', 'scale=320:-2', '-q:v', '4'])
      .output(out)
      .on('end', async () => {
        try {
          const buf = await readFile(out)
          await rm(out, { force: true })
          resolve(`data:image/jpeg;base64,${buf.toString('base64')}`)
        } catch {
          resolve(null)
        }
      })
      .on('error', () => resolve(null))
      .run()
  })
}

/**
 * Ses akışını 4000 Hz mono 16-bit PCM olarak çözer ve saniyede `perSecond` (varsayılan 50)
 * tepe noktası (0..255) çıkarır. Böylece konuşma ve sessizlik anları gerçek veriden çizilir.
 */
export async function extractPeaks(
  filePath: string,
  duration: number,
  perSecond = 50
): Promise<PeaksResult> {
  const sampleRate = 4000
  const samplesPerBucket = Math.max(1, Math.floor(sampleRate / perSecond))
  const totalBuckets = Math.max(1, Math.ceil(duration * perSecond))
  const peaks = new Uint8Array(totalBuckets)

  const engine = await getEngineInfo()
  return new Promise((resolve) => {
    const proc = spawn(engine.ffmpegPath, [
      '-v',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1'
    ])

    let bucketIdx = 0
    let sampleInBucket = 0
    let maxInBucket = 0
    let leftover: Buffer | null = null

    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk
      const evenLen = buf.length & ~1
      leftover = buf.length > evenLen ? buf.subarray(evenLen) : null

      for (let i = 0; i < evenLen; i += 2) {
        const sample = Math.abs(buf.readInt16LE(i))
        if (sample > maxInBucket) maxInBucket = sample
        sampleInBucket++
        if (sampleInBucket >= samplesPerBucket) {
          if (bucketIdx < peaks.length) {
            peaks[bucketIdx++] = Math.min(255, Math.round((maxInBucket / 32768) * 255))
          }
          sampleInBucket = 0
          maxInBucket = 0
        }
      }
    })

    const finish = () => {
      if (sampleInBucket > 0 && bucketIdx < peaks.length) {
        peaks[bucketIdx] = Math.min(255, Math.round((maxInBucket / 32768) * 255))
      }
      resolve({ peaks, perSecond })
    }

    proc.on('close', finish)
    proc.on('error', () => resolve({ peaks, perSecond }))
  })
}
