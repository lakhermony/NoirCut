import type React from 'react'
import { useRef } from 'react'
import type { GainKeyframe, TimelineClip, TransformKeyframe } from '../../../shared/timeline'

interface Props {
  clip: TimelineClip
  width: number
  height: number
  mode: 'gain' | 'opacity'
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
}

const GAIN_MIN = -48
const GAIN_MAX = 12

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function valueToY(val: number, height: number, mode: 'gain' | 'opacity'): number {
  const pad = 5
  const usable = Math.max(4, height - pad * 2)
  const norm =
    mode === 'gain'
      ? (clamp(val, GAIN_MIN, GAIN_MAX) - GAIN_MIN) / (GAIN_MAX - GAIN_MIN)
      : clamp(val, 0, 100) / 100
  return pad + (1 - norm) * usable
}

function yToValue(y: number, height: number, mode: 'gain' | 'opacity'): number {
  const pad = 5
  const usable = Math.max(4, height - pad * 2)
  const norm = clamp(1 - (y - pad) / usable, 0, 1)
  if (mode === 'gain') {
    return Number((GAIN_MIN + norm * (GAIN_MAX - GAIN_MIN)).toFixed(1))
  }
  return Math.round(norm * 100)
}

export default function ClipRubberbandOverlay({
  clip,
  width,
  height,
  mode,
  onUpdateClip
}: Props): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement | null>(null)
  if (width < 36 || height < 14) return null

  const dur = Math.max(0.05, clip.duration)
  const color = mode === 'gain' ? '#38BDF8' : '#F59E0B'

  const points: Array<{ id: string; time: number; value: number }> =
    mode === 'gain'
      ? [...(clip.gainKeyframes ?? [])]
          .sort((a, b) => a.time - b.time)
          .map((p) => ({ id: p.id, time: p.time, value: p.db }))
      : [...(clip.keyframes ?? [])]
          .filter((k) => k.param === 'opacity')
          .sort((a, b) => a.time - b.time)
          .map((p) => ({ id: p.id, time: p.time, value: p.value }))

  const defaultVal =
    mode === 'gain' ? clamp(clip.gainDb, GAIN_MIN, GAIN_MAX) : (clip.transform?.opacity ?? 100)

  const commitPoints = (next: Array<{ id: string; time: number; value: number }>) => {
    const sorted = [...next].sort((a, b) => a.time - b.time)
    if (mode === 'gain') {
      const kfs: GainKeyframe[] = sorted.map((p) => ({
        id: p.id,
        time: Number(clamp(p.time, 0, dur).toFixed(3)),
        db: clamp(p.value, GAIN_MIN, GAIN_MAX)
      }))
      onUpdateClip(clip.id, { gainKeyframes: kfs.length > 0 ? kfs : undefined })
    } else {
      const opacityKfs: TransformKeyframe[] = sorted.map((p) => ({
        id: p.id,
        param: 'opacity',
        time: Number(clamp(p.time, 0, dur).toFixed(3)),
        value: clamp(p.value, 0, 100)
      }))
      const otherKfs = (clip.keyframes ?? []).filter((k) => k.param !== 'opacity')
      const merged = [...otherKfs, ...opacityKfs]
      onUpdateClip(clip.id, {
        keyframes: merged.length > 0 ? merged : undefined
      })
    }
  }

  // Polyline koordinatlarını oluştur
  const polyCoords: Array<[number, number]> = []
  if (points.length === 0) {
    const y = valueToY(defaultVal, height, mode)
    polyCoords.push([0, y], [width, y])
  } else {
    const firstY = valueToY(points[0].value, height, mode)
    if (points[0].time > 0.001) polyCoords.push([0, firstY])
    for (const p of points) {
      polyCoords.push([clamp((p.time / dur) * width, 0, width), valueToY(p.value, height, mode)])
    }
    const last = points[points.length - 1]
    if (last.time < dur - 0.001) {
      polyCoords.push([width, valueToY(last.value, height, mode)])
    }
  }

  const polyStr = polyCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  const addPointAtClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = clamp(clientX - rect.left, 0, width)
    const relY = clamp(clientY - rect.top, 0, height)
    const time = Number(((relX / Math.max(1, width)) * dur).toFixed(3))
    const value = yToValue(relY, height, mode)
    const newPt = {
      id: `rb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time,
      value
    }
    commitPoints([...points, newPt])
  }

  const handleLinePointerDown = (e: React.PointerEvent<SVGPolylineElement>) => {
    if (e.shiftKey || e.detail >= 2) {
      e.stopPropagation()
      e.preventDefault()
      addPointAtClient(e.clientX, e.clientY)
    }
  }

  const handleDotPointerDown = (e: React.PointerEvent<SVGCircleElement>, ptId: string) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.altKey || e.button === 2) {
      commitPoints(points.filter((p) => p.id !== ptId))
      return
    }

    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return

    const onMove = (ev: PointerEvent) => {
      const relX = clamp(ev.clientX - rect.left, 0, width)
      const relY = clamp(ev.clientY - rect.top, 0, height)
      const nextTime = Number(((relX / Math.max(1, width)) * dur).toFixed(3))
      const nextVal = yToValue(relY, height, mode)
      commitPoints(
        points.map((p) => (p.id === ptId ? { ...p, time: nextTime, value: nextVal } : p))
      )
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeOpacity={points.length > 0 ? 0.92 : 0.45}
        strokeWidth={1.5}
        strokeDasharray={points.length > 0 ? undefined : '3 3'}
        points={polyStr}
      />
      {/* Çizgi üzerinde Shift+Tık veya Çift Tık için şeffaf yakalama alanı */}
      <polyline
        fill="none"
        stroke="transparent"
        strokeWidth={10}
        points={polyStr}
        className="pointer-events-auto cursor-crosshair"
        onPointerDown={handleLinePointerDown}
      >
        <title>
          {mode === 'gain'
            ? 'Ses Eğrisi: Nokta eklemek için Shift+Tık veya Çift Tık'
            : 'Opaklık Eğrisi: Nokta eklemek için Shift+Tık veya Çift Tık'}
        </title>
      </polyline>

      {points.map((p) => {
        const cx = clamp((p.time / dur) * width, 3, width - 3)
        const cy = valueToY(p.value, height, mode)
        return (
          <circle
            key={p.id}
            cx={cx}
            cy={cy}
            r={4}
            fill="#0b1018"
            stroke={color}
            strokeWidth={1.75}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => handleDotPointerDown(e, p.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              commitPoints(points.filter((pt) => pt.id !== p.id))
            }}
          >
            <title>
              {mode === 'gain'
                ? `${p.time.toFixed(2)}s · ${p.value > 0 ? '+' : ''}${p.value} dB (Sürükle / Sağ tık: Sil)`
                : `${p.time.toFixed(2)}s · %${p.value} Opaklık (Sürükle / Sağ tık: Sil)`}
            </title>
          </circle>
        )
      })}
    </svg>
  )
}
