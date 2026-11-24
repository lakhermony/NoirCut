import type { SubtitleSegment, SubtitleStyleConfig } from './timeline'

export interface SubtitleAnimationFrame {
  id: string
  start: number
  end: number
  activeWordIdx: number
  visibleCharCount: number
  words: string[]
}

/**
 * Altyazı animasyon moduna ('none' | 'karaoke' | 'hormozi' | 'typewriter') göre
 * bir SubtitleSegment'i zaman dilimli kare listesine böler (önizleme ve export eşliği).
 */
export function computeSubtitleAnimationFrames(
  seg: SubtitleSegment,
  style: SubtitleStyleConfig
): SubtitleAnimationFrame[] {
  const raw = (seg.text ?? '').trim()
  const dur = seg.end - seg.start
  if (!raw || dur <= 0.01) return []

  const anim = style.animation ?? 'none'
  const words = raw.split(/\s+/).filter(Boolean)

  if (anim === 'none' || words.length <= 1) {
    return [
      {
        id: seg.id,
        start: seg.start,
        end: seg.end,
        activeWordIdx: words.length - 1,
        visibleCharCount: raw.length,
        words
      }
    ]
  }

  if (anim === 'typewriter') {
    const steps = Math.min(raw.length, Math.max(2, Math.min(24, Math.ceil(dur * 10))))
    const frames: SubtitleAnimationFrame[] = []
    for (let i = 0; i < steps; i++) {
      const fStart = seg.start + (i / steps) * dur
      const fEnd = seg.start + ((i + 1) / steps) * dur
      const visibleCharCount = Math.max(1, Math.ceil(((i + 1) / steps) * raw.length))
      frames.push({
        id: `${seg.id}-tw-${i}`,
        start: fStart,
        end: fEnd,
        activeWordIdx: words.length - 1,
        visibleCharCount,
        words
      })
    }
    return frames
  }

  // 'karaoke' veya 'hormozi': kelime başına bir zaman dilimi
  const frames: SubtitleAnimationFrame[] = []
  for (let idx = 0; idx < words.length; idx++) {
    const fStart = seg.start + (idx / words.length) * dur
    const fEnd = seg.start + ((idx + 1) / words.length) * dur
    frames.push({
      id: `${seg.id}-w-${idx}`,
      start: fStart,
      end: fEnd,
      activeWordIdx: idx,
      visibleCharCount: raw.length,
      words
    })
  }
  return frames
}
