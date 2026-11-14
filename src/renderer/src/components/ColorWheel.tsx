import { useRef, useState } from 'react'
import type { WheelValue } from '../../../shared/color'

const HEX_CLIP = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)'
const SQRT3 = Math.sqrt(3)
const HEX_RADIUS = 0.9

export default function ColorWheel({
  label,
  value,
  onChange,
  size = 104,
  hideSlider = false
}: {
  label: string
  value: WheelValue
  onChange: (v: WheelValue) => void
  size?: number
  hideSlider?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    let x = ((e.clientX - r.left) / r.width) * 2 - 1
    let y = ((e.clientY - r.top) / r.height) * 2 - 1
    // Düzgün altıgen sınır kısıtlaması (birim altıgen normu <= 1)
    const hexNorm = Math.max(Math.abs(x) / (SQRT3 / 2), Math.abs(x) / SQRT3 + Math.abs(y))
    if (hexNorm > HEX_RADIUS) {
      const scale = HEX_RADIUS / hexNorm
      x *= scale
      y *= scale
    }
    onChange({
      ...value,
      x: Math.max(-1, Math.min(1, x / HEX_RADIUS)),
      y: Math.max(-1, Math.min(1, y / HEX_RADIUS))
    })
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore if capture unsupported
    }
    draggingRef.current = true
    setDragging(true)
    move(e)
  }

  const up = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const isDirty = Math.abs(value.x) > 0.001 || Math.abs(value.y) > 0.001 || Math.abs(value.l) > 0.001
  const puckX = Math.max(-1, Math.min(1, value.x)) * HEX_RADIUS
  const puckY = Math.max(-1, Math.min(1, value.y)) * HEX_RADIUS

  return (
    <div className="pointer-events-none flex flex-col items-center gap-1.5 select-none">
      {/* Dış Altıgen Çerçeve Wrapper (Sürükleme sırasında drop-shadow parlaması) */}
      <div
        className="pointer-events-none transition-[filter] duration-150"
        style={{
          width: size,
          height: size,
          filter: dragging ? 'drop-shadow(0 0 8px var(--accent-glow))' : undefined
        }}
      >
        <div
          ref={ref}
          data-testid={`color-wheel-${label.toLowerCase()}`}
          onPointerDown={down}
          onPointerMove={(e) => (draggingRef.current || e.buttons === 1) && move(e)}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={() => {
            draggingRef.current = false
            setDragging(false)
          }}
          onDoubleClick={() => onChange({ x: 0, y: 0, l: 0 })}
          className="pointer-events-auto relative h-full w-full cursor-crosshair touch-none p-[2px] transition-colors"
          style={{
            clipPath: HEX_CLIP,
            background: dragging || isDirty ? 'var(--accent)' : 'var(--border-subtle)'
          }}
          title={`${label} — Çift tıkla: (0,0) sıfırla`}
        >
          {/* İç Spektrum Altıgeni */}
          <div
            className="pointer-events-none relative h-full w-full overflow-hidden"
            style={{
              clipPath: HEX_CLIP,
              background:
                'radial-gradient(circle, rgba(228,228,231,0.92) 0%, rgba(180,180,186,0.45) 34%, rgba(128,128,128,0) 72%), conic-gradient(from 90deg, #ff4040, #ffd040, #40ff60, #40e0ff, #4060ff, #e040ff, #ff4040)'
            }}
          >
            {/* Kamera Objektifi Diyaframı İnce Metalik İç Çizgiler */}
            <svg
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <polygon
                points="50,16 79.4,33 79.4,67 50,84 20.6,67 20.6,33"
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="0.9"
              />
              <polygon
                points="50,32 65.6,41 65.6,59 50,68 34.4,59 34.4,41"
                fill="none"
                stroke="rgba(24,24,27,0.45)"
                strokeWidth="0.9"
              />
              <line x1="50" y1="6" x2="50" y2="94" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
              <line x1="12" y1="28" x2="88" y2="72" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
              <line x1="88" y1="28" x2="12" y2="72" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
            </svg>

            {/* Kanal Etiketi */}
            <span
              className={`pointer-events-none absolute bottom-[12%] left-1/2 -translate-x-1/2 rounded px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-[0.16em] transition-colors ${
                dragging
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-black/65 text-white/85'
              }`}
            >
              {label}
            </span>

            {/* Hedef İmleç (Puck / Crosshair) */}
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--bg-app)]/90 shadow-[0_0_6px_rgba(0,0,0,0.95)]"
              style={{
                left: `${(puckX * 0.5 + 0.5) * 100}%`,
                top: `${(puckY * 0.5 + 0.5) * 100}%`
              }}
            />
          </div>
        </div>
      </div>

      {!hideSlider && (
        <div className="pointer-events-auto flex items-center gap-1" style={{ width: size }}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={value.l}
            onChange={(e) => onChange({ ...value, l: parseFloat(e.target.value) })}
            className="w-full min-w-0 flex-1"
            title={`Master Parlaklık (${value.l.toFixed(2)})`}
          />
          <button
            type="button"
            onClick={() => onChange({ x: 0, y: 0, l: 0 })}
            disabled={!isDirty}
            title="Tekerleği Sıfırla"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-[var(--text-muted)] transition hover:bg-white/10 hover:text-white disabled:opacity-25"
          >
            ↺
          </button>
        </div>
      )}
    </div>
  )
}

export function HoneycombColorWheels({
  lift,
  gamma,
  gain,
  onLift,
  onGamma,
  onGain
}: {
  lift: WheelValue
  gamma: WheelValue
  gain: WheelValue
  onLift: (v: WheelValue) => void
  onGamma: (v: WheelValue) => void
  onGain: (v: WheelValue) => void
}) {
  const rows: Array<{
    key: string
    label: string
    value: WheelValue
    onChange: (v: WheelValue) => void
  }> = [
    { key: 'lift', label: 'Lift Y', value: lift, onChange: onLift },
    { key: 'gamma', label: 'Gamma Y', value: gamma, onChange: onGamma },
    { key: 'gain', label: 'Gain Y', value: gain, onChange: onGain }
  ]

  return (
    <div className="space-y-3">
      {/* Üçgen Petek Kümesi (4px kenar boşluğu ile kenetlenen 3 altıgen) */}
      <div className="relative mx-auto h-[186px] w-[198px]">
        <div className="absolute left-0 top-0">
          <ColorWheel label="Lift" value={lift} onChange={onLift} size={104} hideSlider />
        </div>
        <div className="absolute left-[94px] top-0">
          <ColorWheel label="Gamma" value={gamma} onChange={onGamma} size={104} hideSlider />
        </div>
        <div className="absolute left-[47px] top-[82px]">
          <ColorWheel label="Gain" value={gain} onChange={onGain} size={104} hideSlider />
        </div>
      </div>

      {/* Kompakt Master Parlaklık Kontrol Bloğu */}
      <div className="space-y-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 px-2.5 py-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-[52px] shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
              {r.label}
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={r.value.l}
              onChange={(e) => r.onChange({ ...r.value, l: parseFloat(e.target.value) })}
              className="min-w-0 flex-1"
            />
            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-white/70">
              {r.value.l.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => r.onChange({ ...r.value, l: 0 })}
              disabled={Math.abs(r.value.l) <= 0.001}
              title={`${r.label} Sıfırla`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-[var(--text-muted)] transition hover:bg-white/10 hover:text-white disabled:opacity-25"
            >
              ↺
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
