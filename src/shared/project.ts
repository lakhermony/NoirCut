/**
 * .noircut proje dosyası veri modeli (JSON).
 */
import type { ColorGrade } from './color'
import type { CreditConfig } from './credits'
import type { Lut3D } from './lut'
import type {
  CaseMarker,
  ExportSettings,
  GradeStill,
  LaneMap,
  SubtitleSegment,
  SubtitleStyleConfig,
  TimelineClip
} from './timeline'

export interface ProjectMediaRef {
  id: string
  path: string
}

export interface NoirCutProject {
  version: 1
  savedAt: string
  activeMediaId: string | null
  mediaRefs: ProjectMediaRef[]
  clips: TimelineClip[]
  lanes: LaneMap
  customLuts: Record<string, Lut3D>
  draftCredit: CreditConfig
  fallbackGrade: ColorGrade
  exportSettings?: ExportSettings
  /** Sahne İşaretçileri ve Yönetmen Notları (Case Markers) */
  markers?: CaseMarker[]
  /** Anlık Yakalanan Referans Kareler (Grab Stills) */
  stills?: GradeStill[]
  /** Diyalog Önceliği (Auto-Ducking) */
  autoDucking?: boolean
  /** Zaman Damgalı Altyazı Segmentleri */
  subtitles?: SubtitleSegment[]
  /** Altyazı Görünüm ve Gömme (Burn-In) Ayarları */
  subtitleStyle?: SubtitleStyleConfig
  /** Master Ses Çıkış Kazancı (dB) */
  masterGainDb?: number
}
