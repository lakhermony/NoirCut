import {
  asTimelineTick,
  snapToFrameGrid,
  TICKS_PER_SECOND,
  type TimelineTick
} from '../../core/timebase'

export interface TimelineViewport {
  scrollTick: TimelineTick
  pixelsPerSecond: number
  viewportWidthPx: number
}

export function ticksToPixels(ticks: TimelineTick, pixelsPerSecond: number): number {
  return (ticks / TICKS_PER_SECOND) * pixelsPerSecond
}

export function pixelsToTicks(px: number, pixelsPerSecond: number): TimelineTick {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    return asTimelineTick(0)
  }
  return asTimelineTick((px / pixelsPerSecond) * TICKS_PER_SECOND)
}

export function tickToViewportX(tick: TimelineTick, vp: TimelineViewport): number {
  return ticksToPixels(asTimelineTick(tick - vp.scrollTick), vp.pixelsPerSecond)
}

export function viewportXToTick(
  xPx: number,
  vp: TimelineViewport,
  snapFps?: number
): TimelineTick {
  const raw = asTimelineTick(vp.scrollTick + pixelsToTicks(xPx, vp.pixelsPerSecond))
  return snapFps && snapFps > 0 ? snapToFrameGrid(raw, snapFps) : raw
}

export function visibleTickRange(vp: TimelineViewport): {
  startTick: TimelineTick
  endTick: TimelineTick
} {
  const startTick = vp.scrollTick
  const endTick = asTimelineTick(
    vp.scrollTick + pixelsToTicks(vp.viewportWidthPx, vp.pixelsPerSecond)
  )
  return { startTick, endTick }
}

export function formatTickTimecode(tick: TimelineTick, fps = 30): string {
  const safeTick = Math.max(0, tick)
  const totalSec = Math.floor(safeTick / TICKS_PER_SECOND)
  const remTicks = safeTick - totalSec * TICKS_PER_SECOND
  const frame = Math.floor((remTicks / TICKS_PER_SECOND) * fps)
  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frame)}`
}
