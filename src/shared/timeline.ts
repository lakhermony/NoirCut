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

export type LaneId = 'V2' | 'V1' | 'A1' | 'A2'
export const LANES: LaneId[] = ['V2', 'V1', 'A1', 'A2']
export const AUDIO_LANES: LaneId[] = ['A1', 'A2']

/** Kaydırıcı alt sınırı: bu değer ve altı "-∞ dB" (sessiz) demektir. */
export const MIN_DB = -60
export const MAX_DB = 12

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
}

export interface LaneState {
  muted: boolean
  solo: boolean
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
export type ExportQuality = 'low' | 'medium' | 'high'

export interface ExportSettings {
  resolution: ExportResolution
  fps: ExportFps
  format: ExportFormat
  quality: ExportQuality
}

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
    quality: 'high'
  }
}

export interface ExportRequest {
  clips: TimelineClip[]
  lanes: LaneMap
  customLuts?: Record<string, Lut3D>
  creditOverlays?: Record<string, CreditExportOverlay>
  settings?: ExportSettings
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

/** Klibin o andaki toplam çarpanı (ses seviyesi × fade). */
export function clipGainAt(c: TimelineClip, local: number): number {
  return dbToGain(c.gainDb) * fadeGain(c, local)
}

/**
 * Kanal duyulur mu? Mute her zaman susturur.
 * Herhangi bir kanalda Solo açıksa yalnızca Solo kanallar duyulur.
 */
export function isLaneAudible(lanes: LaneMap, id: LaneId): boolean {
  if (lanes[id].muted) return false
  const anySolo = LANES.some((l) => lanes[l].solo)
  return !anySolo || lanes[id].solo
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
