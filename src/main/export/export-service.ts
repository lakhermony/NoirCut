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
import { app, BrowserWindow, dialog } from 'electron'
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { cpus, tmpdir } from 'os'
import { join, resolve } from 'path'

function resolveExportFfmpegPath(fallbackPath: string): string {
  if (process.platform === 'win32') {
    const winCandidates = [
      join(process.resourcesPath, 'bin', 'win', 'ffmpeg.exe'),
      resolve(app.getAppPath(), '..', 'bin', 'win', 'ffmpeg.exe'),
      resolve(process.cwd(), 'resources', 'bin', 'win', 'ffmpeg.exe')
    ]
    const found = winCandidates.find((p) => existsSync(p))
    if (found) return found
  }
  return fallbackPath
}
import { bakeColorGradeToCube, isNeutralGrade } from '../../shared/color'
import { hexToRgb01 } from '../../shared/noirfilm'
import { synthesizeCreditFoleyWav } from '../../shared/foley-wav'
import {
  EXPORT_RESOLUTION_DIM,
  MIN_DB,
  TimelineClip,
  buildFfmpegKeyframeExpr,
  dbToGain,
  defaultExportSettings,
  flattenNestedClips,
  getOrderedVideoLanesAsc,
  getParamKeyframes,
  isAudioLane,
  isCreditClip,
  isLaneAudible,
  isVideoLane,
  laneNumber,
  projectEnd,
  type ExportRequest
} from '../../shared/timeline'
import type { ExportResult, VideoEncoderId } from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { getMediaItem } from '../media/media-service'

let activeProc: ChildProcess | null = null
let lastProgressSentAt = 0
let lastProgressPct = -1

function sendProgress(win: BrowserWindow | null, percent: number, force = false): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const now = Date.now()
  if (!force && clamped < 100 && clamped === lastProgressPct) return
  if (!force && clamped < 100 && now - lastProgressSentAt < 140) return
  lastProgressSentAt = now
  lastProgressPct = clamped
  if (win && !win.isDestroyed()) {
    win.webContents.send('export:progress', clamped)
  }
}

export function cancelActiveExport(): void {
  if (activeProc) {
    activeProc.kill('SIGTERM')
    activeProc = null
  }
}

export function pauseActiveExport(): boolean {
  if (!activeProc || process.platform === 'win32') return false
  try {
    return activeProc.kill('SIGSTOP')
  } catch {
    return false
  }
}

export function resumeActiveExport(): boolean {
  if (!activeProc || process.platform === 'win32') return false
  try {
    return activeProc.kill('SIGCONT')
  } catch {
    return false
  }
}

function sliceClipsToRange(
  rawClips: TimelineClip[],
  rangeStart?: number | null,
  rangeEnd?: number | null
): { clips: TimelineClip[]; total: number; offset: number } {
  const flatClips = flattenNestedClips(rawClips)
  const fullTotal = projectEnd(flatClips)
  const rStart = rangeStart != null && rangeStart > 0 ? rangeStart : 0
  const rEnd =
    rangeEnd != null && rangeEnd > rStart + 0.05 ? Math.min(fullTotal, rangeEnd) : fullTotal

  if (rStart <= 0.001 && rEnd >= fullTotal - 0.001) {
    return { clips: flatClips, total: fullTotal, offset: 0 }
  }

  const sliced: TimelineClip[] = []
  for (const c of flatClips) {
    const cEnd = c.start + c.duration
    if (cEnd <= rStart + 0.02 || c.start >= rEnd - 0.02) continue
    const overlapStart = Math.max(c.start, rStart)
    const overlapEnd = Math.min(cEnd, rEnd)
    const newDur = overlapEnd - overlapStart
    if (newDur <= 0.02) continue
    const headCut = overlapStart - c.start
    const speedFactor = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
    const shiftedKeyframes = c.keyframes
      ?.map((k) => ({ ...k, time: k.time - headCut }))
      .filter((k) => k.time >= -0.001 && k.time <= newDur + 0.001)
      .map((k) => ({ ...k, time: Math.max(0, Math.min(newDur, k.time)) }))
    sliced.push({
      ...c,
      start: overlapStart - rStart,
      in: c.in + headCut * speedFactor,
      duration: newDur,
      fadeIn: Math.max(0, c.fadeIn - headCut),
      fadeOut: Math.max(0, c.fadeOut - Math.max(0, cEnd - overlapEnd)),
      keyframes: shiftedKeyframes
    })
  }
  return { clips: sliced, total: Math.max(0, rEnd - rStart), offset: rStart }
}

