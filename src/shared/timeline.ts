/**
 * Timeline veri modeli ve ses matematiği.
 *
 * Bu dosya HEM önizleme (renderer) HEM de export (main) tarafından kullanılır.
 * Böylece ekranda duyduğunuz ses ile dışa aktarılan ses aynı formülden çıkar.
 * Saf fonksiyonlar içerir; Electron/DOM'a bağımlı değildir.
 */

import type { ColorGrade } from './color'
import type { CreditConfig } from './credits'
import type { Lut3D } from './lut'

export type LaneId = string
export const DEFAULT_VIDEO_LANES: LaneId[] = ['V2', 'V1']
export const DEFAULT_AUDIO_LANES: LaneId[] = ['A1', 'A2']
export const LANES: LaneId[] = ['V2', 'V1', 'A1', 'A2']
export const AUDIO_LANES: LaneId[] = ['A1', 'A2']

export function isVideoLane(id: LaneId): boolean {
  return /^V\d+$/i.test(id)
}

export function isAudioLane(id: LaneId): boolean {
  return /^A\d+$/i.test(id)
}

export function laneNumber(id: LaneId): number {
  const n = parseInt(id.slice(1), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function isCreditClip(c: { mediaId: string; credit?: unknown }): boolean {
  return c.mediaId === '__credit__' || Boolean(c.credit)
}

export function normalizeLanesMap(
  lanes?: LaneMap | null,
  clips?: Array<{ lane: LaneId }>
): LaneMap {
  const result: LaneMap = {}
  for (const defId of LANES) {
    result[defId] = lanes?.[defId] ? { ...lanes[defId] } : { muted: false, solo: false }
  }
  if (lanes) {
    for (const [k, v] of Object.entries(lanes)) {
      if (isVideoLane(k) || isAudioLane(k)) {
        result[k.toUpperCase()] = {
          muted: Boolean(v?.muted),
          solo: Boolean(v?.solo),
          locked: Boolean(v?.locked),
          hidden: Boolean(v?.hidden),
          order: typeof v?.order === 'number' ? v.order : undefined
        }
      }
    }
  }
  if (clips) {
    for (const c of clips) {
      const k = c.lane?.toUpperCase()
      if (k && (isVideoLane(k) || isAudioLane(k)) && !result[k]) {
        result[k] = { muted: false, solo: false }
      }
    }
  }
  return result
}

/**
 * Kanalları profesyonel NLE sırasına dizer:
 * Video kanalları yukarısı üstte olacak şekilde azalan (V3, V2, V1),
 * Ses kanalları artan (A1, A2, A3) sıradadır.
 */
export function orderLanes(lanes: LaneMap, clips?: Array<{ lane: LaneId }>): LaneId[] {
  const norm = normalizeLanesMap(lanes, clips)
  const vLanes = Object.keys(norm)
    .filter(isVideoLane)
    .sort((a, b) => {
      const oa = norm[a]?.order
      const ob = norm[b]?.order
      if (typeof oa === 'number' && typeof ob === 'number' && oa !== ob) return oa - ob
      return laneNumber(b) - laneNumber(a)
    })
  const aLanes = Object.keys(norm)
    .filter(isAudioLane)
    .sort((a, b) => {
      const oa = norm[a]?.order
      const ob = norm[b]?.order
      if (typeof oa === 'number' && typeof ob === 'number' && oa !== ob) return oa - ob
      return laneNumber(a) - laneNumber(b)
    })
  return [...vLanes, ...aLanes]
}

/** Video kompozisyon sırası: alt kattan üst kata (V1, V2, V3...). */
export function getOrderedVideoLanesAsc(lanes: LaneMap, clips?: Array<{ lane: LaneId }>): LaneId[] {
  const norm = normalizeLanesMap(lanes, clips)
  return Object.keys(norm)
    .filter(isVideoLane)
    .sort((a, b) => laneNumber(a) - laneNumber(b))
}

export function getOrderedAudioLanes(lanes: LaneMap, clips?: Array<{ lane: LaneId }>): LaneId[] {
  const norm = normalizeLanesMap(lanes, clips)
  return Object.keys(norm)
    .filter(isAudioLane)
    .sort((a, b) => laneNumber(a) - laneNumber(b))
}

export function nextVideoLaneId(lanes: LaneMap): LaneId {
  const maxN = Object.keys(lanes)
    .filter(isVideoLane)
    .reduce((m, id) => Math.max(m, laneNumber(id)), 2)
  return `V${maxN + 1}`
}

export function nextAudioLaneId(lanes: LaneMap): LaneId {
  const maxN = Object.keys(lanes)
    .filter(isAudioLane)
    .reduce((m, id) => Math.max(m, laneNumber(id)), 2)
  return `A${maxN + 1}`
}

/** Kaydırıcı alt sınırı: bu değer ve altı "-∞ dB" (sessiz) demektir. */
export const MIN_DB = -60
export const MAX_DB = 12

export interface ClipTransform {
  /** Yakınlaştırma %10 - %400 (varsayılan 100) */
  scale: number
  /** Yatay konum kayması %-100 .. %+100 (varsayılan 0) */
  posX: number
  /** Dikey konum kayması %-100 .. %+100 (varsayılan 0) */
  posY: number
  /** Döndürme açısı -180° .. +180° (varsayılan 0) */
  rotation: number
  /** Saydamlık %0 .. %100 (varsayılan 100) */
  opacity: number
}

export type TransformParam = keyof ClipTransform
export type KeyframeEasing = 'linear' | 'ease-in-out'

export interface TransformKeyframe {
  id: string
  /** Klibin başlangıcından itibaren yerel zaman (saniye, 0 <= time <= clip.duration) */
  time: number
  /** Hangi Transform parametresi ('scale' | 'posX' | 'posY' | 'rotation' | 'opacity') */
  param: TransformParam
  /** Parametrenin o saniyedeki sayısal değeri */
  value: number
  /** İki keyframe arası geçiş eğrisi */
  easing?: KeyframeEasing
}

export function defaultClipTransform(): ClipTransform {
  return {
    scale: 100,
    posX: 0,
    posY: 0,
    rotation: 0,
    opacity: 100
  }
}

export function cloneKeyframes(
  kfs: TransformKeyframe[] | undefined
): TransformKeyframe[] | undefined {
  if (!kfs) return undefined
  return kfs.map((k) => ({ ...k }))
}

export function getParamKeyframes(
  clip: Pick<TimelineClip, 'keyframes'> | null | undefined,
  param: TransformParam
): TransformKeyframe[] {
  if (!clip?.keyframes || clip.keyframes.length === 0) return []
  return clip.keyframes
    .filter((k) => k.param === param)
    .slice()
    .sort((a, b) => a.time - b.time)
}

export function findKeyframeAt(
  clip: Pick<TimelineClip, 'keyframes'> | null | undefined,
  param: TransformParam,
  localTime: number,
  tolerance = 0.045
): TransformKeyframe | undefined {
  if (!clip?.keyframes) return undefined
  return clip.keyframes.find(
    (k) => k.param === param && Math.abs(k.time - localTime) <= tolerance
  )
}

export function evaluateTransformParamAt(
  clip: Pick<TimelineClip, 'transform' | 'keyframes' | 'keyframeEasing'> | null | undefined,
  param: TransformParam,
  localTime: number
): number {
  const baseTf = clip?.transform ?? defaultClipTransform()
  const kfs = getParamKeyframes(clip, param)
  if (kfs.length === 0) return baseTf[param]
  if (kfs.length === 1) return kfs[0].value
  if (localTime <= kfs[0].time) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (localTime >= last.time) return last.value

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (localTime >= a.time && localTime <= b.time) {
      const dt = Math.max(1e-6, b.time - a.time)
      const u = Math.max(0, Math.min(1, (localTime - a.time) / dt))
      const mode: KeyframeEasing = a.easing ?? clip?.keyframeEasing ?? 'ease-in-out'
      const eased = mode === 'ease-in-out' ? u * u * (3 - 2 * u) : u
      return a.value + (b.value - a.value) * eased
    }
  }
  return last.value
}

export function evaluateClipTransformAt(
  clip:
    | Pick<TimelineClip, 'start' | 'duration' | 'transform' | 'keyframes' | 'keyframeEasing'>
    | null
    | undefined,
  globalTime: number
): ClipTransform {
  if (!clip) return defaultClipTransform()
  const localTime = Math.max(0, Math.min(clip.duration, globalTime - clip.start))
  return {
    scale: evaluateTransformParamAt(clip, 'scale', localTime),
    posX: evaluateTransformParamAt(clip, 'posX', localTime),
    posY: evaluateTransformParamAt(clip, 'posY', localTime),
    rotation: evaluateTransformParamAt(clip, 'rotation', localTime),
    opacity: evaluateTransformParamAt(clip, 'opacity', localTime)
  }
}

/**
 * FFmpeg filtre ifadeleri (scale / overlay / rotate / blend) için
 * zaman değişkenine (`t` veya `T`) bağlı parçalı (piecewise) interpolasyon ifadesi üretir.
 */
export function buildFfmpegKeyframeExpr(
  clip: Pick<TimelineClip, 'transform' | 'keyframes' | 'keyframeEasing'>,
  param: TransformParam,
  timeVar = 't'
): string {
  const baseTf = clip.transform ?? defaultClipTransform()
  const kfs = getParamKeyframes(clip, param)
  if (kfs.length === 0) return baseTf[param].toFixed(4)
  if (kfs.length === 1) return kfs[0].value.toFixed(4)

  const mode: KeyframeEasing = clip.keyframeEasing ?? 'ease-in-out'

  // Parçalı ifadeyi sondan başa doğru iç içe if(lte(t, ...), ..., ...) olarak kur
  let expr = kfs[kfs.length - 1].value.toFixed(4)
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i]
    const b = kfs[i + 1]
    const t0 = a.time.toFixed(4)
    const t1 = b.time.toFixed(4)
    const dt = Math.max(0.001, b.time - a.time).toFixed(4)
    const v0 = a.value.toFixed(4)
    const dv = (b.value - a.value).toFixed(4)
    const uExpr = `((${timeVar}-${t0})/${dt})`
    const segMode = a.easing ?? mode
    const easedExpr =
      segMode === 'ease-in-out'
        ? `(pow(${uExpr},2)*(3-2*${uExpr}))`
        : uExpr
    const segVal = `(${v0}+(${dv})*${easedExpr})`
    expr = `if(lte(${timeVar},${t1}),${segVal},${expr})`
  }
  const firstT = kfs[0].time.toFixed(4)
  const firstV = kfs[0].value.toFixed(4)
  return `if(lte(${timeVar},${firstT}),${firstV},${expr})`
}

