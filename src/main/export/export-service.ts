/**
 * FFmpeg Export Servisi.
 *
 * Timeline üzerindeki:
 *  - V1 video kesmelerini / silmelerini / boşluklarını
 *  - Klip bazlı ses seviyesini (gainDb -> dbToGain)
 *  - Klip bazlı Fade In / Fade Out sürelerini (afade curve=tri)
 *  - Sesi videodan ayrılmış (audioDetached) V1 kliplerini
 *  - Kanal Mute / Solo durumlarını (V1, A1, A2)
 * birebir aynı matematikle MP4 çıktısına işler.
 */
import { ChildProcess, spawn } from 'child_process'
import { BrowserWindow, dialog } from 'electron'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { bakeColorGradeToCube, isNeutralGrade } from '../../shared/color'
import { synthesizeCreditFoleyWav } from '../../shared/foley-wav'
import {
  EXPORT_RESOLUTION_DIM,
  MIN_DB,
  TimelineClip,
  dbToGain,
  defaultExportSettings,
  isLaneAudible,
  projectEnd,
  type ExportRequest
} from '../../shared/timeline'
import type { ExportResult } from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { getMediaItem } from '../media/media-service'

let activeProc: ChildProcess | null = null

function sendProgress(win: BrowserWindow | null, percent: number): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('export:progress', Math.max(0, Math.min(100, Math.round(percent))))
  }
}

export function cancelActiveExport(): void {
  if (activeProc) {
    activeProc.kill('SIGTERM')
    activeProc = null
  }
}

