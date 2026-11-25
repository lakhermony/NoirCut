import { asMediaTick, asTimelineTick, snapToFrameGrid, type MediaTick, type TimelineTick } from './timebase'
import type { Clip, Keyframe, KeyframeBezierHandles, KeyframeParam } from './types/timeline'

/**
 * Bir klibin zaman çizelgesi üzerindeki toplam süresini (TimelineTick) döndürür.
 */
export function clipTimelineDuration(
  clip: Pick<Clip, 'sourceIn' | 'sourceOut' | 'speed'>
): TimelineTick {
  const mediaSpan = Math.max(0, clip.sourceOut - clip.sourceIn)
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
  return asTimelineTick(mediaSpan / speed)
}

/**
 * Verilen zaman çizelgesi tick'ini klibin ham medya dosyasındaki karşılık gelen MediaTick'e çevirir.
 */
export function timelineToMediaTick(
  clip: Pick<Clip, 'timelineStart' | 'sourceIn' | 'sourceOut' | 'speed'>,
  timelineTick: TimelineTick
): MediaTick {
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
  const localTimeline = Math.max(0, timelineTick - clip.timelineStart)
  const rawMedia = clip.sourceIn + Math.round(localTimeline * speed)
  const clamped = Math.max(clip.sourceIn, Math.min(clip.sourceOut, rawMedia))
  return asMediaTick(clamped)
}

/**
 * Ham medya MediaTick konumunu klibin zaman çizelgesi konumuna (TimelineTick) çevirir.
 */
export function mediaToTimelineTick(
  clip: Pick<Clip, 'timelineStart' | 'sourceIn' | 'speed'>,
  mediaTick: MediaTick
): TimelineTick {
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
  const deltaMedia = mediaTick - clip.sourceIn
  return asTimelineTick(clip.timelineStart + deltaMedia / speed)
}

function evalCubicBezierY(u: number, handles?: KeyframeBezierHandles): number {
  const p1x = handles?.outX ?? 0.42
  const p1y = handles?.outY ?? 0.0
  const p2x = handles?.inX ?? 0.58
  const p2y = handles?.inY ?? 1.0

  // Newton-Raphson ile t (x(t) = u) çözümü
  let t = u
  for (let i = 0; i < 6; i++) {
    const inv = 1 - t
    const x = 3 * inv * inv * t * p1x + 3 * inv * t * t * p2x + t * t * t
    const dx =
      3 * inv * inv * p1x +
      6 * inv * t * (p2x - p1x) +
      3 * t * t * (1 - p2x)
    const err = x - u
    if (Math.abs(err) < 1e-5 || Math.abs(dx) < 1e-6) break
    t = Math.max(0, Math.min(1, t - err / dx))
  }
  const inv = 1 - t
  return 3 * inv * inv * t * p1y + 3 * inv * t * t * p2y + t * t * t
}

/**
 * Verilen parametre için keyframe listesi üzerinde binary-search (O(log n)) ile
 * ham medya tick'indeki değeri hesaplar.
 */
export function evaluateParameterAtMediaTick(
  keyframes: readonly Keyframe[],
  param: KeyframeParam,
  mediaTick: MediaTick,
  fallbackValue: number
): number {
  const filtered = keyframes
    .filter((k) => k.param === param)
    .slice()
    .sort((a, b) => a.time - b.time)

  if (filtered.length === 0) return fallbackValue
  if (filtered.length === 1) return filtered[0].value
  if (mediaTick <= filtered[0].time) return filtered[0].value

  const lastIdx = filtered.length - 1
  if (mediaTick >= filtered[lastIdx].time) return filtered[lastIdx].value

  // Binary search: filtered[lo].time <= mediaTick < filtered[lo + 1].time
  let lo = 0
  let hi = lastIdx - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (filtered[mid].time <= mediaTick && mediaTick <= filtered[mid + 1].time) {
      lo = mid
      break
    }
    if (filtered[mid].time < mediaTick) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const a = filtered[lo]
  const b = filtered[lo + 1]
  if (!b || a.time === b.time) return a.value

  if (a.interpolation === 'hold') {
    return a.value
  }

  const span = Math.max(1, b.time - a.time)
  const u = Math.max(0, Math.min(1, (mediaTick - a.time) / span))
  const eased =
    a.interpolation === 'bezier' ? evalCubicBezierY(u, a.bezierHandles) : u

  return a.value + (b.value - a.value) * eased
}

/**
 * Klibi sol kenardan kırpar (`deltaTimelineTicks > 0` ise sağa doğru kısaltır, `< 0` ise sola uzatır).
 * Keyframe'ler `MediaTick` cinsinden ham medyaya bağlı olduğu için keyframe zamanları bozulmaz/kaydırılmaz.
 */
export function trimClipLeft(
  clip: Clip,
  deltaTimelineTicks: TimelineTick,
  fps?: number
): Clip {
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
  const currentDur = clipTimelineDuration(clip)
  const minRemainTimeline = asTimelineTick(fps ? Math.max(1, Math.round(254_016_000_000 / fps)) : 1)
  const maxDelta = Math.max(0, currentDur - minRemainTimeline)
  const minDelta = -Math.floor(clip.sourceIn / speed)

  let clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaTimelineTicks))
  let nextTimelineStart = asTimelineTick(clip.timelineStart + clampedDelta)
  if (fps && fps > 0) {
    nextTimelineStart = snapToFrameGrid(nextTimelineStart, fps)
    clampedDelta = asTimelineTick(nextTimelineStart - clip.timelineStart)
  }

  const nextSourceIn = asMediaTick(
    Math.max(0, Math.min(clip.sourceOut - 1, clip.sourceIn + Math.round(clampedDelta * speed)))
  )

  return {
    ...clip,
    timelineStart: nextTimelineStart,
    sourceIn: nextSourceIn
  }
}

/**
 * Klibi belirtilen `splitTick` zaman çizelgesi noktasından ikiye böler.
 * Her iki parçadaki keyframe'ler ham medya zamanına (`MediaTick`) bağlı kaldığı için
 * keyframe zamanları korunur.
 */
export function splitClipAtTimelineTick(
  clip: Clip,
  splitTick: TimelineTick,
  rightClipId: string
): [Clip, Clip] | null {
  const dur = clipTimelineDuration(clip)
  const timelineEnd = asTimelineTick(clip.timelineStart + dur)
  if (splitTick <= clip.timelineStart || splitTick >= timelineEnd) {
    return null
  }

  const splitMediaTick = timelineToMediaTick(clip, splitTick)
  if (splitMediaTick <= clip.sourceIn || splitMediaTick >= clip.sourceOut) {
    return null
  }

  const leftClip: Clip = {
    ...clip,
    sourceOut: splitMediaTick,
    keyframes: clip.keyframes.map((k) => ({ ...k }))
  }

  const rightClip: Clip = {
    ...clip,
    id: rightClipId,
    timelineStart: splitTick,
    sourceIn: splitMediaTick,
    keyframes: clip.keyframes.map((k) => ({ ...k }))
  }

  return [leftClip, rightClip]
}