export type TransitionType =
  | 'none'
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'wipe-left'
  | 'slide-left'
  | 'zoom-in'
  | 'film-burn'
export type AudioFxPreset = 'none' | 'denoise' | 'bass-boost'

export interface SpeedRampPoint {
  id: string
  /** Klip yerel zamanı (saniye, >= 0) */
  time: number
  /** Hız yüzdesi (25 - 400) */
  speed: number
}

export interface GainKeyframe {
  id: string
  /** Klip yerel zamanı (saniye, >= 0) */
  time: number
  /** Ses seviyesi (dB, -60 .. +12) */
  db: number
}

export interface AudioEffectsChain {
  eqLowDb: number // -12..+12 dB (100Hz Low Shelf)
  eqMidDb: number // -12..+12 dB (1000Hz Peak)
  eqHighDb: number // -12..+12 dB (8000Hz High Shelf)
  compressorEnabled: boolean
  compressorThresholdDb: number // -40..0 dB
  compressorRatio: number // 1..12
  limiterEnabled: boolean
  limiterCeilingDb: number // -12..0 dB
  reverbMix: number // 0..100 %
  noiseReduction: boolean
}

export function defaultAudioEffectsChain(): AudioEffectsChain {
  return {
    eqLowDb: 0,
    eqMidDb: 0,
    eqHighDb: 0,
    compressorEnabled: false,
    compressorThresholdDb: -18,
    compressorRatio: 3,
    limiterEnabled: false,
    limiterCeilingDb: -1,
    reverbMix: 0,
    noiseReduction: false
  }
}

