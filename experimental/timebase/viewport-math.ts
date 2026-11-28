import {
  asTimelineTick,
  TICKS_PER_SECOND,
  type TimelineTick
} from '../../src/core/timebase'

/**
 * Zaman Çizelgesi Görünüm Alanı ve Piksel ↔ Tick Dönüşüm Matematiği (Deneysel / Park Edildi).
 *
 * Tüm timeline koordinatları 64-bit tam sayı tick cinsindendir (`254_016_000_000 tick/sn`).
 * Üretim UI henüz saniye tabanlı olduğu için `experimental/timebase/` altında tutulmaktadır.
 */

export function ticksToPixels(ticks: TimelineTick, pixelsPerSecond: number): number {
  return (ticks / TICKS_PER_SECOND) * pixelsPerSecond
}

export function pixelsToTicks(px: number, pixelsPerSecond: number): TimelineTick {
  if (pixelsPerSecond <= 0) return asTimelineTick(0)
  return asTimelineTick((px / pixelsPerSecond) * TICKS_PER_SECOND)
}

const NICE_STEP_SECONDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]

export function getRulerStepTicks(pixelsPerSecond: number, minStepPx = 64): TimelineTick {
  if (pixelsPerSecond <= 0) return asTimelineTick(TICKS_PER_SECOND)
  for (const sec of NICE_STEP_SECONDS) {
    if (sec * pixelsPerSecond >= minStepPx) {
      return asTimelineTick(sec * TICKS_PER_SECOND)
    }
  }
  return asTimelineTick(3600 * TICKS_PER_SECOND)
}

export function formatTimecodeFromTicks(ticks: TimelineTick, fps: number): string {
  const safeTick = Math.max(0, ticks)
  const totalSec = Math.floor(safeTick / TICKS_PER_SECOND)
  const remTicks = safeTick - totalSec * TICKS_PER_SECOND
  const frame = Math.floor((remTicks / TICKS_PER_SECOND) * fps)

  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(Math.min(Math.max(0, Math.round(fps) - 1), frame))}`
}
