import { cloneColorGrade, type ColorGrade } from '../../../shared/color'
import { cloneCreditConfig } from '../../../shared/credits'
import {
  cloneKeyframes,
  type CaseMarker,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import { THEME_OPTIONS, type ThemeId } from '../types'

export const THEME_STORAGE_KEY = 'noircut-theme'
export const TIMELINE_HEIGHT_KEY = 'noircut-timeline-height'
export const DEFAULT_TIMELINE_HEIGHT = 284
export const MIN_TIMELINE_HEIGHT = 176
export const MAX_TIMELINE_HEIGHT = 520

export function getInitialTimelineHeight(): number {
  try {
    const raw = window.localStorage.getItem(TIMELINE_HEIGHT_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= MIN_TIMELINE_HEIGHT && n <= MAX_TIMELINE_HEIGHT) {
      return Math.round(n)
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_TIMELINE_HEIGHT
}

export function getInitialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && THEME_OPTIONS.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // ignore storage errors
  }
  return 'noir-green'
}

export interface HistoryEntry {
  clips: TimelineClip[]
  fallbackGrade: ColorGrade
  lanes: LaneMap
  markers: CaseMarker[]
  autoDucking: boolean
  selectedClipId: string | null
  selectedClipIds: string[]
  inPoint: number | null
  outPoint: number | null
  label: string
}

export function cloneMarkerList(ms: CaseMarker[]): CaseMarker[] {
  return ms.map((m) => ({ ...m }))
}

export function cloneClipItem(c: TimelineClip, seen: Set<TimelineClip> = new Set()): TimelineClip {
  if (!c || typeof c !== 'object') return c
  if (seen.has(c)) {
    return {
      ...c,
      nestedClips: undefined
    }
  }
  const nextSeen = new Set(seen)
  nextSeen.add(c)
  return {
    ...c,
    grade: c.grade ? cloneColorGrade(c.grade) : undefined,
    credit: c.credit ? cloneCreditConfig(c.credit) : undefined,
    transform: c.transform ? { ...c.transform } : undefined,
    keyframes: cloneKeyframes(c.keyframes),
    audioEffects: c.audioEffects ? { ...c.audioEffects } : undefined,
    nestedClips: Array.isArray(c.nestedClips)
      ? c.nestedClips.map((child) => cloneClipItem(child, nextSeen))
      : undefined
  }
}

export function cloneClipList(cs: TimelineClip[]): TimelineClip[] {
  return Array.isArray(cs) ? cs.map((c) => cloneClipItem(c)) : []
}

export function cloneLaneMap(ls: LaneMap): LaneMap {
  const out: LaneMap = {}
  for (const [k, v] of Object.entries(ls)) {
    if (v) out[k] = { ...v }
  }
  return out
}
