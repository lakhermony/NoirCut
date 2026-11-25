import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import type {
  ClipMetadataInfo,
  SceneDetectResult,
  TransientDetectResult
} from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { getMediaItem } from './media-service'

const execFileAsync = promisify(execFile)

function parseFps(rate?: string): number {
  if (!rate) return 24
  const [n, d] = rate.split('/').map(Number)
  if (Number.isFinite(n) && Number.isFinite(d) && d > 0) {
    return Number((n / d).toFixed(3))
  }
  const f = Number(rate)
  return Number.isFinite(f) && f > 0 ? Number(f.toFixed(3)) : 24
}

export async function extractClipsMetadata(mediaIds: string[]): Promise<ClipMetadataInfo[]> {
  if (!Array.isArray(mediaIds)) return []
  const uniqueIds = Array.from(new Set(mediaIds.filter((id) => typeof id === 'string' && id.length > 0)))
  const { ffprobePath } = await getEngineInfo()
  const out: ClipMetadataInfo[] = []

  for (const id of uniqueIds) {
    const item = getMediaItem(id)
    if (!item?.path || !existsSync(item.path)) continue
    try {
      const { stdout } = await execFileAsync(
        ffprobePath,
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', item.path],
        { timeout: 10000, windowsHide: true }
      )
      const json = JSON.parse(stdout) as {
        format?: { tags?: Record<string, string> }
        streams?: Array<{
          codec_type?: string
          codec_name?: string
          codec_long_name?: string
          width?: number
          height?: number
          r_frame_rate?: string
          color_primaries?: string
          color_space?: string
          tags?: Record<string, string>
        }>
      }
      const vStream = json.streams?.find((s) => s.codec_type === 'video')
      const fTags = json.format?.tags ?? {}
      const vTags = vStream?.tags ?? {}
      const cameraOrEncoder =
        fTags['com.apple.quicktime.model'] ||
        fTags['model'] ||
        fTags['encoder'] ||
        vTags['encoder'] ||
        vStream?.codec_long_name ||
        item.codec ||
        'Digital Cinema'

      out.push({
        mediaId: item.id,
        name: item.name,
        cameraOrEncoder: String(cameraOrEncoder),
        width: vStream?.width || item.width || 1920,
        height: vStream?.height || item.height || 1080,
        fps: parseFps(vStream?.r_frame_rate) || item.fps || 24,
        colorPrimaries: vStream?.color_primaries || vStream?.color_space || 'bt709',
        codec: vStream?.codec_name || item.codec || 'h264'
      })
    } catch {
      out.push({
        mediaId: item.id,
        name: item.name,
        cameraOrEncoder: item.codec || 'Digital Cinema',
        width: item.width || 1920,
        height: item.height || 1080,
        fps: item.fps || 24,
        colorPrimaries: 'bt709',
        codec: item.codec || 'h264'
      })
    }
  }
  return out
}

export async function detectSceneCuts(
  mediaId: string,
  threshold = 0.32
): Promise<SceneDetectResult> {
  const item = getMediaItem(mediaId)
  if (!item?.path || !existsSync(item.path)) {
    return { ok: false, timestamps: [], error: 'Medya dosyası bulunamadı.' }
  }
  const thresh = Math.max(0.08, Math.min(0.95, Number(threshold) || 0.32))
  const { ffmpegPath } = await getEngineInfo()

  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-i',
        item.path,
        '-vf',
        `select='gt(scene,${thresh.toFixed(2)})',showinfo`,
        '-an',
        '-f',
        'null',
        '-'
      ],
      { windowsHide: true }
    )
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', (err) => {
      resolve({ ok: false, timestamps: [], error: err.message })
    })
    proc.on('close', (code) => {
      if (code !== 0 && stderr.length === 0) {
        resolve({ ok: false, timestamps: [], error: `FFmpeg çıkış kodu: ${code}` })
        return
      }
      const timestamps: number[] = []
      const re = /pts_time:(\d+(?:\.\d+)?)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(stderr)) !== null) {
        const t = Number(m[1])
        if (Number.isFinite(t) && (timestamps.length === 0 || t - timestamps[timestamps.length - 1] >= 0.25)) {
          timestamps.push(Number(t.toFixed(3)))
        }
      }
      resolve({ ok: true, timestamps })
    })
  })
}

export async function detectAudioTransients(
  mediaId: string,
  sensitivity = 0.65
): Promise<TransientDetectResult> {
  const item = getMediaItem(mediaId)
  if (!item?.path || !existsSync(item.path)) {
    return { ok: false, timestamps: [], error: 'Medya dosyası bulunamadı.' }
  }
  const sens = Math.max(0.2, Math.min(0.98, Number(sensitivity) || 0.65))
  const { ffmpegPath } = await getEngineInfo()

  return new Promise((resolve) => {
    const sampleRate = 16000
    const proc = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-v',
        'error',
        '-i',
        item.path,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-f',
        'f32le',
        'pipe:1'
      ],
      { windowsHide: true }
    )
    const chunks: Buffer[] = []
    let errText = ''
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => {
      errText += chunk.toString()
    })
    proc.on('error', (err) => resolve({ ok: false, timestamps: [], error: err.message }))
    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        resolve({ ok: false, timestamps: [], error: errText || `FFmpeg çıkış kodu: ${code}` })
        return
      }
      const buf = Buffer.concat(chunks)
      const sampleCount = Math.floor(buf.length / 4)
      if (sampleCount < 320) {
        resolve({ ok: true, timestamps: [] })
        return
      }
      const win = 320 // 20ms @ 16kHz
      const frameCount = Math.floor(sampleCount / win)
      const rms = new Float32Array(frameCount)
      for (let f = 0; f < frameCount; f++) {
        let sum = 0
        const base = f * win
        for (let i = 0; i < win; i++) {
          const s = buf.readFloatLE((base + i) * 4)
          sum += s * s
        }
        rms[f] = Math.sqrt(sum / win)
      }

      // Enerji akısı (pozitif RMS artışı) + yerel adaptif eşik
      const flux = new Float32Array(frameCount)
      let globalMax = 1e-6
      for (let f = 1; f < frameCount; f++) {
        const diff = Math.max(0, rms[f] - rms[f - 1])
        flux[f] = diff
        if (diff > globalMax) globalMax = diff
      }

      const timestamps: number[] = []
      const mult = 3.2 - sens * 1.8 // hassasiyet yükseldikçe çarpan düşer
      const floor = globalMax * (0.12 - sens * 0.06)
      for (let f = 2; f < frameCount - 1; f++) {
        let localAvg = 0
        const lo = Math.max(1, f - 12)
        const hi = Math.min(frameCount - 1, f + 4)
        for (let k = lo; k <= hi; k++) localAvg += flux[k]
        localAvg /= hi - lo + 1

        if (
          flux[f] > Math.max(floor, localAvg * mult) &&
          flux[f] >= flux[f - 1] &&
          flux[f] >= flux[f + 1]
        ) {
          const t = Number(((f * win) / sampleRate).toFixed(3))
          if (timestamps.length === 0 || t - timestamps[timestamps.length - 1] >= 0.22) {
            timestamps.push(t)
          }
        }
      }
      resolve({ ok: true, timestamps })
    })
  })
}
