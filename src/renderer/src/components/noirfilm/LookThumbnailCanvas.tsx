import { useEffect, useRef } from 'react'
import { evaluateColorGrade, type ColorGrade } from '../../../../shared/color'
import { BUILTIN_LUTS, type Lut3D } from '../../../../shared/lut'

/**
 * Gerçek evaluateColorGrade + LUT + NoirFilm Emülasyon matematiğini kullanarak
 * küçük önizleme (thumbnail) üretir. Aktif video karesi varsa ondan, yoksa sentetik stüdyo test karesinden örnekler.
 */
export default function LookThumbnailCanvas({
  grade,
  customLuts,
  videoEl,
  className = ''
}: {
  grade: ColorGrade
  customLuts?: Lut3D[]
  videoEl?: HTMLVideoElement | null
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 128
    const H = 72
    canvas.width = W
    canvas.height = H

    // Kaynak piksel verisini al (video karesi veya sinematik test gradyanı)
    let srcData: Uint8ClampedArray | null = null
    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      try {
        ctx.drawImage(videoEl, 0, 0, W, H)
        srcData = ctx.getImageData(0, 0, W, H).data
      } catch {
        srcData = null
      }
    }

    const out = ctx.createImageData(W, H)
    const dst = out.data
    const lut: Lut3D | null = grade.lutId
      ? (customLuts?.find((l) => l.id === grade.lutId) ??
          BUILTIN_LUTS.find((l) => l.id === grade.lutId) ??
          null)
      : null

    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1)
      for (let x = 0; x < W; x++) {
        const nx = x / (W - 1)
        const idx = (y * W + x) * 4

        let r: number
        let g: number
        let b: number

        if (srcData) {
          r = srcData[idx] / 255
          g = srcData[idx + 1] / 255
          b = srcData[idx + 2] / 255
        } else {
          // Zengin stüdyo test karesi: gökyüzü/vurgu, orta cilt tonu spotu, derin gölge
          const dx = nx - 0.5
          const dy = ny - 0.45
          const radial = Math.max(0, 1 - Math.hypot(dx * 1.4, dy * 1.8) * 1.35)
          const horizon = Math.max(0, 1 - ny)
          r = 0.08 + 0.34 * horizon + 0.46 * radial + 0.1 * nx
          g = 0.1 + 0.28 * horizon + 0.31 * radial + 0.05 * (1 - nx)
          b = 0.16 + 0.38 * horizon + 0.18 * radial + 0.12 * (1 - nx)
        }

        const [ro, go, bo] = evaluateColorGrade(r, g, b, grade, lut)
        dst[idx] = Math.round(ro * 255)
        dst[idx + 1] = Math.round(go * 255)
        dst[idx + 2] = Math.round(bo * 255)
        dst[idx + 3] = 255
      }
    }

    ctx.putImageData(out, 0, 0)
  }, [grade, customLuts, videoEl])

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full object-cover ${className}`}
    />
  )
}
