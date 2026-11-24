import { useState, type ReactNode } from 'react'
import { MIN_DB } from '../../../../shared/timeline'

export function fmtDb(db: number): string {
  if (db <= MIN_DB) return '-∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function SoftToggle({
  checked,
  onChange,
  testId
}: {
  checked: boolean
  onChange: (v: boolean) => void
  testId?: string
}) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition duration-200 ${
        checked ? 'bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]' : 'bg-[#2a2f39]'
      }`}
    >
      <input
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          checked
            ? 'translate-x-[18px] bg-[#101114] shadow-sm'
            : 'translate-x-[3px] bg-[#8f96a3]'
        }`}
      />
    </span>
  )
}

export function Accordion({
  title,
  defaultOpen = true,
  right,
  children
}: {
  title: string
  defaultOpen?: boolean
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="soft-card">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            className={`text-[9px] transition-transform duration-150 ${open ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
          >
            {open ? '▼' : '▶'}
          </span>
          <span className="text-[11px] font-semibold text-[#F1F2EE]/90">{title}</span>
        </button>
        {right}
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 px-4 pb-3.5 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  unit = '',
  testId,
  rightControl
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  unit?: string
  testId?: string
  rightControl?: ReactNode
  onChange: (n: number) => void
}) {
  const formatted = step < 1 ? value.toFixed(2) : String(Math.round(value))
  const span = Math.max(1e-6, max - min)
  const norm = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  const isBipolar = min < 0 && max > 0
  const zeroNorm = isBipolar ? ((0 - min) / span) * 100 : 0
  const fillLeft = isBipolar ? Math.min(zeroNorm, norm) : 0
  const fillWidth = isBipolar ? Math.abs(norm - zeroNorm) : norm

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1.5 text-[10px] text-white/60">
        <span
          className="cursor-pointer truncate hover:text-white/90"
          title={defaultValue !== undefined ? 'Çift tıkla: sıfırla' : undefined}
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        >
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="cursor-pointer font-mono text-[var(--accent)]"
            title={defaultValue !== undefined ? 'Çift tıkla: sıfırla' : undefined}
            onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
          >
            {formatted}
            {unit}
          </span>
          {rightControl}
        </div>
      </div>
      <div className="relative flex h-4 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-[6px] overflow-hidden rounded-full bg-[var(--bg-elevated,#292E36)]">
          <div
            className="absolute inset-y-0 rounded-full bg-[var(--accent)] transition-[left,width] duration-100"
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          />
        </div>
        <input
          data-testid={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="relative z-10 w-full !bg-transparent"
        />
      </div>
    </div>
  )
}
