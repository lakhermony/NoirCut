import { useRef, useState } from 'react'
import {
  HUE_BAND_META,
  defaultColorCurves,
  defaultCurvePoints,
  defaultHueBands,
  evaluateCurvePoints,
  type ColorGrade,
  type CurveChannelId,
  type CurvePoint,
  type HueBandArray
} from '../../../shared/color'

type EditorSubTab = 'curves' | 'hueVsSat' | 'hueVsHue'

const CHANNEL_META: Array<{ id: CurveChannelId; label: string; color: string }> = [
  { id: 'master', label: 'MASTER', color: 'var(--accent)' },
  { id: 'red', label: 'RED', color: '#EF4444' },
  { id: 'green', label: 'GREEN', color: '#22C55E' },
  { id: 'blue', label: 'BLUE', color: '#38BDF8' }
]

function buildSvgCurvePath(points: CurvePoint[], w: number, h: number): string {
  const steps = 64
  const parts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const xNorm = i / steps
    const yNorm = evaluateCurvePoints(points, xNorm)
    const sx = xNorm * w
    const sy = (1 - yNorm) * h
    parts.push(`${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`)
  }
  return parts.join(' ')
}

export default function ColorCurvesEditor({
  grade,
  onGrade
}: {
  grade: ColorGrade
  onGrade: (next: ColorGrade) => void
}) {
  const [subTab, setSubTab] = useState<EditorSubTab>('curves')
  const [channel, setChannel] = useState<CurveChannelId>('master')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const curves = grade.curves ?? defaultColorCurves()
  const activePoints = curves[channel] ?? defaultCurvePoints()
  const activeMeta = CHANNEL_META.find((c) => c.id === channel) ?? CHANNEL_META[0]

  const updateChannelPoints = (pts: CurvePoint[]) => {
    const sorted = [...pts].sort((a, b) => a.x - b.x)
    onGrade({
      ...grade,
      curves: {
        ...curves,
        [channel]: sorted
      }
    })
  }

  const getNormCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height))
    return { x, y }
  }

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const pos = getNormCoords(e.clientX, e.clientY)
    if (!pos) return

    // Yakında mevcut bir nokta var mı kontrol et
    let nearestIdx = -1
    let nearestDist = 0.065
    activePoints.forEach((p, idx) => {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y)
      if (d < nearestDist) {
        nearestDist = d
        nearestIdx = idx
      }
    })

    if (nearestIdx !== -1) {
      setDragIdx(nearestIdx)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      return
    }

    // Yeni kontrol noktası ekle (en fazla 8 nokta)
    if (activePoints.length >= 8) return
    const nextPts = [...activePoints, { x: pos.x, y: pos.y }].sort((a, b) => a.x - b.x)
    const newIdx = nextPts.findIndex((p) => Math.abs(p.x - pos.x) < 1e-4 && Math.abs(p.y - pos.y) < 1e-4)
    updateChannelPoints(nextPts)
    setDragIdx(newIdx >= 0 ? newIdx : null)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIdx === null) return
    const pos = getNormCoords(e.clientX, e.clientY)
    if (!pos) return

    const pts = [...activePoints]
    if (!pts[dragIdx]) return

    if (dragIdx === 0) {
      pts[0] = { x: 0, y: pos.y }
    } else if (dragIdx === pts.length - 1) {
      pts[pts.length - 1] = { x: 1, y: pos.y }
    } else {
      const minX = pts[dragIdx - 1].x + 0.03
      const maxX = pts[dragIdx + 1].x - 0.03
      pts[dragIdx] = {
        x: Math.max(minX, Math.min(maxX, pos.x)),
        y: pos.y
      }
    }
    updateChannelPoints(pts)
  }

  const handleRemovePoint = (idx: number) => {
    if (idx <= 0 || idx >= activePoints.length - 1) return
    const nextPts = activePoints.filter((_, i) => i !== idx)
    updateChannelPoints(nextPts)
    setDragIdx(null)
  }

  const applySCurvePreset = () => {
    updateChannelPoints([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.17 },
      { x: 0.75, y: 0.84 },
      { x: 1, y: 1 }
    ])
  }

  const hueBands: HueBandArray =
    subTab === 'hueVsHue'
      ? (grade.hueVsHue ?? defaultHueBands())
      : (grade.hueVsSat ?? defaultHueBands())

  const updateHueBand = (idx: number, val: number) => {
    const next = [...hueBands] as HueBandArray
    next[idx] = val
    if (subTab === 'hueVsHue') {
      onGrade({ ...grade, hueVsHue: next })
    } else {
      onGrade({ ...grade, hueVsSat: next })
    }
  }

  const resetCurrentMode = () => {
    if (subTab === 'curves') {
      updateChannelPoints(defaultCurvePoints())
    } else if (subTab === 'hueVsSat') {
      onGrade({ ...grade, hueVsSat: defaultHueBands() })
    } else {
      onGrade({ ...grade, hueVsHue: defaultHueBands() })
    }
  }

  return (
    <div data-testid="color-curves-editor" className="flex h-full flex-col justify-between gap-2">
      {/* Üst Sekme Seçici: CURVES | HUE VS SAT | HUE VS HUE (Kayan Yarı Saydam Hap) */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5 rounded-full bg-black/35 p-0.5">
          {(
            [
              ['curves', 'EĞRİLER'],
              ['hueVsSat', 'HUE VS SAT'],
              ['hueVsHue', 'HUE VS HUE']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`curves-tab-${id}`}
              onClick={() => setSubTab(id)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[8px] font-semibold tracking-wider transition-all duration-200 ${
                subTab === id
                  ? 'bg-white/[0.12] text-[var(--accent)] '
                  : 'text-[var(--text-muted)] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {subTab === 'curves' && (
            <button
              type="button"
              data-testid="curves-scurve-btn"
              onClick={applySCurvePreset}
              title="Sinematik S-Curve Kontrast Eğrisi Uygula"
              className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[9px] font-medium text-white/80 transition-all duration-200 hover:bg-white/[0.14] hover:text-white active:scale-95"
            >
              S-Curve
            </button>
          )}
          <button
            type="button"
            data-testid="curves-reset-btn"
            onClick={resetCurrentMode}
            title="Aktif eğriyi sıfırla"
            className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[9px] font-medium text-white/75 transition-all duration-200 hover:bg-white/[0.14] hover:text-white active:scale-95"
          >
            Sıfırla
          </button>
        </div>
      </div>

      {subTab === 'curves' ? (
        <>
          {/* Kanal Seçici: MASTER / RED / GREEN / BLUE */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 rounded-full bg-black/25 p-0.5">
              {CHANNEL_META.map((ch) => {
                const active = channel === ch.id
                return (
                  <button
                    key={ch.id}
                    type="button"
                    data-testid={`curve-channel-${ch.id}`}
                    onClick={() => setChannel(ch.id)}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[8px] font-semibold transition-all duration-200 ${
                      active
                        ? 'bg-white/[0.14] text-white shadow-sm'
                        : 'text-white/45 hover:text-white/85'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: ch.color }}
                    />
                    {ch.label}
                  </button>
                )
              })}
            </div>
            <span className="font-mono text-[8px] text-white/35">
              Tıkla: Nokta · Sağ tık: Sil
            </span>
          </div>

          {/* Kenarsız Kadifemsi Spline Eğri Kanvası */}
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/30">
            <svg
              ref={svgRef}
              data-testid="curves-svg-canvas"
              viewBox="0 0 240 130"
              preserveAspectRatio="none"
              onPointerDown={handleSvgPointerDown}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={() => setDragIdx(null)}
              onPointerCancel={() => setDragIdx(null)}
              onContextMenu={(e) => e.preventDefault()}
              className="h-full w-full cursor-crosshair touch-none"
            >
              {/* Çok zarif (opacity-15) 4x4 Izgara ve Köşegen Referans Çizgisi */}
              {[0.25, 0.5, 0.75].map((g) => (
                <g key={g} opacity="0.15">
                  <line
                    x1={g * 240}
                    y1={0}
                    x2={g * 240}
                    y2={130}
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                  <line
                    x1={0}
                    y1={g * 130}
                    x2={240}
                    y2={g * 130}
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                </g>
              ))}
              <line
                x1={0}
                y1={130}
                x2={240}
                y2={0}
                stroke="rgba(255,255,255,0.10)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />

              {/* Diğer kanalların yarı saydam önizleme eğrileri */}
              {CHANNEL_META.filter((c) => c.id !== channel).map((ch) => (
                <path
                  key={ch.id}
                  d={buildSvgCurvePath(curves[ch.id], 240, 130)}
                  fill="none"
                  stroke={ch.color}
                  strokeOpacity="0.25"
                  strokeWidth="1.3"
                />
              ))}

              {/* Aktif Kanal Eğrisi */}
              <path
                d={buildSvgCurvePath(activePoints, 240, 130)}
                fill="none"
                stroke={activeMeta.color}
                strokeWidth="2.2"
              />

              {/* Kontrol Noktaları */}
              {activePoints.map((pt, idx) => {
                const cx = pt.x * 240
                const cy = (1 - pt.y) * 130
                return (
                  <circle
                    key={`${idx}-${pt.x.toFixed(3)}`}
                    data-testid={`curve-point-${idx}`}
                    cx={cx}
                    cy={cy}
                    r={dragIdx === idx ? 5.2 : 4}
                    fill={dragIdx === idx ? 'var(--accent)' : '#09090b'}
                    stroke={activeMeta.color}
                    strokeWidth="2"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleRemovePoint(idx)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleRemovePoint(idx)
                    }}
                    className="cursor-pointer transition-transform"
                  />
                )
              })}
            </svg>
          </div>
        </>
      ) : (
        /* SEÇİCİ RENK EĞRİLERİ: HUE VS SAT & HUE VS HUE (Kenarsız Kadifemsi Zemin) */
        <div className="flex min-h-0 flex-1 flex-col justify-between rounded-xl bg-black/30 p-2.5">
          {/* Spektrum Eğri Görselleştirmesi */}
          <div
            className="relative h-9 w-full overflow-hidden rounded-lg"
            style={{
              background:
                'linear-gradient(90deg, rgba(239,68,68,0.22) 0%, rgba(249,115,22,0.22) 18%, rgba(234,179,8,0.22) 35%, rgba(34,197,94,0.22) 55%, rgba(6,182,212,0.22) 75%, rgba(59,130,246,0.22) 92%, rgba(239,68,68,0.22) 100%)'
            }}
          >
            <svg viewBox="0 0 240 36" preserveAspectRatio="none" className="h-full w-full">
              <line
                x1={0}
                y1={18}
                x2={240}
                y2={18}
                stroke="rgba(255,255,255,0.15)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                points={hueBands
                  .map((v, i) => {
                    const x = (i / 5) * 216 + 12
                    const y = 18 - (v / 100) * 14
                    return `${x.toFixed(1)},${y.toFixed(1)}`
                  })
                  .join(' ')}
              />
              {hueBands.map((v, i) => {
                const x = (i / 5) * 216 + 12
                const y = 18 - (v / 100) * 14
                return (
                  <circle
                    key={HUE_BAND_META[i].short}
                    cx={x}
                    cy={y}
                    r={3.5}
                    fill={HUE_BAND_META[i].color}
                    stroke="#ffffff"
                    strokeWidth="1.2"
                  />
                )
              })}
            </svg>
          </div>

          {/* 6 Renk Bandı Kaydırıcıları (Red, Skin, Yellow, Green, Cyan, Blue) */}
          <div className="mt-1.5 grid grid-cols-6 gap-1.5">
            {HUE_BAND_META.map((band, idx) => {
              const val = hueBands[idx] ?? 0
              const pct = ((val + 100) / 200) * 100
              const startPct = Math.min(50, pct)
              const endPct = Math.max(50, pct)
              return (
                <div
                  key={band.short}
                  className="flex flex-col items-center rounded-xl bg-white/[0.03] px-1.5 py-1.5"
                >
                  <div className="mb-1 flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: band.color }}
                    />
                    <span className="font-mono text-[8px] font-bold text-white/80">
                      {band.short}
                    </span>
                  </div>
                  <input
                    data-testid={`${subTab}-band-${idx}`}
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={val}
                    onDoubleClick={() => updateHueBand(idx, 0)}
                    onChange={(e) => updateHueBand(idx, parseFloat(e.target.value))}
                    title={`${band.label} (${subTab === 'hueVsHue' ? 'Ton Kaydırma' : 'Doygunluk'}): ${val > 0 ? `+${val}` : val}`}
                    className="w-full"
                    style={{
                      background: `linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) ${startPct}%, var(--accent) ${startPct}%, var(--accent) ${endPct}%, rgba(255,255,255,0.08) ${endPct}%, rgba(255,255,255,0.08) 100%)`
                    }}
                  />
                  <span className="mt-1 font-mono text-[8px] text-[var(--accent)]">
                    {val > 0 ? `+${Math.round(val)}` : Math.round(val)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
