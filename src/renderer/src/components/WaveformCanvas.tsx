import { memo, useEffect, useRef } from 'react'
import { dbToGain, fadeGain, type TimelineClip } from '../../../shared/timeline'
import type { PeaksResult } from '../../../shared/types'

/**
 * Gerçek ses dalga formunu (PCM peaks) Canvas üzerine çizer.
 * - `variant="embedded"`: Video kliplerinin alt ses şeridinde (referans görseldeki gibi)
 *   yatay referans çizgisi ve alttan yukarıya dolgulu silüet dalga formu çizer.
 * - `variant="track"`: Bağımsız ses kanallarında (A1, A2...) zengin stüdyo dalga formu çizer.
 */
function WaveformCanvasInner({
  clip,
  peaks,
  width,
  height,
  color = '#7CC4F8',
  muted = false,
  variant = 'track'
}: {
  clip: TimelineClip
  peaks: PeaksResult | undefined
  width: number
  height: number
  color?: string
  muted?: boolean
  variant?: 'embedded' | 'track'
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const data = peaks?.peaks
    const perSec = peaks?.perSecond ?? 50
    const baseGain = muted ? 0 : dbToGain(clip.gainDb)
    const speed = Math.max(0.25, Math.min(4.0, (clip.speed ?? 100) / 100))

    if (variant === 'embedded') {
      // Üst referans / seviye çizgisi (Final Cut / DaVinci tarzı ince ufuk çizgisi)
      const refY = Math.max(3.5, Math.round(h * 0.28) + 0.5)
      ctx.strokeStyle = muted
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(176, 206, 242, 0.38)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, refY)
      ctx.lineTo(w, refY)
      ctx.stroke()

      if (clip.duration > 0) {
        const step = 1.5
        ctx.beginPath()
        ctx.moveTo(0, h)

        for (let x = 0; x <= w; x += step) {
          const localSec = (x / Math.max(1, w)) * clip.duration
          const srcSec = clip.in + localSec * speed
          let norm = 0.18
          if (data && data.length > 0) {
            const idx = Math.min(data.length - 1, Math.max(0, Math.floor(srcSec * perSec)))
            // Komşu örneklerle hafif yumuşatma
            const c0 = data[idx] ?? 0
            const c1 = data[Math.min(data.length - 1, idx + 1)] ?? c0
            norm = (c0 * 0.65 + c1 * 0.35) / 255
          } else {
            // Peaks yüklenirken çok hafif organik taban izi
            norm = 0.12 + 0.06 * Math.sin(srcSec * 9.5) * Math.cos(srcSec * 4.2)
          }
          const env = fadeGain(clip, localSec)
          const amp = muted ? norm * 0.25 : Math.min(1, norm * baseGain * env)
          const peakH = Math.max(1.5, amp * (h - 3))
          const y = Math.max(1, h - peakH)
          ctx.lineTo(x, y)
        }

        ctx.lineTo(w, h)
        ctx.closePath()

        const fillGrad = ctx.createLinearGradient(0, 1, 0, h)
        if (muted) {
          fillGrad.addColorStop(0, 'rgba(148, 163, 184, 0.22)')
          fillGrad.addColorStop(1, 'rgba(148, 163, 184, 0.08)')
        } else {
          fillGrad.addColorStop(0, 'rgba(156, 198, 245, 0.56)')
          fillGrad.addColorStop(1, 'rgba(92, 145, 209, 0.24)')
        }
        ctx.fillStyle = fillGrad
        ctx.fill()

        // Üst kontur parlaması
        ctx.strokeStyle = muted
          ? 'rgba(148, 163, 184, 0.28)'
          : 'rgba(195, 224, 255, 0.68)'
        ctx.lineWidth = 0.9
        ctx.stroke()
      }
    } else {
      // Bağımsız Ses Kanalı (A1 / A2...)
      const mid = h / 2
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()

      if (data && data.length > 0 && clip.duration > 0) {
        const barStep = 2
        const vuGrad = ctx.createLinearGradient(0, 0, 0, h)
        vuGrad.addColorStop(0.0, '#F43F5E')
        vuGrad.addColorStop(0.2, '#38BDF8')
        vuGrad.addColorStop(0.5, color)
        vuGrad.addColorStop(0.8, '#38BDF8')
        vuGrad.addColorStop(1.0, '#F43F5E')

        ctx.fillStyle = muted ? 'rgba(255, 255, 255, 0.20)' : vuGrad

        for (let x = 0; x < w; x += barStep) {
          const localSec = (x / Math.max(1, w)) * clip.duration
          const srcSec = clip.in + localSec * speed
          const idx = Math.min(data.length - 1, Math.max(0, Math.floor(srcSec * perSec)))
          const norm = (data[idx] ?? 0) / 255
          const env = fadeGain(clip, localSec)
          const amp = Math.min(1, norm * baseGain * env)
          const barH = Math.max(1.2, amp * (h - 4))
          const top = mid - barH / 2
          ctx.fillRect(x, top, 1.35, barH)
        }
      }
    }

    // Fade In / Fade Out eğrisi ve gölgeli alanı
    if (clip.duration > 0 && (clip.fadeIn > 0.01 || clip.fadeOut > 0.01)) {
      const fiX = Math.min(w, (clip.fadeIn / clip.duration) * w)
      const foX = Math.max(0, w - (clip.fadeOut / clip.duration) * w)

      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
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

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)'
      ctx.lineWidth = 1.15
      ctx.beginPath()
      ctx.moveTo(0, fiX > 1 ? h : 2)
      if (fiX > 1) ctx.lineTo(fiX, 2)
      ctx.lineTo(foX, 2)
      if (foX < w - 1) ctx.lineTo(w, h)
      ctx.stroke()
    }

    ctx.restore()
  }, [clip, peaks, width, height, color, muted, variant])

  return (
    <canvas
      ref={canvasRef}
      data-testid={`waveform-${clip.id}`}
      className="pointer-events-none block h-full w-full"
      style={{ width: `${Math.max(1, Math.floor(width))}px`, height: `${height}px` }}
    />
  )
}

const WaveformCanvas = memo(WaveformCanvasInner)
export default WaveformCanvas
