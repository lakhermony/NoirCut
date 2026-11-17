import { useCallback, useEffect, useRef, useState } from 'react'
import { evaluateColorGrade, type ColorGrade } from '../../../shared/color'
import type { Lut3D } from '../../../shared/lut'
import type { MediaItem } from '../../../shared/types'

export type ScopeMode = 'parade' | 'waveform' | 'vectorscope' | 'histogram'

// BT.709 standart renk hedefleri (R, Yl, G, Cy, B, Mg)
const VECTOR_TARGETS: Array<{
  label: string
  r: number
  g: number
  b: number
  color: string
}> = [
  { label: 'R', r: 1, g: 0, b: 0, color: '#EF4444' },
  { label: 'Yl', r: 1, g: 1, b: 0, color: '#EAB308' },
  { label: 'G', r: 0, g: 1, b: 0, color: '#22C55E' },
  { label: 'Cy', r: 0, g: 1, b: 1, color: '#06B6D4' },
  { label: 'B', r: 0, g: 0, b: 1, color: '#3B82F6' },
  { label: 'Mg', r: 1, g: 0, b: 1, color: '#EC4899' }
]

export default function VideoScopes({
  videoRef,
  media,
  grade,
  activeLut,
  playing,
  time,
  className = 'glass flex h-full w-[340px] shrink-0 flex-col justify-between overflow-hidden p-3'
}: {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  media: MediaItem | null
  grade: ColorGrade
  activeLut: Lut3D | null
  playing: boolean
  time: number
  className?: string
}) {
  const [mode, setMode] = useState<ScopeMode>('parade')
  const [stats, setStats] = useState<{ luma: number; r: number; g: number; b: number }>({
    luma: 50,
    r: 128,
    g: 128,
    b: 128
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const drawScopes = useCallback(() => {
    const outCanvas = canvasRef.current
    if (!outCanvas) return
    const ctx = outCanvas.getContext('2d')
    if (!ctx) return

    const W = outCanvas.width
    const H = outCanvas.height

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas')
    }
    const sc = sampleCanvasRef.current
    const sw = 96
    const sh = 54
    if (sc.width !== sw || sc.height !== sh) {
      sc.width = sw
      sc.height = sh
    }
    const sctx = sc.getContext('2d', { willReadFrequently: true })
    if (!sctx) return

    const video = videoRef.current
    const imgEl =
      media?.mediaKind === 'image'
        ? (document.querySelector('[data-testid="image-main"]') as HTMLImageElement | null)
        : null
    let drewVideo = false
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      try {
        sctx.drawImage(imgEl, 0, 0, sw, sh)
        drewVideo = true
      } catch {
        drewVideo = false
      }
    } else if (media && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        sctx.drawImage(video, 0, 0, sw, sh)
        drewVideo = true
      } catch {
        drewVideo = false
      }
    }

    if (!drewVideo) {
      const sky = sctx.createLinearGradient(0, 0, 0, sh)
      sky.addColorStop(0, '#5d7a96')
      sky.addColorStop(0.55, '#c9b79a')
      sky.addColorStop(1, '#d9a76a')
      sctx.fillStyle = sky
      sctx.fillRect(0, 0, sw, sh)
      sctx.fillStyle = '#2c3a40'
      sctx.fillRect(0, Math.round(sh * 0.65), sw, Math.round(sh * 0.35))
    }

    const raw = sctx.getImageData(0, 0, sw, sh).data

    // Kadifemsi koyu zemin
    ctx.clearRect(0, 0, W, H)

    const padTop = 14
    const padBottom = 14
    const plotH = H - padTop - padBottom
    const plotX = 26
    const plotW = W - plotX - 6

    // Piksel değerlendirme + istatistik ve histogram/sütun biriktirme
    const histR = new Uint32Array(128)
    const histG = new Uint32Array(128)
    const histB = new Uint32Array(128)
    const histY = new Uint32Array(128)

    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumY = 0
    const totalPx = sw * sh

    const binsY = 96
    const colR = new Uint16Array(sw * binsY)
    const colG = new Uint16Array(sw * binsY)
    const colB = new Uint16Array(sw * binsY)
    const colL = new Uint16Array(sw * binsY)

    // Vectorscope piksel listesi
    const vecPoints: Array<{ cb: number; cr: number; r: number; g: number; b: number }> = []

    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const idx = (py * sw + px) * 4
        const r0 = raw[idx] / 255
        const g0 = raw[idx + 1] / 255
        const b0 = raw[idx + 2] / 255

        const [r1, g1, b1] = evaluateColorGrade(r0, g0, b0, grade, activeLut)
        const y1 = Math.max(0, Math.min(1, 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1))

        sumR += r1
        sumG += g1
        sumB += b1
        sumY += y1

        histR[Math.min(127, Math.floor(r1 * 127))]++
        histG[Math.min(127, Math.floor(g1 * 127))]++
        histB[Math.min(127, Math.floor(b1 * 127))]++
        histY[Math.min(127, Math.floor(y1 * 127))]++

        const br = Math.min(binsY - 1, Math.floor((1 - r1) * (binsY - 1)))
        const bg = Math.min(binsY - 1, Math.floor((1 - g1) * (binsY - 1)))
        const bb = Math.min(binsY - 1, Math.floor((1 - b1) * (binsY - 1)))
        const bl = Math.min(binsY - 1, Math.floor((1 - y1) * (binsY - 1)))

        colR[px * binsY + br]++
        colG[px * binsY + bg]++
        colB[px * binsY + bb]++
        colL[px * binsY + bl]++

        if (mode === 'vectorscope') {
          const cb = -0.1146 * r1 - 0.3854 * g1 + 0.5 * b1
          const cr = 0.5 * r1 - 0.4542 * g1 - 0.0458 * b1
          vecPoints.push({
            cb,
            cr,
            r: Math.round(r1 * 255),
            g: Math.round(g1 * 255),
            b: Math.round(b1 * 255)
          })
        }
      }
    }

    setStats({
      luma: Math.round((sumY / totalPx) * 100),
      r: Math.round((sumR / totalPx) * 255),
      g: Math.round((sumG / totalPx) * 255),
      b: Math.round((sumB / totalPx) * 255)
    })

    if (mode === 'vectorscope') {
      const cx = W * 0.5
      const cy = H * 0.5
      const radius = Math.min(W, H) * 0.43

      // Dairesel graticule halkaları (%25, %50, %75, %100) — zarif düşük opaklık
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.lineWidth = 1
      for (const frac of [0.25, 0.5, 0.75, 1.0]) {
        ctx.beginPath()
        ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Merkez eksen çizgileri
      ctx.beginPath()
      ctx.moveTo(cx - radius, cy)
      ctx.lineTo(cx + radius, cy)
      ctx.moveTo(cx, cy - radius)
      ctx.lineTo(cx, cy + radius)
      ctx.stroke()

      // Standart Skin Tone Line (Ten Rengi Kılavuz Çizgisi — I-Line, ~123° YUV açısı)
      // Cb negatif (sol), Cr pozitif (üst) -> sol-üst kadran (~123 derece)
      const skinAngleRad = (-123 * Math.PI) / 180
      const sx = cx + Math.cos(skinAngleRad) * radius
      const sy = cy + Math.sin(skinAngleRad) * radius
      ctx.save()
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)'
      ctx.lineWidth = 1.4
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(sx, sy)
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = 'rgba(251, 191, 36, 0.92)'
      ctx.font = 'bold 8px "JetBrains Mono", monospace'
      ctx.fillText('SKIN', sx - 10, sy - 4)

      // Piksel vektör bulutu
      const scale = radius * 1.65
      for (let i = 0; i < vecPoints.length; i++) {
        const pt = vecPoints[i]
        const px = cx + pt.cb * scale
        const py = cy - pt.cr * scale
        ctx.fillStyle = `rgba(${pt.r}, ${pt.g}, ${pt.b}, 0.28)`
        ctx.fillRect(px - 0.8, py - 0.8, 1.8, 1.8)
      }

      // 6 Ana Renk Hedefi (R, Yl, G, Cy, B, Mg) (%75 doygunluk kutuları)
      for (const tgt of VECTOR_TARGETS) {
        const cb = (-0.1146 * tgt.r - 0.3854 * tgt.g + 0.5 * tgt.b) * 0.75
        const cr = (0.5 * tgt.r - 0.4542 * tgt.g - 0.0458 * tgt.b) * 0.75
        const tx = cx + cb * scale
        const ty = cy - cr * scale

        ctx.strokeStyle = tgt.color
        ctx.lineWidth = 1.2
        ctx.strokeRect(tx - 4, ty - 4, 8, 8)

        ctx.fillStyle = tgt.color
        ctx.font = 'bold 8px "JetBrains Mono", monospace'
        ctx.fillText(tgt.label, tx + 6, ty + 3)
      }
      return
    }

    // Parade / Waveform / Histogram için zarif IRE ızgara çizgileri (opacity-15)
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'
    ctx.lineWidth = 1
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.22)'

    const ireLevels = [100, 75, 50, 25, 0]
    for (const ire of ireLevels) {
      const y = Math.round(padTop + (1 - ire / 100) * plotH) + 0.5
      ctx.beginPath()
      ctx.moveTo(24, y)
      ctx.lineTo(W - 6, y)
      ctx.stroke()
      ctx.fillText(String(ire), 4, y + 3)
    }

    if (mode === 'parade') {
      const gap = 6
      const secW = (plotW - gap * 2) / 3
      const sections: Array<{ data: Uint16Array; color: string; label: string; x0: number }> = [
        { data: colR, color: '239, 68, 68', label: 'RED', x0: plotX },
        { data: colG, color: '34, 197, 94', label: 'GREEN', x0: plotX + secW + gap },
        { data: colB, color: '56, 189, 248', label: 'BLUE', x0: plotX + (secW + gap) * 2 }
      ]

      for (const sec of sections) {
        for (let px = 0; px < sw; px++) {
          const x = sec.x0 + (px / sw) * secW
          const colW = Math.max(1.5, secW / sw + 0.5)
          for (let by = 0; by < binsY; by++) {
            const count = sec.data[px * binsY + by]
            if (count === 0) continue
            const y = padTop + (by / (binsY - 1)) * plotH
            const alpha = Math.min(0.95, 0.18 + (count / sh) * 2.8)
            ctx.fillStyle = `rgba(${sec.color}, ${alpha.toFixed(3)})`
            ctx.fillRect(x, y, colW, Math.max(1.5, plotH / binsY))
          }
        }

        ctx.fillStyle = `rgba(${sec.color}, 0.75)`
        ctx.font = 'bold 8px "JetBrains Mono", monospace'
        ctx.fillText(sec.label, sec.x0 + 4, padTop + 10)
      }
    } else if (mode === 'waveform') {
      const colW = Math.max(1.5, plotW / sw + 0.6)
      for (let px = 0; px < sw; px++) {
        const x = plotX + (px / sw) * plotW
        for (let by = 0; by < binsY; by++) {
          const idx = px * binsY + by
          const cr = colR[idx]
          const cg = colG[idx]
          const cb = colB[idx]
          const cl = colL[idx]
          if (cr === 0 && cg === 0 && cb === 0 && cl === 0) continue
          const y = padTop + (by / (binsY - 1)) * plotH
          const hStep = Math.max(1.5, plotH / binsY)
          if (cr > 0) {
            ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(0.75, 0.14 + (cr / sh) * 2.2).toFixed(3)})`
            ctx.fillRect(x, y, colW, hStep)
          }
          if (cg > 0) {
            ctx.fillStyle = `rgba(34, 197, 94, ${Math.min(0.75, 0.14 + (cg / sh) * 2.2).toFixed(3)})`
            ctx.fillRect(x, y, colW, hStep)
          }
          if (cb > 0) {
            ctx.fillStyle = `rgba(56, 189, 248, ${Math.min(0.75, 0.14 + (cb / sh) * 2.2).toFixed(3)})`
            ctx.fillRect(x, y, colW, hStep)
          }
          if (cl > 0) {
            ctx.fillStyle = `rgba(244, 244, 245, ${Math.min(0.85, 0.16 + (cl / sh) * 2.4).toFixed(3)})`
            ctx.fillRect(x, y, colW, hStep)
          }
        }
      }
    } else {
      // HISTOGRAM
      let maxCount = 1
      for (let i = 1; i < 127; i++) {
        maxCount = Math.max(maxCount, histR[i], histG[i], histB[i], histY[i])
      }

      const drawCurve = (hist: Uint32Array, stroke: string, fill: string) => {
        ctx.beginPath()
        ctx.moveTo(plotX, padTop + plotH)
        for (let i = 0; i < 128; i++) {
          const x = plotX + (i / 127) * plotW
          const norm = Math.min(1, Math.pow(hist[i] / maxCount, 0.65))
          const y = padTop + (1 - norm) * plotH
          ctx.lineTo(x, y)
        }
        ctx.lineTo(plotX + plotW, padTop + plotH)
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = stroke
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      drawCurve(histR, 'rgba(239,68,68,0.85)', 'rgba(239,68,68,0.18)')
      drawCurve(histG, 'rgba(34,197,94,0.85)', 'rgba(34,197,94,0.18)')
      drawCurve(histB, 'rgba(56,189,248,0.85)', 'rgba(56,189,248,0.18)')
      drawCurve(histY, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0.10)')
    }
  }, [activeLut, grade, media, mode, videoRef])

  useEffect(() => {
    drawScopes()
  }, [drawScopes, time, grade, activeLut, mode, media])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      drawScopes()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, drawScopes])

  return (
    <section data-testid="video-scopes-panel" className={className}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] " />
          <span className="panel-title !text-[#E4E4E7]/90">Skoplar</span>
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-black/35 p-0.5">
          {(
            [
              ['parade', 'PARADE'],
              ['waveform', 'WAVEFORM'],
              ['vectorscope', 'VECTORSCOPE'],
              ['histogram', 'HISTOGRAM']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`scope-mode-${id}`}
              onClick={() => setMode(id)}
              className={`rounded-full px-2 py-0.5 font-mono text-[8px] font-semibold tracking-wider transition-all duration-200 ${
                mode === id
                  ? 'bg-white/[0.12] text-[var(--accent)] '
                  : 'text-[var(--text-muted)] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/30">
        <canvas ref={canvasRef} width={360} height={180} className="h-full w-full" />
      </div>

      <div className="mt-2 flex items-center justify-between rounded-full bg-black/25 px-3 py-1 font-mono text-[9px]">
        <span className="text-white/55">
          ORT. LUMA: <strong className="text-white/90">{stats.luma} IRE</strong>
        </span>
        <div className="flex items-center gap-2.5">
          <span className="text-red-400">R:{stats.r}</span>
          <span className="text-emerald-400">G:{stats.g}</span>
          <span className="text-sky-400">B:{stats.b}</span>
        </div>
      </div>
    </section>
  )
}
