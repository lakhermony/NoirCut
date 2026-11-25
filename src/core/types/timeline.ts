import type { MediaTick, TimelineTick } from '../timebase'

export type KeyframeInterpolation = 'linear' | 'bezier' | 'hold'

export type KeyframeParam = 'scale' | 'posX' | 'posY' | 'rotation' | 'opacity' | 'gainDb'

export interface KeyframeBezierHandles {
  outX: number
  outY: number
  inX: number
  inY: number
}

/**
 * Anahtar kare zamanı (`time`) timeline konumuna göre değil,
 * doğrudan ham medya dosyasının 0. tick'ine (`MediaTick`) göre tanımlanır.
 */
export interface Keyframe {
  id: string
  time: MediaTick
  param: KeyframeParam
  value: number
  interpolation: KeyframeInterpolation
  bezierHandles?: KeyframeBezierHandles
}

export interface ClipBaseValues {
  scale: number
  posX: number
  posY: number
  rotation: number
  opacity: number
  gainDb: number
}

export interface Clip {
  id: string
  mediaId: string
  lane: string
  timelineStart: TimelineTick
  sourceIn: MediaTick
  sourceOut: MediaTick
  speed: number
  keyframes: Keyframe[]
  baseValues: ClipBaseValues
}

export type TimelineMarkerKind = 'manual' | 'scene-cut' | 'audio-transient'

export interface TimelineMarker {
  id: string
  time: TimelineTick
  mediaTime?: MediaTick
  kind: TimelineMarkerKind
  title: string
  note: string
  color: string
}

export interface TickTimeline {
  fps: number
  clips: Clip[]
  markers: TimelineMarker[]
}