export async function exportTimeline(
  req: ExportRequest,
  win: BrowserWindow | null
): Promise<ExportResult> {
  const { lanes, customLuts, creditOverlays } = req
  const settings = req.settings ?? defaultExportSettings()
  const { width, height } = EXPORT_RESOLUTION_DIM[settings.resolution]
  const fps = settings.fps
  const ext = settings.format === 'mov' ? 'mov' : 'mp4'
  const crf = settings.quality === 'high' ? '17' : settings.quality === 'low' ? '26' : '21'
  const preset = settings.quality === 'high' ? 'faster' : settings.quality === 'low' ? 'ultrafast' : 'veryfast'

  const { clips, total, offset: rangeOffset } = sliceClipsToRange(req.clips, req.rangeStart, req.rangeEnd)
  if (clips.length === 0 || total <= 0.05) {
    return { ok: false, error: 'Dışa aktarılacak klip bulunamadı.' }
  }

  let outPath = req.outputPath
    ? resolve(req.outputPath)
    : process.env['NOIRCUT_EXPORT_OUT']
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

  // Kullanılan medya dosyalarını tekilleştirerek FFmpeg -i indekslerini ata (metin/jenerik klipleri hariç)
  const imageMaxDur = new Map<string, number>()
  for (const c of clips) {
    if (isCreditClip(c)) continue
    const m = getMediaItem(c.mediaId)
    if (m?.mediaKind === 'image') {
      const speedFactor = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
      const need = Math.max(1, c.duration * speedFactor + 1)
      imageMaxDur.set(c.mediaId, Math.max(imageMaxDur.get(c.mediaId) ?? 0, need))
    }
  }

  const inputArgs: string[] = []
  const mediaInputIdx = new Map<string, number>()
  let nextInputIdx = 0
  for (const c of clips) {
    if (isCreditClip(c)) continue
    if (!mediaInputIdx.has(c.mediaId)) {
      const m = getMediaItem(c.mediaId)
      if (!m) return { ok: false, error: `Medya bulunamadı: ${c.name}` }
      mediaInputIdx.set(c.mediaId, nextInputIdx++)
      if (m.mediaKind === 'image') {
        const loopDur = Math.max(5, imageMaxDur.get(c.mediaId) ?? 10)
        inputArgs.push('-loop', '1', '-t', loopDur.toFixed(2), '-i', m.path)
      } else {
        inputArgs.push('-i', m.path)
      }
    }
  }

  const filterParts: string[] = []

  let tempLutDir: string | null = null
  const escapeFilterPath = (p: string): string =>
    p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  const bakedLutCache = new Map<string, string>()

  /** Trim, hız, LUT renk derecelendirme, Halation/Mist/NoirFilm ve grain katmanını oluşturan ortak yardımcı. */
  const buildClipGradedVideoStream = (
    c: TimelineClip,
    segId: number
  ): { streamLabel: string; pendingChain: string[] } => {
    const mediaItem = getMediaItem(c.mediaId)
    const inIdx = mediaInputIdx.get(c.mediaId)!
    const speedFactor = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
    const srcDur = Math.max(0.05, c.duration * speedFactor)
    const clipIn = mediaItem?.mediaKind === 'image' ? 0 : c.in

    const vChain: string[] = [
      `trim=start=${clipIn.toFixed(4)}:duration=${srcDur.toFixed(4)}`,
      `setpts=(PTS-STARTPTS)/${speedFactor.toFixed(4)}`
    ]
    if (c.reverse && mediaItem?.mediaKind !== 'image') {
      vChain.push('reverse')
    }
    vChain.push(
      `fps=${fps}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      `setsar=1`
    )

    let fxOutLabel: string | null = null
    if (c.grade && !isNeutralGrade(c.grade)) {
      if (!tempLutDir) tempLutDir = mkdtempSync(join(tmpdir(), 'noircut-lut-'))
      const gradeKey = JSON.stringify(c.grade)
      let cubeFileName = bakedLutCache.get(gradeKey)
      if (!cubeFileName) {
        cubeFileName = `grade-${segId}.cube`
        const cubePath = join(tempLutDir, cubeFileName)
        writeFileSync(cubePath, bakeColorGradeToCube(c.grade, customLuts, 33), 'utf-8')
        bakedLutCache.set(gradeKey, cubeFileName)
      }
      // tempLutDir çalışma dizini olarak verildiği için göreli dosya adı Windows/ASCII-dışı yollardaki ':' sorununu önler
      vChain.push(`format=rgb24`, `lut3d=file='${escapeFilterPath(cubeFileName)}':interp=trilinear`)

      const nf = c.grade.noirFilm
      const nfInt = Math.min(1, Math.max(0, (nf?.lookIntensity ?? 100) / 100))
      const halation = Math.min(100, Math.max(0, c.grade.halation ?? 0))
      const mist = Math.min(100, Math.max(0, c.grade.mist ?? 0))
      const nfHal = nf?.lightEffects?.halation
      const nfBlm = nf?.lightEffects?.bloom
      const nfDif = nf?.lightEffects?.diffusion
      const nfMst = nf?.lightEffects?.mist
      const hasNfHal = Boolean(nfHal?.enabled && (nfHal.intensity ?? 0) > 0.5 && nfInt > 0.01)
      const hasNfBlm = Boolean(nfBlm?.enabled && (nfBlm.intensity ?? 0) > 0.5 && nfInt > 0.01)
      const hasNfDif = Boolean(nfDif?.enabled && (nfDif.strength ?? 0) > 0.5 && nfInt > 0.01)
      const hasNfMst = Boolean(nfMst?.enabled && (nfMst.intensity ?? 0) > 0.5 && nfInt > 0.01)

      if (halation > 0.5 || mist > 0.5 || hasNfHal || hasNfBlm || hasNfDif || hasNfMst) {
        let cur = `fxin${segId}`
        filterParts.push(`[${inIdx}:v]${vChain.join(',')}[${cur}]`)
        vChain.length = 0
        if (halation > 0.5) {
          const a = `hal_a${segId}`
          const b = `hal_b${segId}`
          const g = `hal_g${segId}`
          const out = `hal_o${segId}`
          const sigma = (height * (0.008 + 0.014 * (halation / 100))).toFixed(2)
          const opacity = (0.15 + 0.85 * (halation / 100) * 0.8).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(
            `[${b}]curves=all='0/0 0.55/0 1/1',gblur=sigma=${sigma},colorchannelmixer=rr=1:gg=0.30:bb=0.04[${g}]`
          )
          filterParts.push(
            `[${a}][${g}]blend=all_mode=screen:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        if (mist > 0.5) {
          const a = `mist_a${segId}`
          const b = `mist_b${segId}`
          const g = `mist_g${segId}`
          const out = `mist_o${segId}`
          const sigma = (height * (0.006 + 0.012 * (mist / 100))).toFixed(2)
          const opacity = (0.5 * (mist / 100)).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(`[${b}]curves=all='0/0 0.35/0.1 1/1',gblur=sigma=${sigma}[${g}]`)
          filterParts.push(
            `[${a}][${g}]blend=all_mode=screen:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        if (hasNfHal && nfHal) {
          const a = `nfhal_a${segId}`
          const b = `nfhal_b${segId}`
          const g = `nfhal_g${segId}`
          const out = `nfhal_o${segId}`
          const [hr, hg, hb] = hexToRgb01(nfHal.color)
          const thresh = Math.min(0.9, Math.max(0.1, nfHal.threshold / 100)).toFixed(2)
          const sigma = (height * (0.006 + 0.022 * (nfHal.radius / 100))).toFixed(2)
          const opacity = Math.min(1, (nfHal.intensity / 100) * (nfHal.blend / 100) * nfInt * 0.9).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(
            `[${b}]curves=all='0/0 ${thresh}/0 1/1',gblur=sigma=${sigma},colorchannelmixer=rr=${hr.toFixed(2)}:gg=${hg.toFixed(2)}:bb=${hb.toFixed(2)}[${g}]`
          )
          filterParts.push(
            `[${a}][${g}]blend=all_mode=screen:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        if (hasNfBlm && nfBlm) {
          const a = `nfblm_a${segId}`
          const b = `nfblm_b${segId}`
          const g = `nfblm_g${segId}`
          const out = `nfblm_o${segId}`
          const thresh = Math.min(0.9, Math.max(0.15, nfBlm.threshold / 100)).toFixed(2)
          const sigma = (height * (0.005 + 0.02 * (nfBlm.radius / 100))).toFixed(2)
          const opacity = Math.min(1, (nfBlm.intensity / 100) * (0.5 + 0.5 * (nfBlm.highlightStrength / 100)) * nfInt).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(`[${b}]curves=all='0/0 ${thresh}/0 1/1',gblur=sigma=${sigma}[${g}]`)
          filterParts.push(
            `[${a}][${g}]blend=all_mode=screen:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        if (hasNfDif && nfDif) {
          const a = `nfdif_a${segId}`
          const b = `nfdif_b${segId}`
          const g = `nfdif_g${segId}`
          const out = `nfdif_o${segId}`
          const sigma = (height * (0.004 + 0.014 * (nfDif.softness / 100))).toFixed(2)
          const opacity = Math.min(0.85, (nfDif.strength / 100) * nfInt * 0.55).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(`[${b}]gblur=sigma=${sigma}[${g}]`)
          filterParts.push(
            `[${a}][${g}]blend=all_mode=lighten:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        if (hasNfMst && nfMst) {
          const a = `nfmst_a${segId}`
          const b = `nfmst_b${segId}`
          const g = `nfmst_g${segId}`
          const out = `nfmst_o${segId}`
          const sigma = (height * (0.006 + 0.018 * (nfMst.highlightSpread / 100))).toFixed(2)
          const opacity = Math.min(0.85, (nfMst.intensity / 100) * nfInt * 0.6).toFixed(3)
          filterParts.push(`[${cur}]split=2[${a}][${b}]`)
          filterParts.push(`[${b}]curves=all='0/0 0.30/0.08 1/1',gblur=sigma=${sigma}[${g}]`)
          filterParts.push(
            `[${a}][${g}]blend=all_mode=screen:all_opacity=${opacity},format=rgb24[${out}]`
          )
          cur = out
        }
        fxOutLabel = cur
      }

      if ((c.grade.vignette ?? 0) > 0.5) {
        const angle = ((Math.PI / 4) * Math.min(100, c.grade.vignette)) / 100
        vChain.push(`vignette=angle=${angle.toFixed(4)}`)
      }
      const tex = nf?.texture
      const nfGrainStrength =
        tex?.enabled && (tex.amount ?? 0) > 0.5 && nfInt > 0.01
          ? Math.round(((tex.amount ?? 0) / 100) * (0.5 + (tex.strength ?? 50) / 100) * nfInt * 20)
          : 0
      const combinedGrain = Math.max(
        (c.grade.filmGrain ?? 0) > 0.5
          ? Math.max(1, Math.round((Math.min(100, c.grade.filmGrain) / 100) * 26))
          : 0,
        nfGrainStrength
      )
      if (combinedGrain > 0) {
        const flags = (tex?.colorGrain ?? 0) > 30 ? 't+u' : 't'
        vChain.push(`noise=alls=${combinedGrain}:allf=${flags}`)
      }
      const ck = nf?.chromaKey
      if (ck?.enabled) {
        const hexClean = ck.keyColor.replace('#', '').trim() || '00B140'
        const sim = Math.max(0.01, Math.min(0.85, (ck.tolerance || 30) / 100)).toFixed(3)
        const bln = Math.max(0.0, Math.min(0.6, (ck.edgeSoftness || 15) / 100)).toFixed(3)
        vChain.push(`colorkey=0x${hexClean}:${sim}:${bln}`)
        if (c.lane === 'V1') {
          const bgHex = (ck.bgColor || '#0B0D12').replace('#', '').trim() || '0B0D12'
          const ckPre = `vck_pre_${segId}`
          const ckFg = `vck_fg_${segId}`
          const ckBg0 = `vck_bg0_${segId}`
          const ckBg = `vck_bg_${segId}`
          const ckOut = `vck_out_${segId}`
          const srcLbl = fxOutLabel ? `[${fxOutLabel}]` : `[${inIdx}:v]`
          filterParts.push(`${srcLbl}${vChain.join(',')},format=rgba[${ckPre}]`)
          vChain.length = 0
          filterParts.push(`[${ckPre}]split=2[${ckFg}][${ckBg0}]`)
          filterParts.push(
            `[${ckBg0}]drawbox=x=0:y=0:w=iw:h=ih:color=0x${bgHex}:t=fill,format=rgba[${ckBg}]`
          )
          filterParts.push(`[${ckBg}][${ckFg}]overlay=x=0:y=0:format=auto[${ckOut}]`)
          fxOutLabel = ckOut
        }
      }
    }

    return {
      streamLabel: fxOutLabel ? `[${fxOutLabel}]` : `[${inIdx}:v]`,
      pendingChain: vChain
    }
  }

  // 1) V1 Ana Video akışı (sıralı taban katmanı)
  const v1Audible = isLaneAudible(lanes, 'V1')
  const vClips = v1Audible
    ? clips
        .filter((c) => c.lane === 'V1' && !isCreditClip(c) && c.duration > 0.02)
        .sort((a, b) => a.start - b.start)
    : []

  const vSegLabels: string[] = []
  let cursor = 0
  let segCounter = 0
  // 1 kareden küçük mikro kayan nokta farkları için siyah kare üretme (kesintisiz birleştirme)
  const minGapSec = Math.max(0.045, 0.95 / Math.max(1, fps))

  for (const c of vClips) {
    if (c.start > cursor + minGapSec) {
      const gap = c.start - cursor
      const lbl = `vseg${segCounter++}`
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${gap.toFixed(4)},format=yuv420p[${lbl}]`
      )
      vSegLabels.push(`[${lbl}]`)
      cursor = c.start
    }
    const segId = segCounter++
    const lbl = `vseg${segId}`
    const { streamLabel: initialLabel, pendingChain: vChain } = buildClipGradedVideoStream(c, segId)

    // Transform & Keyframe Animasyonu (Scale, Position X/Y, Rotation, Opacity)
    const hasKeyframes = (c.keyframes?.length ?? 0) > 0
    const tf = c.transform
    let streamLabel = initialLabel

    if (hasKeyframes) {
      const preLbl = `vpre${segId}`
      filterParts.push(`${streamLabel}${vChain.length ? vChain.join(',') : 'null'}[${preLbl}]`)
      vChain.length = 0

      const bg0Lbl = `vbg0_${segId}`
      const fg0Lbl = `vfg0_${segId}`
      const bgLbl = `vbg_${segId}`
      const fgLbl = `vfg_${segId}`
      const ovLbl = `vov_kf_${segId}`

      filterParts.push(`[${preLbl}]split=2[${bg0Lbl}][${fg0Lbl}]`)
      filterParts.push(
        `[${bg0Lbl}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[${bgLbl}]`
      )

      const scaleExpr = buildFfmpegKeyframeExpr(c, 'scale', 't')
      const posXExpr = buildFfmpegKeyframeExpr(c, 'posX', 't')
      const posYExpr = buildFfmpegKeyframeExpr(c, 'posY', 't')
      const rotExpr = buildFfmpegKeyframeExpr(c, 'rotation', 't')
      const hasRotKf =
        getParamKeyframes(c, 'rotation').length > 0 || Math.abs(tf?.rotation ?? 0) > 0.25

      const fgChain: string[] = [
        `format=rgba`,
        `scale=w='max(16,trunc(${width}*clip((${scaleExpr})/100,0.1,4.0)/2)*2)':h='max(16,trunc(${height}*clip((${scaleExpr})/100,0.1,4.0)/2)*2)':eval=frame`
      ]
      if (hasRotKf) {
        fgChain.push(`rotate=a='((${rotExpr})*PI/180)':ow=iw:oh=ih:c=0x00000000`)
      }
      filterParts.push(`[${fg0Lbl}]${fgChain.join(',')}[${fgLbl}]`)
      filterParts.push(
        `[${bgLbl}][${fgLbl}]overlay=x='(W-w)/2+(W*(${posXExpr})/100)':y='(H-h)/2+(H*(${posYExpr})/100)':eval=frame:format=auto[${ovLbl}]`
      )
      streamLabel = `[${ovLbl}]`

      const hasOpKf = getParamKeyframes(c, 'opacity').length > 0
      if (hasOpKf) {
        const opExprT = buildFfmpegKeyframeExpr(c, 'opacity', 'T')
        const opA = `vopa_${segId}`
        const opB0 = `vopb0_${segId}`
        const opB = `vopb_${segId}`
        const opOut = `vopout_${segId}`
        filterParts.push(`${streamLabel}format=rgb24,split=2[${opA}][${opB0}]`)
        filterParts.push(`[${opB0}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[${opB}]`)
        filterParts.push(
          `[${opA}][${opB}]blend=all_expr='A*clip((${opExprT})/100,0,1)'[${opOut}]`
        )
        streamLabel = `[${opOut}]`
      } else if ((tf?.opacity ?? 100) < 99.5) {
        const op = Math.max(0, Math.min(1, (tf?.opacity ?? 100) / 100))
        vChain.push(`colorchannelmixer=rr=${op.toFixed(3)}:gg=${op.toFixed(3)}:bb=${op.toFixed(3)}`)
      }
    } else if (tf) {
      const sc = Math.max(0.1, Math.min(4.0, (tf.scale ?? 100) / 100))
      const px = ((tf.posX ?? 0) / 100) * width
      const py = ((tf.posY ?? 0) / 100) * height
      const rotRad = ((tf.rotation ?? 0) * Math.PI) / 180
      const op = Math.max(0, Math.min(1, (tf.opacity ?? 100) / 100))

      if (Math.abs(sc - 1) > 0.01 || Math.abs(px) > 0.5 || Math.abs(py) > 0.5) {
        const sw = Math.max(16, Math.round((width * sc) / 2) * 2)
        const sh = Math.max(16, Math.round((height * sc) / 2) * 2)
        vChain.push(`scale=${sw}:${sh}`)
        if (sc >= 1) {
          const cx = Math.max(0, Math.min(sw - width, Math.round((sw - width) / 2 - px)))
          const cy = Math.max(0, Math.min(sh - height, Math.round((sh - height) / 2 - py)))
          vChain.push(`crop=${width}:${height}:${cx}:${cy}`)
        } else {
          const padX = Math.max(0, Math.min(width - sw, Math.round((width - sw) / 2 + px)))
          const padY = Math.max(0, Math.min(height - sh, Math.round((height - sh) / 2 + py)))
          vChain.push(`pad=${width}:${height}:${padX}:${padY}:black`)
        }
      }
      if (Math.abs(rotRad) > 0.005) {
        vChain.push(`rotate=${rotRad.toFixed(4)}:ow=${width}:oh=${height}:c=black`)
      }
      if (op < 0.995) {
        vChain.push(`colorchannelmixer=rr=${op.toFixed(3)}:gg=${op.toFixed(3)}:bb=${op.toFixed(3)}`)
      }
    }

    // Geçiş Efektleri (Cross Dissolve / Dip to Black)
    if (c.transitionType && c.transitionType !== 'none' && (c.transitionDuration ?? 0) > 0.05) {
      const trDur = Math.min(c.duration * 0.48, c.transitionDuration ?? 0.8)
      const foStart = Math.max(0, c.duration - trDur)
      vChain.push(
        `fade=t=in:st=0:d=${trDur.toFixed(4)}:color=black`,
        `fade=t=out:st=${foStart.toFixed(4)}:d=${trDur.toFixed(4)}:color=black`
      )
    }

    vChain.push(`trim=duration=${c.duration.toFixed(4)}`, `setpts=PTS-STARTPTS`, `format=yuv420p`)
    filterParts.push(`${streamLabel}${vChain.join(',')}[${lbl}]`)
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

  // 1a-b) Üst Video Kanalları (V2, V3...) Video/Görsel Bindirme (Overlay & PiP)
  const upperVideoLanes = getOrderedVideoLanesAsc(lanes, clips).filter((l) => l !== 'V1')
  let currentVLabel = '[vbase]'
  let ovCounter = 0

  for (const laneId of upperVideoLanes) {
    if (!isLaneAudible(lanes, laneId)) continue
    const laneClips = clips
      .filter((c) => c.lane === laneId && !isCreditClip(c) && c.duration > 0.02)
      .sort((a, b) => a.start - b.start)

    for (const c of laneClips) {
      const segId = segCounter++
      const { streamLabel, pendingChain } = buildClipGradedVideoStream(c, segId)
      const ovIdx = ovCounter++
      const fgLbl = `vupper${ovIdx}`
      const nextVLabel = `[vcomp${ovIdx}]`

      const hasKeyframes = (c.keyframes?.length ?? 0) > 0
      const tf = c.transform
      const chain: string[] = [...pendingChain, `trim=duration=${c.duration.toFixed(4)}`, `format=rgba`]

      if (hasKeyframes) {
        const scaleExpr = buildFfmpegKeyframeExpr(c, 'scale', 't')
        const rotExpr = buildFfmpegKeyframeExpr(c, 'rotation', 't')
        chain.push(
          `scale=w='max(16,trunc(${width}*clip((${scaleExpr})/100,0.1,4.0)/2)*2)':h='max(16,trunc(${height}*clip((${scaleExpr})/100,0.1,4.0)/2)*2)':eval=frame`
        )
        if (getParamKeyframes(c, 'rotation').length > 0 || Math.abs(tf?.rotation ?? 0) > 0.25) {
          chain.push(`rotate=a='((${rotExpr})*PI/180)':ow=iw:oh=ih:c=0x00000000`)
        }
      } else if (tf) {
        const sc = Math.max(0.1, Math.min(4.0, (tf.scale ?? 100) / 100))
        if (Math.abs(sc - 1) > 0.01) {
          const sw = Math.max(16, Math.round((width * sc) / 2) * 2)
          const sh = Math.max(16, Math.round((height * sc) / 2) * 2)
          chain.push(`scale=${sw}:${sh}`)
        }
        const rotRad = ((tf.rotation ?? 0) * Math.PI) / 180
        if (Math.abs(rotRad) > 0.005) {
          chain.push(`rotate=${rotRad.toFixed(4)}:ow=iw:oh=ih:c=0x00000000`)
        }
        const op = Math.max(0, Math.min(1, (tf.opacity ?? 100) / 100))
        if (op < 0.995) {
          chain.push(`colorchannelmixer=aa=${op.toFixed(3)}`)
        }
      }

      if (c.transitionType && c.transitionType !== 'none' && (c.transitionDuration ?? 0) > 0.05) {
        const trDur = Math.min(c.duration * 0.48, c.transitionDuration ?? 0.8)
        const foStart = Math.max(0, c.duration - trDur)
        chain.push(
          `fade=t=in:st=0:d=${trDur.toFixed(4)}:alpha=1`,
          `fade=t=out:st=${foStart.toFixed(4)}:d=${trDur.toFixed(4)}:alpha=1`
        )
      }

      chain.push(`setpts=PTS-STARTPTS+${c.start.toFixed(4)}/TB`)
      filterParts.push(`${streamLabel}${chain.join(',')}[${fgLbl}]`)

      const start = c.start.toFixed(4)
      const end = (c.start + c.duration).toFixed(4)
      if (hasKeyframes) {
        const posXExpr = buildFfmpegKeyframeExpr(c, 'posX', `(t-${start})`)
        const posYExpr = buildFfmpegKeyframeExpr(c, 'posY', `(t-${start})`)
        filterParts.push(
          `${currentVLabel}[${fgLbl}]overlay=x='(W-w)/2+(W*(${posXExpr})/100)':y='(H-h)/2+(H*(${posYExpr})/100)':eof_action=pass:enable='between(t,${start},${end})':format=auto${nextVLabel}`
        )
      } else {
        const px = (((tf?.posX ?? 0) / 100) * width).toFixed(2)
        const py = (((tf?.posY ?? 0) / 100) * height).toFixed(2)
        filterParts.push(
          `${currentVLabel}[${fgLbl}]overlay=x='(W-w)/2+(${px})':y='(H-h)/2+(${py})':eof_action=pass:enable='between(t,${start},${end})':format=auto${nextVLabel}`
        )
      }
      currentVLabel = nextVLabel
    }
  }

  // 1b) Jenerik / Metin Overlay katmanı (tüm duyulabilir V* kanallarındaki metin klipleri)
  const v2Clips = clips
    .filter(
      (c) =>
        isVideoLane(c.lane) &&
        isCreditClip(c) &&
        isLaneAudible(lanes, c.lane) &&
        c.duration > 0.02 &&
        creditOverlays?.[c.id]
    )
    .sort((a, b) => laneNumber(a.lane) - laneNumber(b.lane) || a.start - b.start)

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

  // 1c) Altyazı (Burn-In Subtitles) PNG katmanları
  const subtitleOverlays =
    settings.burnInSubtitles !== false && Array.isArray(req.subtitleOverlays)
      ? req.subtitleOverlays
      : []
  subtitleOverlays.forEach((sub, idx) => {
    const startSec = Math.max(0, sub.start - rangeOffset)
    const endSec = Math.min(total, sub.end - rangeOffset)
    if (endSec <= startSec + 0.02 || !sub.pngDataUrl) return
    const b64 = sub.pngDataUrl.replace(/^data:image\/png;base64,/, '')
    if (!tempLutDir) tempLutDir = mkdtempSync(join(tmpdir(), 'noircut-lut-'))
    const pngPath = join(tempLutDir, `sub-${idx}.png`)
    writeFileSync(pngPath, Buffer.from(b64, 'base64'))

    const inIdx = nextInputIdx++
    inputArgs.push('-loop', '1', '-t', total.toFixed(4), '-i', pngPath)

    const sStr = startSec.toFixed(4)
    const eStr = endSec.toFixed(4)
    const subLbl = `sub${idx}`
    const nextVLabel = `[vsub${idx}]`
    filterParts.push(`[${inIdx}:v]format=rgba[${subLbl}]`)
    filterParts.push(
      `${currentVLabel}[${subLbl}]overlay=x=0:y=0:enable='between(t,${sStr},${eStr})'${nextVLabel}`
    )
    currentVLabel = nextVLabel
  })

  filterParts.push(`${currentVLabel}format=yuv420p[vout]`)

  // 2) Ses akışı (V* gömülü + A1..An) + Auto-Ducking (Diyalog Önceliği)
  const audibleClips: TimelineClip[] = clips.filter((c) => {
    if (isCreditClip(c) || c.duration <= 0.02 || c.gainDb <= MIN_DB) return false
    if (isVideoLane(c.lane) && c.audioDetached) return false
    if (!isLaneAudible(lanes, c.lane)) return false
    const m = getMediaItem(c.mediaId)
    return Boolean(m?.hasAudio)
  })

  const dialogClips = req.autoDucking
    ? audibleClips.filter((c) => isVideoLane(c.lane) || c.lane === 'A1')
    : []

  filterParts.push(
    `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(4)},asetpts=PTS-STARTPTS[abase]`
  )

  const aLabels: string[] = ['[abase]']
  audibleClips.forEach((c, idx) => {
    const inIdx = mediaInputIdx.get(c.mediaId)!
    const gain = dbToGain(c.gainDb)
    const speedFactor = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
    const srcDur = Math.max(0.05, c.duration * speedFactor)

    const chain: string[] = [
      `atrim=start=${c.in.toFixed(4)}:duration=${srcDur.toFixed(4)}`,
      `asetpts=PTS-STARTPTS`
    ]
    if (c.reverse) {
      chain.push('areverse')
    }
    // FFmpeg atempo (0.5..2.0 aralığında zincirleme)
    if (Math.abs(speedFactor - 1.0) > 0.01) {
      let rem = speedFactor
      while (rem < 0.5) {
        chain.push('atempo=0.5')
        rem /= 0.5
      }
      while (rem > 2.0) {
        chain.push('atempo=2.0')
        rem /= 2.0
      }
      if (Math.abs(rem - 1.0) > 0.01) {
        chain.push(`atempo=${rem.toFixed(4)}`)
      }
    }

    chain.push(
      `aresample=48000`,
      `aformat=sample_fmts=fltp:channel_layouts=stereo`,
      `volume=${gain.toFixed(6)}`
    )

    // Pan (Sol/Sağ Denge: -100..+100)
    const panVal = Math.max(-100, Math.min(100, c.pan ?? 0)) / 100
    if (Math.abs(panVal) > 0.01) {
      const lGain = panVal > 0 ? 1 - panVal : 1
      const rGain = panVal < 0 ? 1 + panVal : 1
      chain.push(`pan=stereo|c0=${lGain.toFixed(3)}*c0|c1=${rGain.toFixed(3)}*c1`)
    }

    // Ses Efekt Ön Ayarı (Denoise / Bass Boost) + Profesyonel Audio Effects Chain
    if (c.audioPreset === 'denoise' || c.audioEffects?.noiseReduction) {
      chain.push('highpass=f=85', 'lowpass=f=11500')
    } else if (c.audioPreset === 'bass-boost') {
      chain.push('bass=g=7:f=100:w=0.6')
    }
    if (c.audioEffects) {
      const fx = c.audioEffects
      if (Math.abs(fx.eqLowDb) > 0.1) {
        chain.push(`equalizer=f=100:t=h:w=120:g=${fx.eqLowDb.toFixed(1)}`)
      }
      if (Math.abs(fx.eqMidDb) > 0.1) {
        chain.push(`equalizer=f=1000:t=q:w=1.2:g=${fx.eqMidDb.toFixed(1)}`)
      }
      if (Math.abs(fx.eqHighDb) > 0.1) {
        chain.push(`equalizer=f=8000:t=h:w=2500:g=${fx.eqHighDb.toFixed(1)}`)
      }
      if (fx.compressorEnabled) {
        const threshLin = Math.max(0.01, Math.min(1, Math.pow(10, fx.compressorThresholdDb / 20)))
        const ratio = Math.max(1, Math.min(20, fx.compressorRatio))
        chain.push(`acompressor=threshold=${threshLin.toFixed(4)}:ratio=${ratio.toFixed(1)}:attack=15:release=180`)
      }
      if (fx.reverbMix > 1) {
        const outG = Math.max(0.3, 1 - (fx.reverbMix / 100) * 0.35).toFixed(2)
        const dec = Math.max(0.05, Math.min(0.85, (fx.reverbMix / 100) * 0.65)).toFixed(2)
        chain.push(`aecho=0.8:${outG}:60|110:${dec}|${(Number(dec) * 0.7).toFixed(2)}`)
      }
      if (fx.limiterEnabled) {
        const limLin = Math.max(0.1, Math.min(1, Math.pow(10, fx.limiterCeilingDb / 20)))
        chain.push(`alimiter=limit=${limLin.toFixed(4)}:level=disabled`)
      }
    }

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

    // Auto-Ducking: V*/A1 aktifken diğer ses kanallarını (A2+) yumuşat (%28 = -11 dB)
    if (isAudioLane(c.lane) && c.lane !== 'A1' && dialogClips.length > 0) {
      const betweenTerms = dialogClips
        .map((dc) => `between(t,${dc.start.toFixed(4)},${(dc.start + dc.duration).toFixed(4)})`)
        .join('+')
      chain.push(`volume=volume='if(gt(${betweenTerms},0),0.28,1.0)':eval=frame`)
    }

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

  const masterGain =
    typeof req.masterGainDb === 'number' && Math.abs(req.masterGainDb) > 0.05
      ? dbToGain(req.masterGainDb)
      : 1
  const masterVolFilter =
    Math.abs(masterGain - 1) > 0.01 ? `,volume=${masterGain.toFixed(4)}` : ''

  if (aLabels.length === 1) {
    filterParts.push(`[abase]anull${masterVolFilter}[aout]`)
  } else {
    filterParts.push(
      `${aLabels.join('')}amix=inputs=${aLabels.length}:duration=first:dropout_transition=0:normalize=0${masterVolFilter}[aout]`
    )
  }

  const engine = await getEngineInfo()
  const baseBin = resolveExportFfmpegPath(engine.ffmpegPath)

  const avail = engine.availableEncoders ?? ['libx264']
  const reqEnc = settings.encoder ?? 'auto'
  const wantHevcCodec = settings.codec === 'h265'
  const hwEncoder: VideoEncoderId =
    reqEnc === 'auto'
      ? wantHevcCodec
        ? (avail.find((e) => e === 'hevc_nvenc') ??
          (avail.includes('libx265') ? 'libx265' : 'libx264'))
        : (avail.find(
            (e) =>
              e === 'h264_nvenc' ||
              e === 'h264_vaapi' ||
              e === 'h264_qsv' ||
              e === 'h264_amf'
          ) ?? 'libx264')
      : avail.includes(reqEnc)
        ? reqEnc
        : 'libx264'

  const buildArgsForEncoder = (enc: VideoEncoderId): { bin: string; args: string[] } => {
    const isVaapi = enc === 'h264_vaapi'
    const parts = isVaapi
      ? [...filterParts, '[vout]format=nv12,hwupload[vout_hw]']
      : filterParts
    const vMap = isVaapi ? '[vout_hw]' : '[vout]'
    const bin = enc !== 'libx264' && engine.gpuFfmpegPath ? engine.gpuFfmpegPath : baseBin

    const preArgs: string[] = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats']
    if (isVaapi) {
      preArgs.push('-vaapi_device', '/dev/dri/renderD128')
    }

    const wantHevc = settings.codec === 'h265' || enc === 'libx265' || enc === 'hevc_nvenc'
    const vBitrateArgs =
      settings.videoBitrateMbps && settings.videoBitrateMbps > 0
        ? [
            '-b:v',
            `${settings.videoBitrateMbps}M`,
            '-maxrate',
            `${Math.round(settings.videoBitrateMbps * 1.35)}M`,
            '-bufsize',
            `${Math.round(settings.videoBitrateMbps * 2)}M`
          ]
        : []
    const aBitrateStr = `${settings.audioBitrateKbps ?? 192}k`

    const cpuThreads = String(Math.max(2, cpus().length - 2))
    const vCodecArgs =
      enc === 'hevc_nvenc' || (wantHevc && enc === 'h264_nvenc')
        ? ['-c:v', 'hevc_nvenc', '-preset', 'p4', '-cq', crf, ...vBitrateArgs, '-pix_fmt', 'yuv420p']
        : enc === 'libx265' || (wantHevc && enc === 'libx264')
          ? ['-c:v', 'libx265', '-preset', preset, '-crf', crf, '-threads', cpuThreads, ...vBitrateArgs, '-pix_fmt', 'yuv420p']
          : enc === 'h264_nvenc'
            ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', crf, ...vBitrateArgs, '-pix_fmt', 'yuv420p']
            : enc === 'h264_vaapi'
              ? ['-c:v', 'h264_vaapi', '-qp', crf, ...vBitrateArgs]
              : enc === 'h264_qsv'
                ? ['-c:v', 'h264_qsv', '-global_quality', crf, ...vBitrateArgs, '-pix_fmt', 'yuv420p']
                : enc === 'h264_amf'
                  ? ['-c:v', 'h264_amf', '-quality', 'balanced', '-qp_i', crf, '-qp_p', crf, ...vBitrateArgs, '-pix_fmt', 'yuv420p']
                  : ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-threads', cpuThreads, ...vBitrateArgs, '-pix_fmt', 'yuv420p']

    return {
      bin,
      args: [
        ...preArgs,
        ...inputArgs,
        '-filter_complex',
        parts.join(';'),
        '-map',
        vMap,
        '-map',
        '[aout]',
        '-t',
        total.toFixed(4),
        ...vCodecArgs,
        '-c:a',
        'aac',
        '-b:a',
        aBitrateStr,
        '-ar',
        '48000',
        '-movflags',
        '+faststart',
        '-f',
        ext === 'mov' ? 'mov' : 'mp4',
        tempOutPath
      ]
    }
  }

  const tempOutPath = `${outPath}.part-${process.pid}-${Date.now()}.${ext}`
  const cleanupTempOut = () => {
    try {
      if (existsSync(tempOutPath)) rmSync(tempOutPath, { force: true })
    } catch {
      // yoksay
    }
  }
  const commitTempToFinal = () => {
    try {
      renameSync(tempOutPath, outPath)
    } catch {
      if (process.platform === 'win32' && existsSync(outPath)) {
        try {
          rmSync(outPath, { force: true })
          renameSync(tempOutPath, outPath)
          return
        } catch {
          // copy fallback
        }
      }
      copyFileSync(tempOutPath, outPath)
      cleanupTempOut()
    }
  }

  const runSpawn = (bin: string, args: string[]): Promise<ExportResult> =>
    new Promise((resolvePromise) => {
      cleanupTempOut()
      const proc = spawn(bin, args, {
        ...(tempLutDir ? { cwd: tempLutDir } : {}),
        windowsHide: true
      })
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
        if (signal === 'SIGTERM') {
          cleanupTempOut()
          resolvePromise({ ok: false, canceled: true })
        } else if (code === 0 && existsSync(tempOutPath)) {
          try {
            commitTempToFinal()
            sendProgress(win, 100, true)
            resolvePromise({ ok: true, path: outPath })
          } catch (moveErr) {
            cleanupTempOut()
            resolvePromise({
              ok: false,
              error: moveErr instanceof Error ? moveErr.message : String(moveErr)
            })
          }
        } else {
          cleanupTempOut()
          resolvePromise({
            ok: false,
            error: stderr.trim() || `FFmpeg çıkış kodu: ${code}`
          })
        }
      })
      proc.on('error', (err) => {
        activeProc = null
        cleanupTempOut()
        resolvePromise({ ok: false, error: err.message })
      })
    })

  sendProgress(win, 0, true)

  try {
    const primary = buildArgsForEncoder(hwEncoder)
    let result = await runSpawn(primary.bin, primary.args)
    if (!result.ok && !result.canceled && hwEncoder !== 'libx264') {
      const cpuFallback = buildArgsForEncoder('libx264')
      result = await runSpawn(cpuFallback.bin, cpuFallback.args)
    }
    return result
  } finally {
    if (tempLutDir) {
      try {
        rmSync(tempLutDir, { recursive: true, force: true })
      } catch {
        // yoksay
      }
      tempLutDir = null
    }
  }
}
