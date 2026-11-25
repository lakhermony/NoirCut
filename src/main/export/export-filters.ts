import type { SubtitleExportOverlay, TimelineClip } from '../../shared/timeline'
import { effectiveAverageSpeedFactor } from '../../shared/timeline'
import {
  HALATION_GAIN,
  HALATION_TINT,
  analogGrainParams,
  analogHalationParams,
  isAnalogGrainActive,
  isAnalogHalationActive,
  type AnalogFilmConfig
} from '../../shared/analog-film'

/**
 * FFmpeg filtergraph dosya yolu kaçışı (ör. lut3d=file=...:interp=trilinear).
 * FFmpeg iki aşamalı (filtergraph + option) ayrıştırma yaptığı için
 * tek tırnak ve iki nokta üst üste `\\\'` / `\\\:` olarak, ayırıcılar ve boşluk `\` ile kaçırılır.
 */
export function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/([':])/g, '\\\\\\$1')
    .replace(/([,;\[\] ])/g, '\\$1')
}

/**
 * FFmpeg drawtext=text='...' için düşmanca girdi güvenli kaçış fonksiyonu.
 * Tek tırnak ('\''), backslash, iki nokta, yüzde (%%), virgül, noktalı virgül,
 * köşeli parantez ve satır sonlarını güvenli biçimde kaçırır.
 */
export function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

export interface ClipSpeedFilterResult {
  speedFactor: number
  srcDuration: number
  trimFilter: string
  setptsFilter: string
}

export function buildClipSpeedFilter(
  clip: TimelineClip,
  isImage = false
): ClipSpeedFilterResult {
  const speedFactor = effectiveAverageSpeedFactor(clip)
  const srcDuration = Math.max(0.05, clip.duration * speedFactor)
  const clipIn = isImage ? 0 : clip.in
  return {
    speedFactor,
    srcDuration,
    trimFilter: `trim=start=${clipIn.toFixed(4)}:duration=${srcDuration.toFixed(4)}`,
    setptsFilter: `setpts=(PTS-STARTPTS)/${speedFactor.toFixed(4)}`
  }
}

export interface MaskFilterResult {
  appliedAsPostChain: boolean
  inlineVignetteFilter?: string
  filterParts: string[]
}

export function buildClipMaskFilter(
  clip: TimelineClip,
  streamLabel: string,
  vChain: string[],
  outLabel: string,
  segId: number,
  width: number,
  height: number
): MaskFilterResult {
  if (!clip.mask?.enabled) {
    return { appliedAsPostChain: false, filterParts: [] }
  }
  const m = clip.mask
  const strength = Math.max(5, Math.min(100, m.strength ?? 65))
  if (m.mode === 'vignette') {
    return {
      appliedAsPostChain: false,
      inlineVignetteFilter: `vignette=angle=${((strength / 100) * 1.25).toFixed(3)}`,
      filterParts: []
    }
  }

  const cw = Math.max(16, Math.round(((m.w ?? 32) / 100) * width) & ~1)
  const ch = Math.max(16, Math.round(((m.h ?? 32) / 100) * height) & ~1)
  const cx = Math.max(0, Math.min(width - cw, Math.round(((m.x ?? 50) / 100) * width - cw / 2)))
  const cy = Math.max(0, Math.min(height - ch, Math.round(((m.y ?? 50) / 100) * height - ch / 2)))
  const pre = `mpre${segId}`
  const bg = `mbg${segId}`
  const fg = `mfg${segId}`
  const fx = `mfx${segId}`
  const chainWithTrim = [
    ...vChain,
    `trim=duration=${clip.duration.toFixed(4)}`,
    `setpts=PTS-STARTPTS`,
    `format=yuv420p`
  ]
  const maxLumaRadius = Math.max(2, Math.floor(Math.min(cw, ch) / 2) - 1)
  const lumaRadius = Math.min(maxLumaRadius, Math.max(2, Math.round((strength / 100) * 28)))
  const chromaRadius = Math.max(1, Math.min(lumaRadius, Math.floor(Math.min(cw, ch) / 4) - 1))
  const blurFilter =
    m.mode === 'mosaic'
      ? `scale=w=max(4\\,${Math.round(cw / Math.max(4, Math.round(strength / 4)))}):h=-1:flags=neighbor,scale=${cw}:${ch}:flags=neighbor`
      : `boxblur=${lumaRadius}:2:${chromaRadius}:2`

  return {
    appliedAsPostChain: true,
    filterParts: [
      `${streamLabel}${chainWithTrim.join(',')}[${pre}]`,
      `[${pre}]split[${bg}][${fg}]`,
      `[${fg}]crop=${cw}:${ch}:${cx}:${cy},${blurFilter}[${fx}]`,
      `[${bg}][${fx}]overlay=${cx}:${cy}[${outLabel}]`
    ]
  }
}

export function selectSubtitleOverlays(
  burnInSubtitles: boolean | undefined,
  overlays: SubtitleExportOverlay[] | undefined
): SubtitleExportOverlay[] {
  return burnInSubtitles !== false && Array.isArray(overlays) ? overlays : []
}

export function buildSubtitleOverlayFilter(
  currentVLabel: string,
  inputIdx: number,
  idx: number,
  startSec: number,
  endSec: number
): { nextVLabel: string; filterParts: string[] } {
  const sStr = startSec.toFixed(4)
  const eStr = endSec.toFixed(4)
  const subLbl = `sub${idx}`
  const nextVLabel = `[vsub${idx}]`
  return {
    nextVLabel,
    filterParts: [
      `[${inputIdx}:v]format=rgba[${subLbl}]`,
      `${currentVLabel}[${subLbl}]overlay=x=0:y=0:enable='between(t,${sStr},${eStr})'${nextVLabel}`
    ]
  }
}

/**
 * Analog Film Pass (Physical Halation + Luminance-Aware Film Grain) için FFmpeg filtre grafiği.
 * WebGL2 shader ile aynı sabitleri/matematiği kullanır (src/shared/analog-film.ts):
 *  - Halation: curves(eşik) → gblur → kırmızı-turuncu tint → screen
 *  - Grain: animasyonlu gri gürültü katmanı; maskedmerge ile luma ağırlıklı (gölgede güçlü, highlight'ta zayıf)
 */
export function buildAnalogFilmFilters(opts: {
  inLabel: string
  segId: number | string
  analog: AnalogFilmConfig
  width: number
  height: number
  fps: number
  duration: number
}): { parts: string[]; outLabel: string } {
  const { analog, width, height, fps, segId } = opts
  const parts: string[] = []
  let cur = opts.inLabel

  if (isAnalogHalationActive(analog)) {
    const hp = analogHalationParams(analog)
    const a = `an_ha${segId}`
    const b = `an_hb${segId}`
    const g = `an_hg${segId}`
    const out = `an_ho${segId}`
    const sigma = Math.max(0.5, height * hp.sigmaFrac).toFixed(2)
    const [tr, tg, tb] = HALATION_TINT
    parts.push(`[${cur}]split=2[${a}][${b}]`)
    parts.push(
      `[${b}]curves=all='0/0 ${hp.threshold.toFixed(3)}/0 1/1',gblur=sigma=${sigma},` +
        `colorchannelmixer=rr=${(tr * HALATION_GAIN).toFixed(3)}:gg=${(tg * HALATION_GAIN).toFixed(3)}:bb=${(tb * HALATION_GAIN).toFixed(3)}[${g}]`
    )
    parts.push(`[${a}][${g}]blend=all_mode=screen:all_opacity=${hp.opacity.toFixed(3)},format=rgb24[${out}]`)
    cur = out
  }

  if (isAnalogGrainActive(analog)) {
    const gp = analogGrainParams(analog)
    const cell = Math.max(1, Math.round(gp.cellPx1080 * (height / 1080)))
    const nw = Math.max(2, Math.ceil(width / cell))
    const nh = Math.max(2, Math.ceil(height / cell))
    const strength = Math.max(1, Math.min(100, Math.round(gp.amplitude * 255)))
    const sg = (1 - gp.roughness) * cell * 0.6
    const up = gp.roughness > 0.5 ? 'neighbor' : 'bilinear'
    const b0 = `an_g0_${segId}`
    const b1 = `an_g1_${segId}`
    const b2 = `an_g2_${segId}`
    const nz = `an_nz${segId}`
    const noisy = `an_ny${segId}`
    const mask = `an_mk${segId}`
    const out = `an_go${segId}`
    const dur = (opts.duration + 0.5).toFixed(3)

    parts.push(`[${cur}]split=3[${b0}][${b1}][${b2}]`)
    parts.push(
      `color=c=0x808080:s=${nw}x${nh}:r=${fps}:d=${dur},format=gray,noise=alls=${strength}:allf=t+u,` +
        `scale=${width}:${height}:flags=${up}${sg >= 0.3 ? `,gblur=sigma=${sg.toFixed(2)}` : ''},format=gbrp[${nz}]`
    )
    parts.push(`[${b1}]format=gbrp[${b1}f]`)
    parts.push(`[${b1}f][${nz}]blend=all_expr='clip(A+(B-128),0,255)':shortest=1[${noisy}]`)
    parts.push(
      `[${b2}]format=gray,lut=y='clip(255*max(0.08,1-0.92*pow(val/255,2)),0,255)',format=gbrp[${mask}]`
    )
    parts.push(`[${b0}]format=gbrp[${b0}f]`)
    parts.push(`[${b0}f][${noisy}][${mask}]maskedmerge,format=rgb24[${out}]`)
    cur = out
  }

  return { parts, outLabel: cur }
}

export type LoudnessPreset = 'off' | 'youtube' | 'cinema'
export type AspectMaskPreset = 'none' | '2.39:1' | '1.85:1' | '9:16' | '4:3'

export const LOUDNESS_TARGETS: Record<
  Exclude<LoudnessPreset, 'off'>,
  { i: number; tp: number; lra: number }
> = {
  youtube: { i: -14, tp: -1.0, lra: 11 },
  cinema: { i: -24, tp: -2.0, lra: 11 }
}

export interface LoudnormMeasured {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

export function parseLoudnormJson(stderr: string): LoudnormMeasured | null {
  const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>
    if (
      typeof obj.input_i === 'string' &&
      typeof obj.input_tp === 'string' &&
      typeof obj.input_lra === 'string' &&
      typeof obj.input_thresh === 'string' &&
      typeof obj.target_offset === 'string'
    ) {
      return {
        input_i: obj.input_i,
        input_tp: obj.input_tp,
        input_lra: obj.input_lra,
        input_thresh: obj.input_thresh,
        target_offset: obj.target_offset
      }
    }
  } catch {
    // yoksay
  }
  return null
}

export function buildLoudnormPass2Filter(
  preset: Exclude<LoudnessPreset, 'off'>,
  measured: LoudnormMeasured | null
): string {
  const tgt = LOUDNESS_TARGETS[preset]
  if (!measured) {
    return `loudnorm=I=${tgt.i}:TP=${tgt.tp.toFixed(1)}:LRA=${tgt.lra}`
  }
  return (
    `loudnorm=I=${tgt.i}:TP=${tgt.tp.toFixed(1)}:LRA=${tgt.lra}:` +
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}:linear=true`
  )
}

/**
 * Seçilen en-boy oranı (2.39:1 / 1.85:1 / 9:16 / 4:3) için siyah letterbox/pillarbox maske filtresi üretir.
 */
export function buildAspectMaskFilter(
  preset: AspectMaskPreset | undefined,
  width: number,
  height: number
): string | null {
  if (!preset || preset === 'none') return null
  if (preset === '2.39:1' || preset === '1.85:1') {
    const ratio = preset === '2.39:1' ? 2.39 : 1.85
    const activeH = Math.min(height, Math.round(width / ratio) & ~1)
    const bar = Math.max(0, Math.floor((height - activeH) / 2))
    if (bar <= 1) return null
    return `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=${height - bar}:w=iw:h=${bar}:color=black:t=fill`
  }
  const ratio = preset === '9:16' ? 9 / 16 : 4 / 3
  const activeW = Math.min(width, Math.round(height * ratio) & ~1)
  const bar = Math.max(0, Math.floor((width - activeW) / 2))
  if (bar <= 1) return null
  return `drawbox=x=0:y=0:w=${bar}:h=ih:color=black:t=fill,drawbox=x=${width - bar}:y=0:w=${bar}:h=ih:color=black:t=fill`
}