export interface SubtitleSegment {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
  language?: string
}

export interface SubtitleStyleConfig {
  fontFamily: string
  fontSize: number
  textColor: string
  backgroundColor: string
  backgroundOpacity: number // 0..100
  position: 'bottom' | 'center' | 'top'
  burnInOnExport: boolean
  /** Motion Template: kelime kelime vurgulama (Karaoke / Hormozi / Typewriter) */
  animation?: 'none' | 'karaoke' | 'hormozi' | 'typewriter'
  highlightColor?: string
}

export function defaultSubtitleStyle(): SubtitleStyleConfig {
  return {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 26,
    textColor: '#F1F2EE',
    backgroundColor: '#0A0B0E',
    backgroundOpacity: 72,
    position: 'bottom',
    burnInOnExport: true,
    animation: 'none',
    highlightColor: '#FACC15'
  }
}

export interface ClipMask {
  enabled: boolean
  shape: 'ellipse' | 'rect'
  mode: 'blur' | 'mosaic' | 'vignette'
  invert: boolean
  x: number
  y: number
  w: number
  h: number
  feather: number
  strength: number
}

export function defaultClipMask(): ClipMask {
  return {
    enabled: false,
    shape: 'ellipse',
    mode: 'blur',
    invert: false,
    x: 50,
    y: 50,
    w: 32,
    h: 32,
    feather: 12,
    strength: 65
  }
}

export interface TimelineClip {
  id: string
  mediaId: string
  lane: LaneId
  name: string
  /** timeline üzerindeki başlangıç (saniye) */
  start: number
  /** kaynak dosyadaki giriş noktası (saniye) */
  in: number
  /** timeline üzerindeki süre (saniye) */
  duration: number
  /** klip ses seviyesi (dB). MIN_DB ve altı = sessiz */
  gainDb: number
  fadeIn: number
  fadeOut: number
  /** Sadece V1: videonun gömülü sesi A kanalına ayrıldı mı? */
  audioDetached: boolean
  /** Sadece V1: klip bazlı renk düzenleme ayarları */
  grade?: ColorGrade
  /** Sadece V2: jenerik / metin klibi ayarları */
  credit?: CreditConfig
  /** EDIT Workspace: Kadraj & Hareket (Scale, Position X/Y, Rotation, Opacity) */
  transform?: ClipTransform
  /** EDIT Workspace: Keyframe (Anahtar Kare) animasyon noktaları */
  keyframes?: TransformKeyframe[]
  /** EDIT Workspace: Keyframe geçiş eğrisi ('ease-in-out' | 'linear') */
  keyframeEasing?: KeyframeEasing
  /** NLE Kısayolları: Klip içi Giriş (In) ve Çıkış (Out) işaret noktaları (yerel saniye) */
  markIn?: number | null
  markOut?: number | null
  /** EDIT Workspace: Oynatma hızı %25 - %400 (varsayılan 100) */
  speed?: number
  /** EDIT Workspace: Değişken hız eğrisi (Speed Ramp) kontrol noktaları */
  speedRamp?: SpeedRampPoint[]
  /** EDIT Workspace: Ters oynatma (Reverse) */
  reverse?: boolean
  /** EDIT Workspace: Geçiş efekti tipi */
  transitionType?: TransitionType
  /** EDIT Workspace: Geçiş efekti süresi (saniye, varsayılan 0.8) */
  transitionDuration?: number
  /** TIMELINE: Ses seviyesi rubberband keyframe noktaları */
  gainKeyframes?: GainKeyframe[]
  /** EDIT / COLOR: Power Window / Blur / Mosaic / Vignette maskesi */
  mask?: ClipMask
  /** EDIT Workspace: Ses sağ/sol dengesi (-100 Sol .. +100 Sağ, varsayılan 0) */
  pan?: number
  /** EDIT Workspace: Ses efekti ön ayarı (Gürültü azaltma / Sinematik Bas) */
  audioPreset?: AudioFxPreset
  /** Profesyonel Ses Efekt Zinciri (EQ / Compressor / Limiter / Reverb / Denoise) */
  audioEffects?: AudioEffectsChain
  /** Klip Gruplama (Clip Grouping) kimliği */
  groupId?: string | null
  /** Bağlı Video/Ses (Linked A/V) eş klip kimliği */
  linkedClipId?: string | null
  /** İç İçe Sekans (Nested Sequence / Compound Clip) alt klipleri */
  nestedClips?: TimelineClip[]
}