export async function exportTimeline(
  req: ExportRequest,
  win: BrowserWindow | null
): Promise<ExportResult> {
  const { clips, lanes, customLuts, creditOverlays } = req
  const settings = req.settings ?? defaultExportSettings()
  const { width, height } = EXPORT_RESOLUTION_DIM[settings.resolution]
  const fps = settings.fps
  const ext = settings.format === 'mov' ? 'mov' : 'mp4'
  const crf = settings.quality === 'high' ? '15' : settings.quality === 'low' ? '26' : '20'
  const preset = settings.quality === 'high' ? 'medium' : settings.quality === 'low' ? 'veryfast' : 'faster'

  const total = projectEnd(clips)
  if (clips.length === 0 || total <= 0.05) {
    return { ok: false, error: 'Dışa aktarılacak klip bulunamadı.' }
  }

  let outPath = process.env['NOIRCUT_EXPORT_OUT']
    ? resolve(process.env['NOIRCUT_EXPORT_OUT'])
    : ''

  if (!outPath) {
    const saveOpts: Electron.SaveDialogOptions = {
      title: `Videoyu Dışa Aktar (${ext.toUpperCase()})`,
      defaultPath: `NoirCut-Export.${ext}`,
      filters: [
        settings.format === 'mov'
          ? { name: 'QuickTime Movie (MOV)', extensions: ['mov'] }
          : { name: 'MP4 Video', extensions: ['mp4'] }
      ]
    }
    const res = win
      ? await dialog.showSaveDialog(win, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (res.canceled || !res.filePath) {
      return { ok: false, canceled: true }
    }
    outPath = resolve(res.filePath)
  }

  // Kullanılan medya dosyalarını tekilleştirerek FFmpeg -i indekslerini ata (V2 metin klipleri hariç)
  const inputArgs: string[] = []
  const mediaInputIdx = new Map<string, number>()
  let nextInputIdx = 0
  for (const c of clips) {
    if (c.lane === 'V2') continue
    if (!mediaInputIdx.has(c.mediaId)) {
      const m = getMediaItem(c.mediaId)
      if (!m) return { ok: false, error: `Medya bulunamadı: ${c.name}` }
      mediaInputIdx.set(c.mediaId, nextInputIdx++)
      inputArgs.push('-i', m.path)
    }
  }

  const filterParts: string[] = []

  // 1) V1 Video akışı
  const vClips = clips
    .filter((c) => c.lane === 'V1' && c.duration > 0.02)
    .sort((a, b) => a.start - b.start)

  const vSegLabels: string[] = []
  let cursor = 0
  let segCounter = 0
  let tempLutDir: string | null = null

  const escapeFilterPath = (p: string): string =>
    p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

  for (const c of vClips) {
    if (c.start > cursor + 0.02) {
      const gap = c.start - cursor
      const lbl = `vseg${segCounter++}`
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${gap.toFixed(4)},format=yuv420p[${lbl}]`
      )
      vSegLabels.push(`[${lbl}]`)
      cursor = c.start
    }
    const inIdx = mediaInputIdx.get(c.mediaId)!
    const lbl = `vseg${segCounter++}`
    let gradeFilter = ''
    if (c.grade && !isNeutralGrade(c.grade)) {
      if (!tempLutDir) tempLutDir = mkdtempSync(join(tmpdir(), 'noircut-lut-'))
      const cubePath = join(tempLutDir, `grade-${segCounter}.cube`)
      writeFileSync(cubePath, bakeColorGradeToCube(c.grade, customLuts, 33), 'utf-8')
      gradeFilter = `,format=rgb24,lut3d=file='${escapeFilterPath(cubePath)}':interp=trilinear`
    }
    filterParts.push(
      `[${inIdx}:v]trim=start=${c.in.toFixed(4)}:duration=${c.duration.toFixed(4)},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1${gradeFilter},format=yuv420p[${lbl}]`
    )
    vSegLabels.push(`[${lbl}]`)
    cursor = c.start + c.duration
  }

  if (total > cursor + 0.02 || vSegLabels.length === 0) {
    const tail = Math.max(0.05, total - cursor)
    const lbl = `vseg${segCounter++}`
    filterParts.push(
      `color=c=black:s=${width}x${height}:r=${fps}:d=${tail.toFixed(4)},format=yuv420p[${lbl}]`
    )
    vSegLabels.push(`[${lbl}]`)
  }

  if (vSegLabels.length === 1) {
    filterParts.push(`${vSegLabels[0]}null[vbase]`)
  } else {
    filterParts.push(`${vSegLabels.join('')}concat=n=${vSegLabels.length}:v=1:a=0[vbase]`)
  }

  // 1b) V2 Jenerik / Metin Overlay katmanı
  const v2Clips = isLaneAudible(lanes, 'V2')
    ? clips
        .filter((c) => c.lane === 'V2' && c.duration > 0.02 && creditOverlays?.[c.id])
        .sort((a, b) => a.start - b.start)
    : []

  let currentVLabel = '[vbase]'
  v2Clips.forEach((c, idx) => {
    const ov = creditOverlays![c.id]
    const b64 = ov.pngDataUrl.replace(/^data:image\/png;base64,/, '')
    if (!tempLutDir) tempLutDir = mkdtempSync(join(tmpdir(), 'noircut-lut-'))
    const pngPath = join(tempLutDir, `credit-${idx}.png`)
    writeFileSync(pngPath, Buffer.from(b64, 'base64'))

    const inIdx = nextInputIdx++
    inputArgs.push('-loop', '1', '-t', total.toFixed(4), '-i', pngPath)

    const start = c.start.toFixed(4)
    const dur = c.duration.toFixed(4)
    const end = (c.start + c.duration).toFixed(4)
    const crLabel = `cr${idx}`
    const nextVLabel = `[vov${idx}]`

    if (ov.mode === 'rolling') {
      filterParts.push(`[${inIdx}:v]format=rgba[${crLabel}]`)
      filterParts.push(
        `${currentVLabel}[${crLabel}]overlay=x=0:y='H-(t-${start})/${dur}*(H+h)':enable='between(t,${start},${end})'${nextVLabel}`
      )
    } else {
      const fadeDur = Math.min(0.6, c.duration * 0.18)
      const foStart = Math.max(c.start, c.start + c.duration - fadeDur).toFixed(4)
      filterParts.push(
        `[${inIdx}:v]format=rgba,fade=t=in:st=${start}:d=${fadeDur.toFixed(4)}:alpha=1,fade=t=out:st=${foStart}:d=${fadeDur.toFixed(4)}:alpha=1[${crLabel}]`
      )
      filterParts.push(
        `${currentVLabel}[${crLabel}]overlay=x=0:y=0:enable='between(t,${start},${end})'${nextVLabel}`
      )
    }
    currentVLabel = nextVLabel
  })

  filterParts.push(`${currentVLabel}format=yuv420p[vout]`)

  // 2) Ses akışı (V1 gömülü + A1 + A2)
  const audibleClips: TimelineClip[] = clips.filter((c) => {
    if (c.duration <= 0.02 || c.gainDb <= MIN_DB) return false
    if (c.lane === 'V1' && c.audioDetached) return false
    if (!isLaneAudible(lanes, c.lane)) return false
    const m = getMediaItem(c.mediaId)
    return Boolean(m?.hasAudio)
  })

  filterParts.push(
    `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(4)},asetpts=PTS-STARTPTS[abase]`
  )

  const aLabels: string[] = ['[abase]']
  audibleClips.forEach((c, idx) => {
    const inIdx = mediaInputIdx.get(c.mediaId)!
    const gain = dbToGain(c.gainDb)
    const chain: string[] = [
      `atrim=start=${c.in.toFixed(4)}:duration=${c.duration.toFixed(4)}`,
      `asetpts=PTS-STARTPTS`,
      `aresample=48000`,
      `aformat=sample_fmts=fltp:channel_layouts=stereo`,
      `volume=${gain.toFixed(6)}`
    ]
    if (c.fadeIn > 0.005) {
      const fi = Math.min(c.fadeIn, c.duration)
      chain.push(`afade=t=in:st=0:d=${fi.toFixed(4)}:curve=tri`)
    }
    if (c.fadeOut > 0.005) {
      const fo = Math.min(c.fadeOut, c.duration)
      const st = Math.max(0, c.duration - fo)
      chain.push(`afade=t=out:st=${st.toFixed(4)}:d=${fo.toFixed(4)}:curve=tri`)
    }
    if (c.start > 0.001) {
      const delayMs = Math.round(c.start * 1000)
      chain.push(`adelay=${delayMs}:all=1`)
    }
    chain.push(`apad=whole_dur=${total.toFixed(4)}`)
    const lbl = `aud${idx}`
    filterParts.push(`[${inIdx}:a]${chain.join(',')}[${lbl}]`)
    aLabels.push(`[${lbl}]`)
  })

  if (aLabels.length === 1) {
    // V2 Foley SFX varsa yine amix'e geçmek için aşağıda kontrol edilir
  }

  // 2b) V2 Jenerik Foley SFX ses katmanları (geçici WAV sentezi)
  v2Clips.forEach((c, idx) => {
    const cr = c.credit
    if (!cr || !cr.sfxEnabled || cr.sfxVolume <= 0) return
    if (!cr.typewriter && !cr.filmWeave) return

    if (!tempLutDir) tempLutDir = mkdtempSync(join(tmpdir(), 'noircut-lut-'))
    const wavPath = join(tempLutDir, `foley-${idx}.wav`)
    writeFileSync(wavPath, synthesizeCreditFoleyWav(cr, c.duration, 48000))

    const foleyInIdx = nextInputIdx++
    inputArgs.push('-i', wavPath)

    const chain: string[] = [
      `aresample=48000`,
      `aformat=sample_fmts=fltp:channel_layouts=stereo`
    ]
    if (c.start > 0.001) {
      chain.push(`adelay=${Math.round(c.start * 1000)}:all=1`)
    }
    chain.push(`apad=whole_dur=${total.toFixed(4)}`)
    const lbl = `foley${idx}`
    filterParts.push(`[${foleyInIdx}:a]${chain.join(',')}[${lbl}]`)
    aLabels.push(`[${lbl}]`)
  })

  if (aLabels.length === 1) {
    filterParts.push(`[abase]anull[aout]`)
  } else {
    filterParts.push(
      `${aLabels.join('')}amix=inputs=${aLabels.length}:duration=first:dropout_transition=0:normalize=0[aout]`
    )
  }

  const engine = await getEngineInfo()
  const args: string[] = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', ...inputArgs]
  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    total.toFixed(4),
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    crf,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    outPath
  )

  sendProgress(win, 0)

  return new Promise((resolvePromise) => {
    const cleanup = () => {
      if (tempLutDir) {
        try {
          rmSync(tempLutDir, { recursive: true, force: true })
        } catch {
          // yoksay
        }
        tempLutDir = null
      }
    }
    const proc = spawn(engine.ffmpegPath, args)
    activeProc = proc
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const m = text.match(/out_time_us=(\d+)/) ?? text.match(/out_time_ms=(\d+)/)
      if (m && total > 0) {
        const sec = Number(m[1]) / 1_000_000
        sendProgress(win, (sec / total) * 100)
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', (code, signal) => {
      activeProc = null
      cleanup()
      if (signal === 'SIGTERM') {
        resolvePromise({ ok: false, canceled: true })
      } else if (code === 0 && existsSync(outPath)) {
        sendProgress(win, 100)
        resolvePromise({ ok: true, path: outPath })
      } else {
        resolvePromise({
          ok: false,
          error: stderr.trim() || `FFmpeg çıkış kodu: ${code}`
        })
      }
    })
    proc.on('error', (err) => {
      activeProc = null
      cleanup()
      resolvePromise({ ok: false, error: err.message })
    })
  })
}
