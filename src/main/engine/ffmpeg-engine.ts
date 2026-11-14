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
import { existsSync } from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { EngineInfo } from '../../shared/types'

/** Paketlenmiş (asar) uygulamada binary'ler app.asar.unpacked içinde bulunur. */
function unpackAsar(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

function resolveEmbedded(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  const fixed = unpackAsar(candidate)
  return existsSync(fixed) ? fixed : null
}

function run(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

let cached: EngineInfo | null = null

export async function initEngine(): Promise<EngineInfo> {
  const embeddedFfmpeg = resolveEmbedded(ffmpegStatic as unknown as string)
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

  cached = { ffmpegPath, ffprobePath, source, version, platform: process.platform }
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
