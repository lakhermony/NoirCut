import type { NoirCutProject } from '../shared/project'
import type { CaseMarker, TimelineClip } from '../shared/timeline'
import {
  asMediaTick,
  secondsToMediaTicks,
  secondsToTimelineTicks,
  ticksToSeconds,
  type MediaTick
} from './timebase'
import type {
  Clip,
  Keyframe,
  KeyframeInterpolation,
  TickTimeline,
  TimelineMarker
} from './types/timeline'

function computeLegacyEffectiveSpeed(
  legacy: Pick<TimelineClip, 'duration' | 'speed' | 'speedRamp'>
): number {
  const pts = legacy.speedRamp
  if (!pts || pts.length === 0) {
    const pct = typeof legacy.speed === 'number' && Number.isFinite(legacy.speed) && legacy.speed > 0
      ? legacy.speed
      : 100
    return Math.max(0.1, pct / 100)
  }
  if (pts.length === 1) {
    return Math.max(0.1, (pts[0].speed || 100) / 100)
  }
  const sorted = [...pts].sort((a, b) => a.time - b.time)
  const dur = Math.max(0.05, legacy.duration)
  let totalWeight = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    totalWeight += Math.max(0, b.time - a.time) * (((a.speed + b.speed) / 2) / 100)
  }
  return Math.max(0.1, totalWeight / dur || 1)
}

function mapLegacyEasing(easing: 'linear' | 'ease-in-out' | undefined): KeyframeInterpolation {
  return easing === 'linear' ? 'linear' : 'bezier'
}

/**
 * Eski saniye tabanlı TimelineClip kaydını tam sayı tick ve media-time keyframe tabanlı
 * çekirdek `Clip` modeline dönüştürür.
 */
export function timelineClipToCoreClip(legacy: TimelineClip): Clip {
  const speed = computeLegacyEffectiveSpeed(legacy)
  const sourceIn = secondsToMediaTicks(legacy.in)
  const sourceOut = secondsToMediaTicks(legacy.in + legacy.duration * speed)
  const timelineStart = secondsToTimelineTicks(legacy.start)
  const baseTf = legacy.transform ?? {
    scale: 100,
    posX: 0,
    posY: 0,
    rotation: 0,
    opacity: 100
  }

  const keyframes: Keyframe[] = []
  for (const kf of legacy.keyframes ?? []) {
    const mediaTime = asMediaTick(sourceIn + secondsToMediaTicks(kf.time * speed))
    keyframes.push({
      id: kf.id,
      time: mediaTime,
      param: kf.param,
      value: kf.value,
      interpolation: mapLegacyEasing(kf.easing ?? legacy.keyframeEasing)
    })
  }

  for (const gkf of legacy.gainKeyframes ?? []) {
    const mediaTime = asMediaTick(sourceIn + secondsToMediaTicks(gkf.time * speed))
    keyframes.push({
      id: gkf.id,
      time: mediaTime,
      param: 'gainDb',
      value: gkf.db,
      interpolation: 'linear'
    })
  }

  return {
    id: legacy.id,
    mediaId: legacy.mediaId,
    lane: legacy.lane,
    timelineStart,
    sourceIn,
    sourceOut,
    speed,
    keyframes,
    baseValues: {
      scale: baseTf.scale,
      posX: baseTf.posX,
      posY: baseTf.posY,
      rotation: baseTf.rotation,
      opacity: baseTf.opacity,
      gainDb: legacy.gainDb ?? 0
    }
  }
}

/**
 * Çekirdek `Clip` modelini geriye dönük uyumlu `TimelineClip` yapısına geri dönüştürür.
 */
export function coreClipToTimelineClip(
  core: Clip,
  baseLegacy: TimelineClip
): TimelineClip {
  const speed = core.speed > 0 ? core.speed : 1
  const start = ticksToSeconds(core.timelineStart)
  const inPoint = ticksToSeconds(core.sourceIn)
  const outPoint = ticksToSeconds(core.sourceOut)
  const duration = Math.max(0.05, (outPoint - inPoint) / speed)

  const transformKfs = core.keyframes
    .filter((k) => k.param !== 'gainDb')
    .map((k) => ({
      id: k.id,
      time: Math.max(0, ticksToSeconds(asMediaTick(k.time - core.sourceIn)) / speed),
      param: k.param as Exclude<Keyframe['param'], 'gainDb'>,
      value: k.value,
      easing: (k.interpolation === 'linear' ? 'linear' : 'ease-in-out') as
        | 'linear'
        | 'ease-in-out'
    }))

  const gainKfs = core.keyframes
    .filter((k) => k.param === 'gainDb')
    .map((k) => ({
      id: k.id,
      time: Math.max(0, ticksToSeconds(asMediaTick(k.time - core.sourceIn)) / speed),
      db: k.value
    }))

  return {
    ...baseLegacy,
    id: core.id,
    mediaId: core.mediaId,
    lane: core.lane,
    start,
    in: inPoint,
    duration,
    speed: Math.round(core.speed * 100),
    keyframes: transformKfs.length > 0 ? transformKfs : undefined,
    gainKeyframes: gainKfs.length > 0 ? gainKfs : undefined
  }
}

/**
 * Eski saniye tabanlı CaseMarker (SC / TR / Manuel) işaretçisini tick tabanına çevirir.
 */
export function legacyMarkerToTimelineMarker(
  marker: CaseMarker,
  colorHex = '#F59E0B'
): TimelineMarker {
  return {
    id: marker.id,
    time: secondsToTimelineTicks(marker.time),
    mediaTime: secondsToMediaTicks(marker.time),
    kind: marker.kind ?? 'manual',
    title: marker.title,
    note: marker.note,
    color: colorHex
  }
}

/**
 * `ffprobe` tarafından döndürülen saniye süresini `MediaTick` tam sayısına çevirir.
 */
export function adaptLegacyProbeDuration(durationSeconds: number): MediaTick {
  return secondsToMediaTicks(Math.max(0, durationSeconds))
}

/**
 * `SC` (Scene Cut) ve `TR` (Audio Transient) analizlerinden gelen saniye dizilerini
 * `secondsToMediaTicks` ile `MediaTick` dizisine dönüştürür.
 */
export function adaptAnalysisTimestampsToMediaTicks(timestamps: readonly number[]): MediaTick[] {
  return timestamps.map((t) => secondsToMediaTicks(t))
}

/**
 * Eski `.noircut` proje kaydını (saniye tabanlı klipler ve işaretçiler)
 * tam sayı tick tabanlı `TickTimeline` modeline dönüştürür.
 */
export function adaptLegacyProjectToTickTimeline(
  project: Pick<NoirCutProject, 'clips' | 'markers' | 'exportSettings'>,
  fpsOverride?: number
): TickTimeline {
  const fps = fpsOverride ?? project.exportSettings?.fps ?? 30
  return {
    fps,
    clips: (project.clips ?? []).map((c) => timelineClipToCoreClip(c)),
    markers: (project.markers ?? []).map((m) => legacyMarkerToTimelineMarker(m))
  }
}