export interface LaneState {
  muted: boolean
  solo: boolean
  locked?: boolean
  hidden?: boolean
  order?: number
}
export type LaneMap = Record<LaneId, LaneState>

export function defaultLanes(): LaneMap {
  return {
    V2: { muted: false, solo: false },
    V1: { muted: false, solo: false },
    A1: { muted: false, solo: false },
    A2: { muted: false, solo: false }
  }
}

export interface CreditExportOverlay {
  /** Base64 PNG (data:image/png;base64,...) */
  pngDataUrl: string
  /** 'rolling' için aşağıdan yukarı kaydırma, 'fade' için belirip kaybolma */
  mode: 'rolling' | 'fade'
}

export type ExportResolution = '1080p' | '4k' | 'vertical'
export type ExportFps = 24 | 30 | 60
export type ExportFormat = 'mp4' | 'mov'
export type ExportCodec = 'h264' | 'h265'
export type ExportQuality = 'low' | 'medium' | 'high' | 'master'
export type HwAccelMode = 'auto' | 'cpu' | 'nvenc' | 'vaapi'
export type ExportEncoder =
  | 'auto'
  | 'libx264'
  | 'libx265'
  | 'h264_nvenc'
  | 'hevc_nvenc'
  | 'h264_vaapi'
  | 'hevc_vaapi'
  | 'h264_qsv'
  | 'h264_amf'
export type ExportPlatformPresetId =
  | 'custom'
  | 'youtube-1080p'
  | 'youtube-4k'
  | 'social-media'
  | 'social-vertical'
  | 'high-quality-master'
  | 'cinema-24p'
  | 'fast-draft'

export interface ExportSettings {
  resolution: ExportResolution
  fps: ExportFps
  format: ExportFormat
  codec?: ExportCodec
  videoBitrateMbps?: number
  audioBitrateKbps?: 128 | 192 | 320
  quality: ExportQuality
  encoder?: ExportEncoder
  hwAccel?: HwAccelMode
  presetId?: ExportPlatformPresetId
  useInOutRange?: boolean
  burnInSubtitles?: boolean
  /** İki geçişli LUFS ses normalizasyonu */
  loudnessPreset?: 'off' | 'youtube' | 'cinema'
  /** İsteğe bağlı en-boy oranı kırpma / letterbox maske gömme */
  aspectMaskBurnIn?: 'none' | '2.39:1' | '1.85:1' | '9:16' | '4:3'
}

export interface ExportPlatformPresetMeta {
  id: Exclude<ExportPlatformPresetId, 'custom'>
  label: string
  hint: string
  patch: Partial<ExportSettings>
}

export const EXPORT_PLATFORM_PRESETS: ExportPlatformPresetMeta[] = [
  {
    id: 'youtube-1080p',
    label: 'YouTube 1080p',
    hint: '1920×1080 · 30fps · H.264 16 Mbps',
    patch: {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      codec: 'h264',
      videoBitrateMbps: 16,
      audioBitrateKbps: 192,
      quality: 'high',
      presetId: 'youtube-1080p'
    }
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K',
    hint: '3840×2160 · 30fps · H.264 45 Mbps',
    patch: {
      resolution: '4k',
      fps: 30,
      format: 'mp4',
      codec: 'h264',
      videoBitrateMbps: 45,
      audioBitrateKbps: 320,
      quality: 'high',
      presetId: 'youtube-4k'
    }
  },
  {
    id: 'social-media',
    label: 'Social Media',
    hint: '1920×1080 · 30fps · H.264 12 Mbps',
    patch: {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      codec: 'h264',
      videoBitrateMbps: 12,
      audioBitrateKbps: 192,
      quality: 'medium',
      presetId: 'social-media'
    }
  },
  {
    id: 'social-vertical',
    label: 'Instagram Reels',
    hint: '1080×1920 · 60fps · H.264 18 Mbps',
    patch: {
      resolution: 'vertical',
      fps: 60,
      format: 'mp4',
      codec: 'h264',
      videoBitrateMbps: 18,
      audioBitrateKbps: 192,
      quality: 'high',
      presetId: 'social-vertical'
    }
  },
  {
    id: 'high-quality-master',
    label: 'High Quality Master',
    hint: '3840×2160 · 24fps · MOV · 65 Mbps',
    patch: {
      resolution: '4k',
      fps: 24,
      format: 'mov',
      codec: 'h264',
      videoBitrateMbps: 65,
      audioBitrateKbps: 320,
      quality: 'high',
      presetId: 'high-quality-master'
    }
  },
  {
    id: 'cinema-24p',
    label: 'Sinema 24p Noir',
    hint: '1920×1080 · 24fps · MOV · Yüksek',
    patch: {
      resolution: '1080p',
      fps: 24,
      format: 'mov',
      codec: 'h264',
      videoBitrateMbps: 24,
      audioBitrateKbps: 320,
      quality: 'high',
      presetId: 'cinema-24p'
    }
  }
]

