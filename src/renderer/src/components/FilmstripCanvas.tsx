import { memo, useEffect, useRef, useState } from 'react'
import type { TimelineClip } from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'
import {
  requestFilmstripFrame,
  subscribeFilmstripMedia
} from '../lib/filmstrip-cache'

function getSourceDimensions(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLCanvasElement) {
    return { w: src.width || 160, h: src.height || 90 }
  }
  if (src instanceof HTMLImageElement) {
    return { w: src.naturalWidth || 160, h: src.naturalHeight || 90 }
  }
  if (src instanceof HTMLVideoElement) {
    return { w: src.videoWidth || 160, h: src.videoHeight || 90 }
  }
  return { w: 160, h: 90 }
}

/**
 * Bir kareyi hedef hücreye (dx, dy, dw, dh) sündürmeden (object-cover mantığıyla)
 * orijinal en-boy oranını koruyarak çizer.
 */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const { w: sw, h: sh } = getSourceDimensions(source)
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return

  const srcAspect = sw / sh
  const dstAspect = dw / dh

  let sx = 0
  let sy = 0
  let sWidth = sw
  let sHeight = sh

  if (srcAspect > dstAspect) {
    sWidth = sh * dstAspect
    sx = (sw - sWidth) * 0.5
  } else if (srcAspect < dstAspect) {
    sHeight = sw / dstAspect
    sy = (sh - sHeight) * 0.5
  }

  ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh)
}

function FilmstripCanvasInner({
  clip,
  media,
  width,
  height
}: {
  clip: TimelineClip
  media: MediaItem | undefined
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!media?.id) return
    let rafId: number | null = null
    const unsub = subscribeFilmstripMedia(media.id, () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        setRevision((r) => r + 1)
      })
    })
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      unsub()
    }
  }, [media?.id])

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

    // Koyu sinematik taban (siyah flaş yerine yumuşak antrasit zemin)
    ctx.fillStyle = '#151c26'
    ctx.fillRect(0, 0, w, h)

    // Orijinal medya en-boy oranına göre filmstrip kare genişliği
    const rawAspect =
      media && media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9
    const clampedAspect = Math.max(1.15, Math.min(1.9, rawAspect))
    const tileW = Math.max(36, Math.round(h * clampedAspect))
    const tileCount = Math.max(1, Math.ceil(w / tileW))

    const speed = Math.max(0.25, Math.min(4.0, (clip.speed ?? 100) / 100))
    const sourceSpan = Math.max(0.05, clip.duration * speed)
    const isReversed = Boolean(clip.reverse)

    for (let i = 0; i < tileCount; i++) {
      const dx = i * tileW
      const dw = Math.min(tileW, w - dx)
      if (dw <= 0) break

      // Hücrenin orta noktasına karşılık gelen kaynak zaman damgası
      const centerRatio = tileCount === 1 ? 0.15 : (i + 0.35) / tileCount
      const ratio = isReversed ? 1 - centerRatio : centerRatio
      const srcTime = clip.in + ratio * sourceSpan

      const frameSource = requestFilmstripFrame(media, srcTime)
      if (frameSource) {
        drawCoverImage(ctx, frameSource, dx, 0, dw, h)
      } else {
        const grad = ctx.createLinearGradient(dx, 0, dx + dw, h)
        grad.addColorStop(0, '#1e2836')
        grad.addColorStop(1, '#141b24')
        ctx.fillStyle = grad
        ctx.fillRect(dx, 0, dw, h)
      }

      // Bitişik filmstrip kareleri arasında ince sinematik ayrım çizgisi
      if (i > 0) {
        ctx.fillStyle = 'rgba(8, 12, 18, 0.32)'
        ctx.fillRect(dx, 0, 1, h)
      }
    }

    // Üst ve alt kenarda çok hafif iç kontrast gölgesi (derinlik hissi için)
    const vignette = ctx.createLinearGradient(0, 0, 0, h)
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0.14)')
    vignette.addColorStop(0.18, 'rgba(0, 0, 0, 0)')
    vignette.addColorStop(0.82, 'rgba(0, 0, 0, 0)')
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.18)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, w, h)

    ctx.restore()
  }, [
    clip.id,
    clip.in,
    clip.duration,
    clip.speed,
    clip.reverse,
    media,
    width,
    height,
    revision
  ])

  return (
    <canvas
      ref={canvasRef}
      data-testid={`filmstrip-${clip.id}`}
      className="pointer-events-none block h-full w-full select-none"
      style={{
        width: `${Math.max(1, Math.floor(width))}px`,
        height: `${Math.max(1, Math.floor(height))}px`
      }}
    />
  )
}

const FilmstripCanvas = memo(FilmstripCanvasInner)
export default FilmstripCanvas
