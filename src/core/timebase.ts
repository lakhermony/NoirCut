/**
 * NoirCut Çekirdek Zaman Tabanı (Integer Tick Timebase)
 *
 * 254_016_000_000 tick/saniye:
 *   23.976 fps (24000/1001) -> 10_594_000_000 tick/kare
 *   24     fps              -> 10_584_000_000 tick/kare
 *   25     fps              -> 10_160_640_000 tick/kare
 *   29.97  fps (30000/1001) ->  8_475_667_200 tick/kare
 *   30     fps              ->  8_467_200_000 tick/kare
 *   50     fps              ->  5_080_320_000 tick/kare
 *   59.94  fps (60000/1001) ->  4_237_833_600 tick/kare
 *   60     fps              ->  4_233_600_000 tick/kare
 *   44.1   kHz              ->      5_760_000 tick/örnek
 *   48     kHz              ->      5_292_000 tick/örnek
 *   96     kHz              ->      2_646_000 tick/örnek
 */
export const TICKS_PER_SECOND = 254_016_000_000

export type TimelineTick = number & { readonly __brand: 'TimelineTick' }
export type MediaTick = number & { readonly __brand: 'MediaTick' }

export function asTimelineTick(value: number): TimelineTick {
  return Math.round(value) as TimelineTick
}

export function asMediaTick(value: number): MediaTick {
  return Math.round(value) as MediaTick
}

/**
 * Verilen kare hızı (NTSC drop-frame oranları dahil) için kare başına tam sayı tick sayısını döndürür.
 */
export function ticksPerFrame(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    return Math.round(TICKS_PER_SECOND / 30)
  }
  if (Math.abs(fps - 23.976) < 0.02 || Math.abs(fps - 24000 / 1001) < 0.005) {
    return (TICKS_PER_SECOND * 1001) / 24000
  }
  if (Math.abs(fps - 29.97) < 0.02 || Math.abs(fps - 30000 / 1001) < 0.005) {
    return (TICKS_PER_SECOND * 1001) / 30000
  }
  if (Math.abs(fps - 59.94) < 0.02 || Math.abs(fps - 60000 / 1001) < 0.005) {
    return (TICKS_PER_SECOND * 1001) / 60000
  }
  return Math.round(TICKS_PER_SECOND / fps)
}

/**
 * Bir TimelineTick değerini en yakın kare ızgarasına (frame grid) oturtur.
 */
export function snapToFrameGrid(tick: TimelineTick, fps: number): TimelineTick {
  const step = ticksPerFrame(fps)
  return asTimelineTick(Math.round(tick / step) * step)
}

/**
 * Saniye cinsinden bir süreyi ham medya dosyası zaman tabanına (MediaTick) çevirir.
 */
export function secondsToMediaTicks(seconds: number): MediaTick {
  if (!Number.isFinite(seconds)) return asMediaTick(0)
  return asMediaTick(seconds * TICKS_PER_SECOND)
}

/**
 * Saniye cinsinden bir süreyi zaman çizelgesi zaman tabanına (TimelineTick) çevirir.
 */
export function secondsToTimelineTicks(seconds: number): TimelineTick {
  if (!Number.isFinite(seconds)) return asTimelineTick(0)
  return asTimelineTick(seconds * TICKS_PER_SECOND)
}

/**
 * Tick değerini sayısal saniyeye çevirir.
 */
export function ticksToSeconds(ticks: TimelineTick | MediaTick): number {
  return ticks / TICKS_PER_SECOND
}

/**
 * Tick değerini FFmpeg CLI ve filtergraph ifadeleri için sabit duyarlıklı saniye dizgisine çevirir.
 */
export function ticksToFFmpegSeconds(ticks: TimelineTick | MediaTick, decimals = 6): string {
  return (ticks / TICKS_PER_SECOND).toFixed(decimals)
}
