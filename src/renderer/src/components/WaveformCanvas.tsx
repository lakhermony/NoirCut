import { useEffect, useRef } from 'react'
import { dbToGain, fadeGain, type TimelineClip } from '../../../shared/timeline'
import type { PeaksResult } from '../../../shared/types'

/**
 * Gerçek ses dalga formunu (PCM peaks) Canvas üzerine çizer.
 * Klip giriş noktası (in), süresi (duration), ses seviyesi (gainDb)
 * ve Fade In / Fade Out zarfı anlık olarak dalga yüksekliğine yansır.
 */
export default function WaveformCanvas({
  clip,
  peaks,
  width,
  height,
  color = '#F5A623',
  muted = false
}: {
  clip: TimelineClip
  peaks: PeaksResult | undefined
  width: number
  height: number
  color?: string
  muted?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // Orta referans çizgisi (sessizlik çizgisi)
    const mid = h / 2
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(w, mid)
    ctx.stroke()

    const data = peaks?.peaks
    const perSec = peaks?.perSecond ?? 50
    const baseGain = muted ? 0 : dbToGain(clip.gainDb)

    if (data && data.length > 0 && clip.duration > 0) {
      const barStep = 2
      if (muted) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, '#E0F2FE')
        grad.addColorStop(0.25, color)
        grad.addColorStop(0.5, '#FFFFFF')
        grad.addColorStop(0.75, color)
        grad.addColorStop(1, '#E0F2FE')
        ctx.fillStyle = grad
      }

      for (let x = 0; x < w; x += barStep) {
        const localSec = (x / w) * clip.duration
        const srcSec = clip.in + localSec
        const idx = Math.min(data.length - 1, Math.max(0, Math.floor(srcSec * perSec)))
        const norm = (data[idx] ?? 0) / 255
        const env = fadeGain(clip, localSec)
        const amp = Math.min(1, norm * baseGain * env)
        const barH = Math.max(1, amp * (h - 2))
        const top = mid - barH / 2
        ctx.fillRect(x, top, 1.4, barH)
        if (!muted && amp > 0.45) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.fillRect(x, top, 1.4, 1.2)
          ctx.fillRect(x, top + barH - 1.2, 1.4, 1.2)
          const grad = ctx.createLinearGradient(0, 0, 0, h)
          grad.addColorStop(0, '#E0F2FE')
          grad.addColorStop(0.25, color)
          grad.addColorStop(0.5, '#FFFFFF')
          grad.addColorStop(0.75, color)
          grad.addColorStop(1, '#E0F2FE')
          ctx.fillStyle = grad
        }
      }
    }

    // Fade In / Fade Out eğrisi ve gölgeli alanı
    if (clip.duration > 0 && (clip.fadeIn > 0.01 || clip.fadeOut > 0.01)) {
      const fiX = Math.min(w, (clip.fadeIn / clip.duration) * w)
      const foX = Math.max(0, w - (clip.fadeOut / clip.duration) * w)

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      if (fiX > 1) {
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(fiX, 0)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fill()
      }
      if (foX < w - 1) {
        ctx.beginPath()
        ctx.moveTo(foX, 0)
        ctx.lineTo(w, 0)
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()
      }

      // Zarf çizgisi
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(0, fiX > 1 ? h : 2)
      if (fiX > 1) ctx.lineTo(fiX, 2)
      ctx.lineTo(foX, 2)
      if (foX < w - 1) ctx.lineTo(w, h)
      ctx.stroke()
    }
  }, [clip, peaks, width, height, color, muted])

  return (
    <canvas
      ref={canvasRef}
      data-testid={`waveform-${clip.id}`}
      className="pointer-events-none block h-full w-full"
      style={{ width: `${Math.max(1, Math.floor(width))}px`, height: `${height}px` }}
    />
  )
}