export const EXPORT_RESOLUTION_DIM: Record<ExportResolution, { width: number; height: number; label: string }> = {
  '1080p': { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  '4k': { width: 3840, height: 2160, label: '4K (3840×2160)' },
  vertical: { width: 1080, height: 1920, label: 'Dikey Sosyal Medya (1080×1920)' }
}

export function defaultExportSettings(): ExportSettings {
  return {
    resolution: '1080p',
    fps: 30,
    format: 'mp4',
    codec: 'h264',
    videoBitrateMbps: 16,
    audioBitrateKbps: 192,
    quality: 'high',
    encoder: 'auto',
    hwAccel: 'auto',
    presetId: 'custom',
    useInOutRange: false,
    burnInSubtitles: true,
    loudnessPreset: 'off',
    aspectMaskBurnIn: 'none'
  }
}

export type CaseMarkerColor = 'amber' | 'crimson' | 'emerald' | 'cyan' | 'violet'

export interface CaseMarker {
  id: string
  /** Timeline üzerindeki saniye */
  time: number
  /** Sahne başlığı (örn: "Sahne 1: Sorgu") */
  title: string
  /** Yönetmen notu */
  note: string
  /** İşaretçi rengi */
  color: CaseMarkerColor
  /** İşaretçi kaynağı: manuel / sahne kesimi / ses transient */
  kind?: 'manual' | 'scene-cut' | 'audio-transient'
}

export const CASE_MARKER_COLOR_META: Record<
  CaseMarkerColor,
  { hex: string; label: string; glow: string }
> = {
  amber: { hex: '#F59E0B', label: 'Kehribar', glow: 'rgba(245,158,11,0.45)' },
  crimson: { hex: '#EF4444', label: 'Kızıl', glow: 'rgba(239,68,68,0.45)' },
  emerald: { hex: '#10B981', label: 'Zümrüt', glow: 'rgba(16,185,129,0.45)' },
  cyan: { hex: '#06B6D4', label: 'Camgöbeği', glow: 'rgba(6,182,212,0.45)' },
  violet: { hex: '#8B5CF6', label: 'Mor', glow: 'rgba(139,92,246,0.45)' }
}

export interface GradeStill {
  id: string
  name: string
  createdAt: string
  timecode: string
  /** Yakalanan renk düzenlemeli karenin JPEG/PNG data URL küçük resmi */
  thumbnailDataUrl: string
  /** O kareye ait tam ColorGrade kopyası */
  grade: ColorGrade
}

export type NoirSoundscapeId =
  | 'tension-riser'
  | 'sub-drop'
  | 'film-projector'
  | 'night-rain'

export interface NoirSoundscapePresetMeta {
  id: NoirSoundscapeId
  label: string
  desc: string
  duration: number
  icon: string
}

export const NOIR_SOUNDSCAPE_PRESETS: NoirSoundscapePresetMeta[] = [
  {
    id: 'tension-riser',
    label: 'Gerilim Riser',
    desc: 'Yükselen sinematik gerilim',
    duration: 3.5,
    icon: ''
  },
  {
    id: 'sub-drop',
    label: 'Düşük Bas / Sub Drop',
    desc: 'Derin LFE bas darbesi',
    duration: 3.0,
    icon: ''
  },
  {
    id: 'film-projector',
    label: 'Film Projektörü',
    desc: '35mm 24fps mekanik makara',
    duration: 4.0,
    icon: ''
  },
  {
    id: 'night-rain',
    label: 'Gece Yağmuru',
    desc: 'Noir atmosferik sağanak',
    duration: 5.0,
    icon: ''
  }
]

export interface SubtitleExportOverlay {
  id: string
  start: number
  end: number
  /** Base64 PNG (data:image/png;base64,...) */
  pngDataUrl: string
}

export interface ExportRequest {
  clips: TimelineClip[]
  lanes: LaneMap
  customLuts?: Record<string, Lut3D>
  creditOverlays?: Record<string, CreditExportOverlay>
  subtitleOverlays?: SubtitleExportOverlay[]
  subtitles?: SubtitleSegment[]
  subtitleStyle?: SubtitleStyleConfig
  masterGainDb?: number
  settings?: ExportSettings
  autoDucking?: boolean
  outputPath?: string
  rangeStart?: number | null
  rangeEnd?: number | null
}

export const clipEnd = (c: Pick<TimelineClip, 'start' | 'duration'>): number => c.start + c.duration

export function dbToGain(db: number): number {
  return db <= MIN_DB ? 0 : Math.pow(10, db / 20)
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Fade in/out zarfı (0..1). `local` = klibin başından itibaren saniye. Doğrusal (FFmpeg afade ile aynı). */
export function fadeGain(c: Pick<TimelineClip, 'fadeIn' | 'fadeOut' | 'duration'>, local: number): number {
  let g = 1
  if (c.fadeIn > 0) g *= clamp01(local / c.fadeIn)
  if (c.fadeOut > 0) g *= clamp01((c.duration - local) / c.fadeOut)
  return g
}

/** Klibin belirli bir yerel zamandaki dB kazancını hesaplar (rubberband keyframe destekli). */
export function evaluateGainDbAt(c: TimelineClip, local: number): number {
  const kfs = c.gainKeyframes
  if (!kfs || kfs.length === 0) return c.gainDb
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  if (local <= sorted[0].time) return sorted[0].db
  const last = sorted[sorted.length - 1]
  if (local >= last.time) return last.db
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (local >= a.time && local <= b.time) {
      const span = b.time - a.time
      if (span <= 1e-6) return b.db
      const u = (local - a.time) / span
      return a.db + (b.db - a.db) * u
    }
  }
  return c.gainDb
}

/** Klibin o andaki toplam çarpanı (ses seviyesi × fade). */
export function clipGainAt(c: TimelineClip, local: number): number {
  return dbToGain(evaluateGainDbAt(c, local)) * fadeGain(c, local)
}

/** Belirli bir yerel zamandaki hız yüzdesini (25..400) döndürür. */
export function evaluateClipSpeedAt(c: TimelineClip, local: number): number {
  const baseSpeed = clampSpeed(c.speed ?? 100)
  const ramp = c.speedRamp
  if (!ramp || ramp.length === 0) return baseSpeed
  const sorted = [...ramp].sort((a, b) => a.time - b.time)
  if (local <= sorted[0].time) return clampSpeed(sorted[0].speed)
  const last = sorted[sorted.length - 1]
  if (local >= last.time) return clampSpeed(last.speed)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (local >= a.time && local <= b.time) {
      const span = b.time - a.time
      if (span <= 1e-6) return clampSpeed(b.speed)
      const u = (local - a.time) / span
      return clampSpeed(a.speed + (b.speed - a.speed) * u)
    }
  }
  return baseSpeed
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 100
  return Math.max(25, Math.min(400, v))
}

