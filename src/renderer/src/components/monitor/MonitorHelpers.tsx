import type React from 'react'
import {
  defaultClipTransform,
  evaluateClipTransformAt,
  type TimelineClip
} from '../../../../shared/timeline'

export function computeClipTransformStyle(
  clip: TimelineClip | null | undefined,
  time: number
): React.CSSProperties {
  const tf = clip ? evaluateClipTransformAt(clip, time) : defaultClipTransform()
  let scale = Math.max(0.1, Math.min(4, (tf.scale ?? 100) / 100))
  let tx = tf.posX ?? 0
  const ty = tf.posY ?? 0
  const rot = tf.rotation ?? 0
  let opacity = Math.max(0, Math.min(1, (tf.opacity ?? 100) / 100))
  let clipPath: string | undefined
  let filter: string | undefined

  if (
    clip &&
    clip.transitionType &&
    clip.transitionType !== 'none' &&
    (clip.transitionDuration ?? 0) > 0.05
  ) {
    const trDur = Math.min(clip.duration * 0.5, clip.transitionDuration ?? 0.8)
    const local = Math.max(0, Math.min(clip.duration, time - clip.start))
    let f = 1
    let isEntering = false
    if (local < trDur) {
      f = local / trDur
      isEntering = true
    } else if (clip.duration - local < trDur) {
      f = (clip.duration - local) / trDur
    }
    f = Math.max(0, Math.min(1, f))

    if (f < 1) {
      switch (clip.transitionType) {
        case 'wipe-left': {
          const pct = ((1 - f) * 100).toFixed(2)
          clipPath = isEntering ? `inset(0 ${pct}% 0 0)` : `inset(0 0 0 ${pct}%)`
          break
        }
        case 'slide-left': {
          tx += isEntering ? (1 - f) * 100 : -(1 - f) * 100
          break
        }
        case 'zoom-in': {
          scale *= 1 + (1 - f) * 0.45
          opacity *= f
          break
        }
        case 'film-burn': {
          const burn = 1 - f
          filter = `brightness(${(1 + burn * 1.45).toFixed(2)}) saturate(${(1 + burn * 0.9).toFixed(2)}) sepia(${(burn * 0.45).toFixed(2)})`
          opacity *= Math.min(1, f * 1.25)
          break
        }
        case 'dip-to-black': {
          opacity *= Math.pow(f, 1.35)
          break
        }
        default: {
          opacity *= f
          break
        }
      }
    }
  }

  return {
    transform: `translate(${tx}%, ${ty}%) scale(${scale}) rotate(${rot}deg)`,
    opacity,
    clipPath,
    filter,
    transformOrigin: 'center center'
  }
}

/** Video seçilmemişken gösterilen yer tutucu kare */
export function MonitorEmptyScene() {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d7a96" />
          <stop offset="0.55" stopColor="#c9b79a" />
          <stop offset="1" stopColor="#d9a76a" />
        </linearGradient>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3d0" />
          <stop offset="1" stopColor="#fff3d0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)" />
      <circle cx="1100" cy="470" r="220" fill="url(#sun)" />
      <path d="M0 620 L260 440 L480 560 L760 380 L1060 580 L1320 450 L1600 600 V900 H0Z" fill="#5a6b73" />
      <path d="M0 720 L300 560 L620 700 L940 540 L1280 700 L1600 620 V900 H0Z" fill="#2c3a40" />
      <path d="M0 820 Q400 740 800 800 T1600 790 V900 H0Z" fill="#12181b" />
    </svg>
  )
}
