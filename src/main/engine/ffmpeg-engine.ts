/**
 * NoirCut Video Motoru (modüler FFmpeg katmanı)
 *
 * Öncelik sırası:
 *  1. ffmpeg-static  -> uygulamaya gömülü binary (Linux + Windows'ta aynı çalışır)
 *  2. Sistemde kurulu ffmpeg (PATH)
 *
 * Böylece kullanıcının bilgisayarında FFmpeg olmasa bile uygulama çalışır.
 * Tüm yollar path.join / path.resolve ile oluşturulur; işletim sistemine bağımlı değildir.
 */
import { execFile } from 'child_process'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { EngineInfo, VideoEncoderId } from '../../shared/types'

/** Paketlenmiş (asar) uygulamada binary'ler app.asar.unpacked içinde bulunur. */
function unpackAsar(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

function resolveEmbedded(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  const fixed = unpackAsar(candidate)
  return existsSync(fixed) ? fixed : null
}

function resolveWinBundledFfmpeg(): string | null {
  if (process.platform !== 'win32') return null
  const candidates = [
    join(process.resourcesPath, 'bin', 'win', 'ffmpeg.exe'),
    resolve(app.getAppPath(), '..', 'bin', 'win', 'ffmpeg.exe'),
    resolve(process.cwd(), 'resources', 'bin', 'win', 'ffmpeg.exe')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function run(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

const HW_CANDIDATES: Array<Exclude<VideoEncoderId, 'libx264'>> = [
  'h264_nvenc',
  'h264_vaapi',
  'h264_qsv',
  'h264_amf'
]

async function detectCompiledHwEncoders(bin: string): Promise<Array<Exclude<VideoEncoderId, 'libx264'>>> {
  const out = await run(bin, ['-hide_banner', '-encoders'])
  if (!out) return []
  return HW_CANDIDATES.filter((enc) => out.includes(enc))
}

async function testHwEncoderUsable(bin: string, enc: Exclude<VideoEncoderId, 'libx264'>): Promise<boolean> {
  const args =
    enc === 'h264_vaapi'
      ? [
          '-v',
          'error',
          '-vaapi_device',
          '/dev/dri/renderD128',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=64x64:d=0.04',
          '-vf',
          'format=nv12,hwupload',
          '-frames:v',
          '1',
          '-c:v',
          enc,
          '-f',
          'null',
          '-'
        ]
      : [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=64x64:d=0.04',
          '-frames:v',
          '1',
          '-c:v',
          enc,
          '-f',
          'null',
          '-'
        ]
  const res = await run(bin, args)
  return res !== null
}

let cached: EngineInfo | null = null

export async function initEngine(): Promise<EngineInfo> {
  const winFfmpeg = resolveWinBundledFfmpeg()
  const embeddedFfmpeg = winFfmpeg ?? resolveEmbedded(ffmpegStatic as unknown as string)
  const embeddedFfprobe = resolveEmbedded((ffprobeStatic as { path: string }).path)

  let ffmpegPath = 'ffmpeg'
  let ffprobePath = 'ffprobe'
  let source: EngineInfo['source'] = 'system'

  if (embeddedFfmpeg) {
    ffmpegPath = embeddedFfmpeg
    source = 'embedded'
    if (embeddedFfprobe) ffprobePath = embeddedFfprobe
  }

  const out = await run(ffmpegPath, ['-version'])
  const version = out ? (out.split('\n')[0].match(/version\s+(\S+)/)?.[1] ?? null) : null
  if (!version) source = 'missing'

  ffmpeg.setFfmpegPath(ffmpegPath)
  ffmpeg.setFfprobePath(ffprobePath)

  const availableEncoders: VideoEncoderId[] = ['libx264']
  let gpuFfmpegPath: string | null = null

  const candidateBins = source === 'embedded' ? [ffmpegPath, 'ffmpeg'] : [ffmpegPath]
  for (const bin of candidateBins) {
    const compiled = await detectCompiledHwEncoders(bin)
    if (compiled.length === 0) continue
    for (const enc of compiled) {
      if (availableEncoders.includes(enc)) continue
      const ok = await testHwEncoderUsable(bin, enc)
      if (ok) {
        availableEncoders.push(enc)
        if (bin !== ffmpegPath && !gpuFfmpegPath) {
          gpuFfmpegPath = bin
        }
      }
    }
  }

  cached = {
    ffmpegPath,
    ffprobePath,
    source,
    version,
    platform: process.platform,
    availableEncoders,
    gpuFfmpegPath
  }
  return cached
}

export async function getEngineInfo(): Promise<EngineInfo> {
  return cached ?? initEngine()
}

/** Gelecekte kullanılacak: bir medya dosyasının bilgilerini okur. */
export function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

export { ffmpeg }