/**
 * Yerel zaman `local` için `0..local` aralığındaki hız eğrisinin integralini alarak
 * kaynak medya üzerindeki saniyeyi hesaplar (Speed Ramp destekli).
 */
export function mapClipLocalToSourceTime(c: TimelineClip, local: number): number {
  const dur = Math.max(0.05, c.duration)
  const clampedLocal = Math.max(0, Math.min(dur, local))
  const ramp = c.speedRamp
  let sourceOffset = 0
  if (!ramp || ramp.length === 0) {
    sourceOffset = clampedLocal * (clampSpeed(c.speed ?? 100) / 100)
  } else {
    const steps = 24
    const dt = clampedLocal / steps
    if (dt > 0) {
      let prevSpeed = evaluateClipSpeedAt(c, 0) / 100
      for (let i = 1; i <= steps; i++) {
        const curSpeed = evaluateClipSpeedAt(c, i * dt) / 100
        sourceOffset += 0.5 * (prevSpeed + curSpeed) * dt
        prevSpeed = curSpeed
      }
    }
  }
  if (c.reverse) {
    const totalSourceSpan =
      !ramp || ramp.length === 0
        ? dur * (clampSpeed(c.speed ?? 100) / 100)
        : integrateSpeedRamp(c, dur)
    return Math.max(c.in, c.in + totalSourceSpan - sourceOffset)
  }
  return c.in + sourceOffset
}

function integrateSpeedRamp(c: TimelineClip, endLocal: number): number {
  const steps = 24
  const dt = Math.max(0, endLocal) / steps
  if (dt <= 0) return 0
  let sum = 0
  let prev = evaluateClipSpeedAt(c, 0) / 100
  for (let i = 1; i <= steps; i++) {
    const cur = evaluateClipSpeedAt(c, i * dt) / 100
    sum += 0.5 * (prev + cur) * dt
    prev = cur
  }
  return sum
}

/** Klibin ortalama hız çarpanını (ör. 1.0 = %100) döndürür. */
export function effectiveAverageSpeedFactor(c: TimelineClip): number {
  const dur = Math.max(0.05, c.duration)
  if (!c.speedRamp || c.speedRamp.length === 0) {
    return clampSpeed(c.speed ?? 100) / 100
  }
  return Math.max(0.25, Math.min(4, integrateSpeedRamp(c, dur) / dur))
}

/**
 * Auto-Ducking (Diyalog Önceliği):
 * V1 (sesi ayrılmamış) veya A1 kanalında `t` anında duyulabilir diyalog/ses varsa
 * A2 (müzik/ambiyans) kanalının kazancını yumuşak geçişle %28'e (-11 dB) kısar.
 */
export function computeAutoDuckMultiplierAt(
  clips: TimelineClip[],
  lanes: LaneMap,
  t: number,
  autoDucking: boolean
): number {
  if (!autoDucking) return 1
  const ramp = 0.25
  const duckTarget = 0.28 // ~ -11 dB
  let maxDuckDepth = 0

  for (const c of clips) {
    if (!isVideoLane(c.lane) && c.lane !== 'A1') continue
    if (isVideoLane(c.lane) && (c.audioDetached || isCreditClip(c))) continue
    if (!isLaneAudible(lanes, c.lane)) continue
    if (c.gainDb <= MIN_DB) continue

    const start = c.start
    const end = c.start + c.duration
    if (t < start - ramp || t > end + ramp) continue

    let env = 1
    if (t < start) {
      env = clamp01(1 - (start - t) / ramp)
    } else if (t > end) {
      env = clamp01(1 - (t - end) / ramp)
    }
    const local = Math.max(0, Math.min(c.duration, t - start))
    const dialogGain = Math.min(1, clipGainAt(c, local))
    if (dialogGain > 0.02) {
      maxDuckDepth = Math.max(maxDuckDepth, env * Math.min(1, dialogGain * 1.2))
    }
  }

  return 1 - maxDuckDepth * (1 - duckTarget)
}

/**
 * Kanal duyulur mu? Mute her zaman susturur.
 * Herhangi bir kanalda Solo açıksa yalnızca Solo kanallar duyulur.
 */
export function isLaneAudible(lanes: LaneMap, id: LaneId): boolean {
  const st = lanes[id]
  if (st?.muted || st?.hidden) return false
  const anySolo = Object.values(lanes).some((s) => Boolean(s?.solo))
  return !anySolo || Boolean(st?.solo)
}

