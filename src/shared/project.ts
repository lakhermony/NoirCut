/**
 * .noircut proje dosyası veri modeli (JSON).
 */
import type { ColorGrade } from './color'
import type { CreditConfig } from './credits'
import type { Lut3D } from './lut'
import type { ExportSettings, LaneMap, TimelineClip } from './timeline'

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
}
