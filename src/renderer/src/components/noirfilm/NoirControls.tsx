import { useRef } from 'react'

export function NoirSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
  disabled = false,
  gradient,
  testId,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue: number
  unit?: string
  disabled?: boolean
  gradient?: string
  testId?: string
  onChange: (n: number) => void
}) {
  const formatted =
    step < 1
      ? value > 0 && min < 0
        ? `+${value.toFixed(2)}`
        : value.toFixed(2)
      : value > 0 && min < 0
        ? `+${Math.round(value)}`
        : String(Math.round(value))

  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(1e-5, max - min)) * 100))
  const zeroPct = min < 0 ? ((0 - min) / (max - min)) * 100 : 0
  const startPct = Math.min(zeroPct, pct)
  const endPct = Math.max(zeroPct, pct)

  const trackBg = gradient
    ? gradient
    : min < 0
      ? `linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) ${startPct}%, var(--accent) ${startPct}%, var(--accent) ${endPct}%, rgba(255,255,255,0.08) ${endPct}%, rgba(255,255,255,0.08) 100%)`
      : `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`

  return (
    <div className={`space-y-1 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <div
        onDoubleClick={() => onChange(defaultValue)}
        title="Çift tıkla: varsayılana sıfırla"
        className="flex cursor-pointer items-center justify-between text-[10px] text-[#9298A3] transition-colors hover:text-[#F1F2EE]"
      >
        <span className="truncate font-medium">{label}</span>
        <span className="font-mono text-[10px] font-semibold text-[#F1F2EE]">
          {formatted}
          {unit}
        </span>
      </div>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ background: trackBg, ['--pct' as string]: `${pct}%` }}
      />
    </div>
  )
}

export function NoirCircularDial({
  label,
  value,
  min,
  max,
  defaultValue,
  unit = '',
  size = 54,
  disabled = false,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  unit?: string
  size?: number
  disabled?: boolean
  onChange: (n: number) => void
}) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)
  const norm = Math.max(0, Math.min(1, (value - min) / Math.max(1e-5, max - min)))
  const startAngle = -135
  const sweep = 270
  const angle = startAngle + norm * sweep
  const r = size * 0.37
  const cx = size / 2
  const cy = size / 2
  const circum = 2 * Math.PI * r
  const arcLen = (sweep / 360) * circum
  const activeLen = norm * arcLen

  const rad = ((angle - 90) * Math.PI) / 180
  const dotX = cx + r * Math.cos(rad)
  const dotY = cy + r * Math.sin(rad)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startVal: value }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || disabled) return
    const dy = dragRef.current.startY - e.clientY
    const range = max - min
    const next = Math.max(min, Math.min(max, dragRef.current.startVal + (dy / 140) * range))
    onChange(Math.round(next))
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  return (
    <div
      className={`flex flex-col items-center gap-1 select-none ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        title="Sürükleyerek ayarla · Çift tıkla sıfırla"
        className="relative cursor-ns-resize transition-transform duration-150 hover:scale-105 active:scale-95"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="#1B1E24"
            stroke="#343943"
            strokeWidth="3.5"
            strokeDasharray={`${arcLen} ${circum}`}
            strokeLinecap="round"
            transform={`rotate(${135} ${cx} ${cy})`}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#B7E36A"
            strokeWidth="3.5"
            strokeDasharray={`${activeLen} ${circum}`}
            strokeLinecap="round"
            transform={`rotate(${135} ${cx} ${cy})`}
          />
          <circle cx={dotX} cy={dotY} r="3" fill="#F1F2EE" />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 font-mono text-[9.5px] font-semibold text-[#F1F2EE]">
          {value > 0 && min < 0 ? `+${Math.round(value)}` : Math.round(value)}
          {unit}
        </div>
      </div>
      <span className="text-center text-[9px] font-medium text-[#9298A3]">{label}</span>
    </div>
  )
}

export function NoirToggle({
  checked,
  label,
  onChange,
  testId
}: {
  checked: boolean
  label?: string
  onChange: (next: boolean) => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-1.5 rounded-full bg-[#242830] px-2 py-0.5 text-[9.5px] font-medium text-[#F1F2EE] transition-all duration-150 hover:bg-[#292E36]"
    >
      <span
        className={`relative h-3.5 w-6 rounded-full transition-colors duration-200 ${
          checked ? 'bg-[#B7E36A]' : 'bg-[#343943]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-[#101114] transition-transform duration-200 ${
            checked ? 'left-3' : 'left-0.5'
          }`}
        />
      </span>
      {label && <span className={checked ? 'text-[#B7E36A]' : 'text-[#9298A3]'}>{label}</span>}
    </button>
  )
}

export function NoirColorSwatchInput({
  label,
  value,
  presets,
  disabled = false,
  onChange
}: {
  label: string
  value: string
  presets: string[]
  disabled?: boolean
  onChange: (hex: string) => void
}) {
  return (
    <div className={`space-y-1.5 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <div className="flex items-center justify-between text-[9.5px] text-[#9298A3]">
        <span>{label}</span>
        <span className="font-mono text-[9px] text-[#F1F2EE] uppercase">{value}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-[#343943] bg-transparent p-0"
        />
        <div className="flex flex-wrap items-center gap-1">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              title={p}
              className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                value.toLowerCase() === p.toLowerCase()
                  ? 'border-[#B7E36A] scale-110'
                  : 'border-[#343943]'
              }`}
              style={{ backgroundColor: p }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