export function projectEnd(clips: TimelineClip[]): number {
  return clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

/** `t` anında kanaldaki klip (start <= t < end). */
export function clipAt(clips: TimelineClip[], lane: LaneId, t: number): TimelineClip | undefined {
  return clips.find((c) => c.lane === lane && t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6)
}

export function formatDb(db: number): string {
  return db <= MIN_DB ? '-∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/* ───────────────────────────────────────────────────────────────────────────
 * Kesintisiz (gapless) geçiş, hassas mıknatıs (snap) ve boşluk kapatma yardımcıları.
 * Saf fonksiyonlardır; hem renderer (önizleme/timeline) hem main (export) kullanabilir.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Milisaniye hassasiyetinde yuvarlama: 5.300000000000001 gibi kayan nokta hatalarını yok eder. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000

/** Klibin bitiş zamanı (ms hassasiyetinde; bitişik klibin `start` değeriyle birebir aynı çıkar). */
export const clipEndExact = (c: Pick<TimelineClip, 'start' | 'duration'>): number =>
  round3(c.start + c.duration)

/** Playhead mevcut klibin bitimine bu kadar yaklaşınca sıradaki klip gizli tampona önceden yüklenir. */
export const GAPLESS_PRELOAD_SECONDS = 1.5
/** Mıknatıs (snap) yakalama mesafesi (piksel). */
export const SNAP_THRESHOLD_PX = 12
const TIME_EPS = 1e-4

export function clipSpeedFactor(c: Pick<TimelineClip, 'speed'>): number {
  return Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
}

/** Timeline zamanı `t`'nin klibin kaynak dosyasındaki karşılığı (hız ve ters oynatma dahil). */
export function clipSourceTimeAt(c: TimelineClip, t: number): number {
  const spd = clipSpeedFactor(c)
  const local = Math.max(0, Math.min(c.duration, t - c.start))
  return c.reverse ? Math.max(0, c.in + Math.max(0, c.duration - local) * spd) : c.in + local * spd
}

/**
 * `next`, `prev` klibinin kaynak dosyadaki birebir devamı mı?
 * Evet ise (ör. Razor ile bölünmüş klip) aynı <video> elementi seek/yükleme yapmadan oynamaya devam eder.
 */
export function isSeamlessContinuation(prev: TimelineClip, next: TimelineClip): boolean {
  if (prev.id === next.id) return true
  if (prev.mediaId !== next.mediaId) return false
  if (prev.reverse || next.reverse) return false
  if (Math.abs(clipSpeedFactor(prev) - clipSpeedFactor(next)) > 1e-3) return false
  if (Math.abs(clipEndExact(prev) - next.start) > 0.002) return false
  const expectedIn = prev.in + prev.duration * clipSpeedFactor(prev)
  return Math.abs(next.in - expectedIn) <= 0.02
}

/**
 * `t` anından itibaren `lookahead` saniye içinde ekranda gösterilecek taban klibin DEĞİŞTİĞİ
 * ilk geçişi bulur. `getBaseAt` zamana göre taban (en alttaki duyulur video) klibini döndürmelidir.
 */
export function findNextBaseClip(
  clips: TimelineClip[],
  getBaseAt: (t: number) => TimelineClip | undefined,
  t: number,
  lookahead = GAPLESS_PRELOAD_SECONDS
): { clip: TimelineClip; at: number } | null {
  const cur = getBaseAt(t)
  const bounds = new Set<number>()
  for (const c of clips) {
    if (isCreditClip(c) || !isVideoLane(c.lane)) continue
    const s = round3(c.start)
    const e = clipEndExact(c)
    if (s > t + TIME_EPS && s <= t + lookahead) bounds.add(s)
    if (e > t + TIME_EPS && e <= t + lookahead) bounds.add(e)
  }
  const sorted = [...bounds].sort((a, b) => a - b)
  for (const b of sorted) {
    const nxt = getBaseAt(b + TIME_EPS)
    if (nxt && nxt.id !== cur?.id) return { clip: nxt, at: b }
  }
  return null
}

export interface SnapTarget {
  time: number
  /** 0 = aynı kanaldaki bitişik klip ucu (en güçlü), 1 = diğer klip uçları / playhead / işaretçi */
  priority: number
}

/**
 * Sıkı mıknatıs: `threshold` içindeki hedefler arasında önce en güçlü öncelik, sonra en yakın seçilir.
 * Sonuç ms'ye yuvarlanır → bitişik klibin bitişiyle birebir aynı zaman damgası.
 */
export function findStrictSnap(t: number, targets: SnapTarget[], threshold: number): number | null {
  let best: SnapTarget | null = null
  let bestDist = Infinity
  for (const tg of targets) {
    const d = Math.abs(t - tg.time)
    if (d > threshold) continue
    if (!best || tg.priority < best.priority || (tg.priority === best.priority && d < bestDist)) {
      best = tg
      bestDist = d
    }
  }
  return best ? round3(best.time) : null
}

/**
 * Taşıma sırasında klibin başı VEYA sonu bir hedefe yakalanır.
 * `start` = kilitlenen yeni başlangıç, `guide` = gösterilecek kılavuz çizgisi zamanı.
 */
export function findStrictSnapForSpan(
  start: number,
  duration: number,
  targets: SnapTarget[],
  threshold: number
): { start: number; guide: number } | null {
  let best: { start: number; guide: number; priority: number; dist: number } | null = null
  for (const tg of targets) {
    const candidates: Array<{ start: number; dist: number }> = [
      { start: tg.time, dist: Math.abs(start - tg.time) },
      { start: tg.time - duration, dist: Math.abs(start + duration - tg.time) }
    ]
    for (const c of candidates) {
      if (c.dist > threshold) continue
      if (
        !best ||
        tg.priority < best.priority ||
        (tg.priority === best.priority && c.dist < best.dist)
      ) {
        best = { start: c.start, guide: tg.time, priority: tg.priority, dist: c.dist }
      }
    }
  }
  return best ? { start: Math.max(0, round3(best.start)), guide: round3(best.guide) } : null
}

/** Kanalda `t` zamanının düştüğü boşluk (iki klip arası veya ilk klipten önce). Boşluk yoksa null. */
export function findLaneGapAt(
  clips: TimelineClip[],
  lane: LaneId,
  t: number
): { start: number; end: number } | null {
  const laneClips = clips
    .filter((c) => c.lane === lane && c.duration > 0)
    .sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const c of laneClips) {
    const s = round3(c.start)
    if (t >= cursor && t < s && s - cursor > 0.002) return { start: cursor, end: s }
    cursor = Math.max(cursor, clipEndExact(c))
  }
  return null
}

/**
 * "Boşluğu Kapat (Ripple Delete Gap)": boşluğun sağındaki tüm klipleri boşluk kadar sola kaydırır.
 * Tıklanan kanal her zaman kayar; diğer kanallar yalnızca boşluk aralığında klipleri YOKSA
 * (çakışma / senkron kaybı olmasın diye) birlikte kayar.
 */
export function rippleCloseGap(
  clips: TimelineClip[],
  lane: LaneId,
  gapStart: number,
  gapEnd: number
): { clips: TimelineClip[]; shiftedLanes: LaneId[] } {
  const shift = gapEnd - gapStart
  if (shift <= 0.0005) return { clips, shiftedLanes: [] }

  const lanesInUse = [...new Set(clips.map((c) => c.lane))]
  const shifting = new Set<LaneId>([lane])
  for (const l of lanesInUse) {
    if (l === lane) continue
    const blocked = clips.some(
      (c) => c.lane === l && c.start < gapEnd - 0.002 && clipEndExact(c) > gapStart + 0.002
    )
    const hasRight = clips.some((c) => c.lane === l && c.start >= gapEnd - 0.002)
    if (!blocked && hasRight) shifting.add(l)
  }

  const next = clips.map((c) => {
    if (!shifting.has(c.lane) || c.start < gapEnd - 0.002) return c
    const moved =
      Math.abs(c.start - gapEnd) <= 0.002 ? round3(gapStart) : Math.max(0, round3(c.start - shift))
    return { ...c, start: moved }
  })
  const shiftedLanes = [...shifting].filter((l) =>
    clips.some((c) => c.lane === l && c.start >= gapEnd - 0.002)
  )
  return { clips: next, shiftedLanes }
}

/**
 * İç İçe Sekansları (Nested Sequence / Compound Clip) hem canlı önizleme (usePlayer)
 * hem de dışa aktarma (export-service) için gerçek alt kliplerine açar (flatten).
 * - Çok katmanlı (nested-in-nested) yapıları destekler.
 * - Döngüsel referanslara ve aşırı derinliğe (maxDepth = 8) karşı korumalıdır.
 * - Üst sekansın trim (`in`) ve `duration` sınırlarını alt kliplere uygular.
 */
export function flattenNestedClips(
  rawClips: TimelineClip[],
  visited: Set<string> = new Set(),
  depth = 0
): TimelineClip[] {
  if (!Array.isArray(rawClips) || depth > 8) return Array.isArray(rawClips) ? rawClips : []
  const out: TimelineClip[] = []
  for (const c of rawClips) {
    if (
      Array.isArray(c.nestedClips) &&
      c.nestedClips.length > 0 &&
      !visited.has(c.id)
    ) {
      const nextVisited = new Set(visited)
      nextVisited.add(c.id)
      const innerFlattened = flattenNestedClips(c.nestedClips, nextVisited, depth + 1)
      if (innerFlattened.length === 0) {
        out.push(c)
        continue
      }
      const innerMinStart = Math.min(...innerFlattened.map((nc) => nc.start))
      const containerTrimIn = Math.max(0, c.in ?? 0)
      const containerDur = Math.max(0.05, c.duration)

      for (const nc of innerFlattened) {
        const relStart = round3(nc.start - innerMinStart)
        const relEnd = round3(relStart + nc.duration)
        const visStart = Math.max(relStart, containerTrimIn)
        const visEnd = Math.min(relEnd, containerTrimIn + containerDur)
        const visDur = round3(visEnd - visStart)
        if (visDur <= 0.02) continue

        const headCut = Math.max(0, visStart - relStart)
        const ncSpd = Math.max(0.25, Math.min(4.0, (nc.speed ?? 100) / 100))
        const timelineStart = round3(c.start + (visStart - containerTrimIn))
        out.push({
          ...nc,
          id: `${c.id}::${nc.id}`,
          start: timelineStart,
          in: round3(nc.in + headCut * ncSpd),
          duration: visDur,
          fadeIn: Math.max(0, round3(nc.fadeIn - headCut)),
          fadeOut: Math.max(0, round3(nc.fadeOut - Math.max(0, relEnd - visEnd))),
          nestedClips: undefined
        })
      }
    } else {
      out.push(c)
    }
  }
  return out
}

