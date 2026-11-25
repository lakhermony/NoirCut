import type { SubtitleExportOverlay, TimelineClip } from '../../shared/timeline'
import { effectiveAverageSpeedFactor } from '../../shared/timeline'

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
