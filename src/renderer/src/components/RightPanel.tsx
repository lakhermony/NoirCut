import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  defaultColorGrade,
  type ColorGrade,
  type WheelValue
} from '../../../shared/color'
import {
  CINEMATIC_FONTS,
  CREDIT_FONT_CATEGORIES,
  FONT_MAP,
  isAsciiRecommendedFont,
  type CreditConfig,
  type CreditFontCategory,
  type CreditTextAlign,
  type CreditTextPosition
} from '../../../shared/credits'
import {
  importCustomFontFile,
  loadStoredCustomFonts,
  registerCustomFontFace,
  removeStoredCustomFont,
  type CustomFontAsset
} from '../lib/custom-fonts'
import {
  MAX_DB,
  MIN_DB,
  NOIR_SOUNDSCAPE_PRESETS,
  defaultClipMask,
  defaultClipTransform,
  evaluateClipTransformAt,
  findKeyframeAt,
  getParamKeyframes,
  type AudioFxPreset,
  type ClipTransform,
  type KeyframeEasing,
  type NoirSoundscapeId,
  type TimelineClip,
  type TransformKeyframe,
  type TransformParam,
  type TransitionType
} from '../../../shared/timeline'
import type { Tab } from '../types'
import { HoneycombColorWheels } from './ColorWheel'

function fmtDb(db: number): string {
  if (db <= MIN_DB) return '-∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

function SoftToggle({
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
        checked
          ? 'bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
          : 'bg-[#2a2f39]'
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

function Accordion({
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
          <span className={`text-[9px] transition-transform duration-150 ${open ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
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

function Slider({
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

export default function RightPanel({
  tab,
  width = 316,
  activeClip,
  time = 0,
  onSeek,
  onUpdateClip,
  grade,
  activeClipName,
  onGrade,
  onAutoWhiteBalance,
  wbPickerActive = false,
  onToggleWbPicker,
  credit,
  onCredit,
  onAddCreditToTimeline,
  autoDucking = false,
  onToggleAutoDucking,
  onAddSoundscapeClip
}: {
  tab: Tab
  width?: number
  activeClip?: TimelineClip | null
  time?: number
  onSeek?: (t: number) => void
  onUpdateClip?: (id: string, patch: Partial<TimelineClip>) => void
  grade: ColorGrade
  activeClipName?: string | null
  onGrade: (g: ColorGrade) => void
  onAutoWhiteBalance?: () => void
  wbPickerActive?: boolean
  onToggleWbPicker?: () => void
  credit: CreditConfig
  onCredit: (c: CreditConfig) => void
  onAddCreditToTimeline: () => void
  autoDucking?: boolean
  onToggleAutoDucking?: (enabled: boolean) => void
  onAddSoundscapeClip?: (presetId: NoirSoundscapeId) => void
}) {
  const setWheel = (k: 'lift' | 'gamma' | 'gain') => (v: WheelValue) =>
    onGrade({ ...grade, [k]: v })

  const wbDirty = Math.abs(grade.temperature) > 0.01 || Math.abs(grade.tint) > 0.01

  const localTime = activeClip
    ? Math.max(0, Math.min(activeClip.duration, time - activeClip.start))
    : 0

  const baseTf: ClipTransform = activeClip?.transform ?? defaultClipTransform()
  const tf: ClipTransform = activeClip
    ? evaluateClipTransformAt(activeClip, time)
    : baseTf

  const patchTransformParam = (param: TransformParam, val: number) => {
    if (!activeClip || !onUpdateClip) return
    const nextTransform: ClipTransform = {
      ...baseTf,
      ...tf,
      [param]: val
    }
    const existingKfs = activeClip.keyframes ?? []
    const paramKfs = getParamKeyframes(activeClip, param)
    if (paramKfs.length > 0) {
      // Bu parametre için keyframe animasyonu aktifse playhead konumundaki keyframe'i güncelle veya yeni ekle
      const atNow = findKeyframeAt(activeClip, param, localTime)
      const nextKfs: TransformKeyframe[] = atNow
        ? existingKfs.map((k) => (k.id === atNow.id ? { ...k, value: val } : k))
        : [
            ...existingKfs,
            {
              id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              time: Number(localTime.toFixed(3)),
              param,
              value: val,
              easing: activeClip.keyframeEasing ?? 'ease-in-out'
            }
          ]
      onUpdateClip(activeClip.id, {
        transform: nextTransform,
        keyframes: nextKfs
      })
    } else {
      onUpdateClip(activeClip.id, {
        transform: nextTransform
      })
    }
  }

  const toggleKeyframe = (param: TransformParam) => {
    if (!activeClip || !onUpdateClip) return
    const existingKfs = activeClip.keyframes ?? []
    const atNow = findKeyframeAt(activeClip, param, localTime)
    if (atNow) {
      const nextKfs = existingKfs.filter((k) => k.id !== atNow.id)
      onUpdateClip(activeClip.id, { keyframes: nextKfs })
    } else {
      const curVal = tf[param]
      const newKf: TransformKeyframe = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: Number(localTime.toFixed(3)),
        param,
        value: curVal,
        easing: activeClip.keyframeEasing ?? 'ease-in-out'
      }
      onUpdateClip(activeClip.id, {
        transform: { ...baseTf, [param]: curVal },
        keyframes: [...existingKfs, newKf]
      })
    }
  }

  const [fontCategoryFilter, setFontCategoryFilter] = useState<'ALL' | CreditFontCategory>('ALL')
  const [customFonts, setCustomFonts] = useState<CustomFontAsset[]>(() => loadStoredCustomFonts())
  const [fontUploadError, setFontUploadError] = useState<string | null>(null)
  const fontFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    for (const f of customFonts) {
      void registerCustomFontFace(f)
    }
  }, [customFonts])

  const handleUploadCustomFont = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFontUploadError(null)
    try {
      const asset = await importCustomFontFile(file)
      setCustomFonts(loadStoredCustomFonts())
      onCredit({
        ...credit,
        font: 'custom',
        customFont: {
          id: asset.id,
          name: asset.name,
          dataUrl: asset.dataUrl,
          fileName: asset.fileName
        }
      })
    } catch (err) {
      setFontUploadError(err instanceof Error ? err.message : 'Font dosyası yüklenemedi')
    }
  }

  const stepToKeyframe = (param: TransformParam, dir: -1 | 1) => {
    if (!activeClip || !onSeek) return
    const paramKfs = getParamKeyframes(activeClip, param)
    if (paramKfs.length === 0) return
    if (dir < 0) {
      const prev = [...paramKfs].reverse().find((k) => k.time < localTime - 0.045)
      const target = prev ?? paramKfs[0]
      onSeek(activeClip.start + target.time)
    } else {
      const next = paramKfs.find((k) => k.time > localTime + 0.045)
      const target = next ?? paramKfs[paramKfs.length - 1]
      onSeek(activeClip.start + target.time)
    }
  }

  const renderKeyframeDiamond = (param: TransformParam, label: string) => {
    const paramKfs = getParamKeyframes(activeClip, param)
    const atNow = findKeyframeAt(activeClip, param, localTime)
    const hasAny = paramKfs.length > 0
    return (
      <div className="flex items-center gap-0.5">
        {hasAny && onSeek && (
          <button
            type="button"
            onClick={() => stepToKeyframe(param, -1)}
            title={`Önceki ${label} Keyframe'ine Git`}
            className="rounded px-0.5 text-[8px] text-white/40 transition hover:text-white"
          >
            ◀
          </button>
        )}
        <button
          type="button"
          data-testid={`kf-toggle-${param}`}
          disabled={!activeClip}
          onClick={() => toggleKeyframe(param)}
          title={
            atNow
              ? `${label} Keyframe'ini Sil (${localTime.toFixed(2)}s)`
              : `${label} için Keyframe Ekle (${localTime.toFixed(2)}s)`
          }
          className={`flex h-4 w-4 items-center justify-center rounded-full transition-all duration-150 disabled:opacity-25 ${
            atNow
              ? 'bg-[var(--accent)]/25 text-[var(--accent)]  scale-110'
              : hasAny
                ? 'bg-white/[0.08] text-[var(--accent)]/75 hover:bg-white/[0.15] hover:text-[var(--accent)]'
                : 'bg-white/[0.04] text-white/35 hover:bg-white/[0.12] hover:text-white/80'
          }`}
        >
          <span className="text-[9px] leading-none">{atNow || hasAny ? '◆' : '◇'}</span>
        </button>
        {hasAny && onSeek && (
          <button
            type="button"
            onClick={() => stepToKeyframe(param, 1)}
            title={`Sonraki ${label} Keyframe'ine Git`}
            className="rounded px-0.5 text-[8px] text-white/40 transition hover:text-white"
          >
            ▶
          </button>
        )}
      </div>
    )
  }

  const patchClip = (patch: Partial<TimelineClip>) => {
    if (!activeClip || !onUpdateClip) return
    onUpdateClip(activeClip.id, patch)
  }

  const addCreditRow = () => {
    onCredit({
      ...credit,
      rows: [
        ...credit.rows,
        { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'ROL', name: 'İsim' }
      ]
    })
  }

  const updateRow = (id: string, patch: { role?: string; name?: string }) => {
    onCredit({
      ...credit,
      rows: credit.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    })
  }

  const removeRow = (id: string) => {
    onCredit({
      ...credit,
      rows: credit.rows.filter((r) => r.id !== id)
    })
  }

  return (
    <aside
      style={{ width }}
      className="glass flex h-full shrink-0 flex-col gap-2.5 overflow-y-auto p-3 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
    >
      {tab === 'CUT' && (
        <>
          {/* Seçili Klip Bilgi Başlığı */}
          <div className="soft-card flex items-center justify-between px-4 py-2.5">
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                Kurgu Denetçisi (Edit Inspector)
              </div>
              <div className="truncate text-xs font-semibold text-white">
                {activeClip ? activeClip.name : 'Sahnede klip seçilmedi'}
              </div>
            </div>
            {activeClip && (
              <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-2.5 py-0.5 font-mono text-[9px] font-bold text-[var(--accent)]">
                {activeClip.lane}
              </span>
            )}
          </div>

          {/* 1. TRANSFORM (KADRAJ & HAREKET + KEYFRAME ANİMASYON) */}
          <Accordion
            title="Transform (Kadraj & Hareket)"
            defaultOpen
            right={
              <div className="flex items-center gap-1">
                {(activeClip?.keyframes?.length ?? 0) > 0 && (
                  <span
                    data-testid="transform-kf-count"
                    className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-[var(--accent)]"
                    title="Aktif Keyframe Sayısı"
                  >
                    ◆ {activeClip?.keyframes?.length}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="transform-reset-btn"
                  onClick={() => patchClip({ transform: defaultClipTransform(), keyframes: [] })}
                  disabled={!activeClip}
                  className="chip !py-0.5 !text-[10px] disabled:opacity-30"
                >
                  Sıfırla
                </button>
              </div>
            }
          >
            {/* Keyframe Eğri Modu (Ease-In-Out / Linear) */}
            <div className="flex items-center justify-between rounded-xl bg-black/25 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-[9px] text-white/55">
                <span className="text-[var(--accent)]">◆</span>
                <span>Keyframe Geçişi</span>
                {activeClip && (
                  <span className="font-mono text-[8px] text-white/35">
                    @{localTime.toFixed(2)}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5 rounded-full bg-white/[0.05] p-0.5">
                {(
                  [
                    ['ease-in-out', 'Ease-In-Out'],
                    ['linear', 'Linear']
                  ] as Array<[KeyframeEasing, string]>
                ).map(([mode, lbl]) => {
                  const selected = (activeClip?.keyframeEasing ?? 'ease-in-out') === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`kf-easing-${mode}`}
                      disabled={!activeClip}
                      onClick={() => {
                        if (!activeClip) return
                        const updatedKfs = (activeClip.keyframes ?? []).map((k) => ({
                          ...k,
                          easing: mode
                        }))
                        patchClip({ keyframeEasing: mode, keyframes: updatedKfs })
                      }}
                      className={`rounded-full px-2 py-0.5 font-mono text-[8px] font-semibold transition disabled:opacity-30 ${
                        selected
                          ? 'bg-white/[0.14] text-[var(--accent)] '
                          : 'text-white/45 hover:text-white/80'
                      }`}
                    >
                      {lbl}
                    </button>
                  )
                })}
              </div>
            </div>

            <Slider
              label="Yakınlaştırma (Scale)"
              testId="edit-scale-slider"
              value={tf.scale}
              min={10}
              max={400}
              step={1}
              defaultValue={100}
              unit="%"
              rightControl={renderKeyframeDiamond('scale', 'Scale')}
              onChange={(scale) => patchTransformParam('scale', scale)}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <Slider
                label="Konum X (Yatay)"
                testId="edit-posx-slider"
                value={tf.posX}
                min={-100}
                max={100}
                step={1}
                defaultValue={0}
                unit="%"
                rightControl={renderKeyframeDiamond('posX', 'Position X')}
                onChange={(posX) => patchTransformParam('posX', posX)}
              />
              <Slider
                label="Konum Y (Dikey)"
                testId="edit-posy-slider"
                value={tf.posY}
                min={-100}
                max={100}
                step={1}
                defaultValue={0}
                unit="%"
                rightControl={renderKeyframeDiamond('posY', 'Position Y')}
                onChange={(posY) => patchTransformParam('posY', posY)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Slider
                label="Döndürme (Rotation)"
                testId="edit-rotation-slider"
                value={tf.rotation}
                min={-180}
                max={180}
                step={1}
                defaultValue={0}
                unit="°"
                rightControl={renderKeyframeDiamond('rotation', 'Rotation')}
                onChange={(rotation) => patchTransformParam('rotation', rotation)}
              />
              <Slider
                label="Saydamlık (Opacity)"
                testId="edit-opacity-slider"
                value={tf.opacity}
                min={0}
                max={100}
                step={1}
                defaultValue={100}
                unit="%"
                rightControl={renderKeyframeDiamond('opacity', 'Opacity')}
                onChange={(opacity) => patchTransformParam('opacity', opacity)}
              />
            </div>
          </Accordion>

          {/* 2. SPEED / TIME (HIZ KONTROLÜ) */}
          <Accordion
            title="Speed / Time (Hız Kontrolü)"
            defaultOpen
            right={
              <button
                type="button"
                data-testid="speed-reset-btn"
                onClick={() => patchClip({ speed: 100, reverse: false })}
                disabled={!activeClip}
                className="chip !py-0.5 !text-[10px] disabled:opacity-30"
              >
                1x Normal
              </button>
            }
          >
            <Slider
              label="Oynatma Hızı (Slow-Mo ↔ Fast)"
              testId="edit-speed-slider"
              value={activeClip?.speed ?? 100}
              min={25}
              max={400}
              step={5}
              defaultValue={100}
              unit="%"
              onChange={(speed) => patchClip({ speed })}
            />

            <div className="grid grid-cols-6 gap-1">
              {[25, 50, 100, 150, 200, 400].map((spd) => {
                const active = Math.round(activeClip?.speed ?? 100) === spd
                return (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => patchClip({ speed: spd })}
                    className={`rounded border py-1 font-mono text-[9px] font-semibold transition ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                        : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {spd / 100}x
                  </button>
                )
              })}
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/85 hover:border-white/30">
              <span>Ters Oynatma (Reverse)</span>
              <input
                data-testid="edit-reverse-toggle"
                type="checkbox"
                checked={Boolean(activeClip?.reverse)}
                onChange={(e) => patchClip({ reverse: e.target.checked })}
                className="accent-[var(--accent)]"
              />
            </label>

            {/* Speed Ramp (Değişken Hız Eğrisi) */}
            <div className="space-y-1.5 rounded-md border border-white/10 bg-black/25 p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-white/80">Speed Ramp (Hız Eğrisi)</span>
                {activeClip?.speedRamp && activeClip.speedRamp.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patchClip({ speedRamp: undefined })}
                    className="text-[9px] text-white/50 hover:text-white"
                  >
                    Temizle
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    ['Sabit', null],
                    ['Slow-Mo', [130, 35, 35, 150]],
                    ['Pulse', [100, 240, 100]],
                    ['Hızlan', [60, 240]]
                  ] as Array<[string, number[] | null]>
                ).map(([label, curve]) => {
                  const isActive = curve
                    ? Boolean(activeClip?.speedRamp?.length) &&
                      activeClip?.speedRamp?.length === curve.length &&
                      activeClip?.speedRamp?.every((pt, idx) => Math.round(pt.speed) === curve[idx])
                    : !activeClip?.speedRamp?.length
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={!activeClip}
                      onClick={() => {
                        if (!activeClip) return
                        if (!curve) {
                          patchClip({ speedRamp: undefined })
                          return
                        }
                        const dur = Math.max(0.2, activeClip.duration)
                        const pts = curve.map((spd, i) => ({
                          id: `sr-${Date.now()}-${i}`,
                          time: Number(((i / Math.max(1, curve.length - 1)) * dur).toFixed(3)),
                          speed: spd
                        }))
                        patchClip({ speedRamp: pts })
                      }}
                      className={`rounded border py-1 text-[9px] font-semibold transition disabled:opacity-30 ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                          : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/30 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {activeClip?.speedRamp && activeClip.speedRamp.length > 0 && (
                <div className="space-y-1 pt-1">
                  {activeClip.speedRamp.map((pt, idx) => (
                    <div key={pt.id} className="flex items-center gap-2 text-[9px] text-white/70">
                      <span className="w-10 font-mono text-white/45">{pt.time.toFixed(1)}s</span>
                      <input
                        type="range"
                        min={25}
                        max={400}
                        step={5}
                        value={pt.speed}
                        onChange={(e) => {
                          const next = activeClip.speedRamp!.map((p, i) =>
                            i === idx ? { ...p, speed: Number(e.target.value) } : p
                          )
                          patchClip({ speedRamp: next })
                        }}
                        className="h-1 flex-1 accent-[var(--accent)]"
                      />
                      <span className="w-9 text-right font-mono">{Math.round(pt.speed)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Accordion>

          {/* 3. GEÇİŞ EFEKTLERİ (TRANSITIONS) */}
          <Accordion title="Geçiş Efektleri (Transitions)" defaultOpen>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['none', 'Kesme (Yok)', 'Doğrudan geçiş'],
                  ['cross-dissolve', 'Cross Dissolve', 'Yumuşak geçiş'],
                  ['dip-to-black', 'Dip to Black', 'Siyaha kararma'],
                  ['wipe-left', 'Wipe Left', 'Soldan silme'],
                  ['slide-left', 'Slide Left', 'Sola kaydırma'],
                  ['zoom-in', 'Zoom In', 'Yakınlaşma'],
                  ['film-burn', 'Film Burn', 'Işık patlaması']
                ] as Array<[TransitionType, string, string]>
              ).map(([id, label, desc]) => {
                const selected = (activeClip?.transitionType ?? 'none') === id
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`transition-${id}-btn`}
                    onClick={() =>
                      patchClip({
                        transitionType: id,
                        transitionDuration:
                          id === 'none' ? 0 : Math.max(0.2, activeClip?.transitionDuration || 0.8)
                      })
                    }
                    className={`flex flex-col items-start rounded-md border p-2 text-left transition ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white '
                        : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    <span className="text-[10px] font-semibold leading-tight">{label}</span>
                    <span className="mt-0.5 text-[8px] text-white/45">{desc}</span>
                  </button>
                )
              })}
            </div>

            {(activeClip?.transitionType ?? 'none') !== 'none' && (
              <Slider
                label="Geçiş Süresi"
                testId="edit-transition-duration-slider"
                value={activeClip?.transitionDuration ?? 0.8}
                min={0.2}
                max={3.0}
                step={0.1}
                defaultValue={0.8}
                unit=" sn"
                onChange={(transitionDuration) => patchClip({ transitionDuration })}
              />
            )}
          </Accordion>

          {/* 3B. MASKELEME & SANSÜR (POWER WINDOW / BLUR / VIGNETTE) */}
          <Accordion
            title="Maskeleme & Sansür (Power Window)"
            right={
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-white/75">
                <input
                  type="checkbox"
                  checked={Boolean(activeClip?.mask?.enabled)}
                  disabled={!activeClip}
                  onChange={(e) => {
                    const cur = activeClip?.mask ?? defaultClipMask()
                    patchClip({ mask: { ...cur, enabled: e.target.checked } })
                  }}
                  className="accent-[var(--accent)]"
                />
                Aktif
              </label>
            }
          >
            {(() => {
              const m = activeClip?.mask ?? defaultClipMask()
              const patchMask = (p: Partial<typeof m>) =>
                patchClip({ mask: { ...m, ...p, enabled: p.enabled ?? true } })
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['blur', 'Gaussian Blur'],
                        ['mosaic', 'Mozaik Sansür'],
                        ['vignette', 'Vignette']
                      ] as const
                    ).map(([id, lbl]) => (
                      <button
                        key={id}
                        type="button"
                        disabled={!activeClip}
                        onClick={() => patchMask({ mode: id })}
                        className={`rounded border py-1 text-[9px] font-semibold transition ${
                          m.mode === id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                            : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/30'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {m.mode !== 'vignette' && (
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          ['ellipse', 'Elips / Yüz'],
                          ['rect', 'Dikdörtgen / Plaka']
                        ] as const
                      ).map(([sh, lbl]) => (
                        <button
                          key={sh}
                          type="button"
                          disabled={!activeClip}
                          onClick={() => patchMask({ shape: sh })}
                          className={`rounded border py-1 text-[9px] font-semibold transition ${
                            m.shape === sh
                              ? 'border-white/40 bg-white/10 text-white'
                              : 'border-white/10 bg-white/[0.02] text-white/55'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  )}
                  <Slider
                    label="Şiddet"
                    value={m.strength}
                    min={5}
                    max={100}
                    step={1}
                    defaultValue={65}
                    unit="%"
                    onChange={(strength) => patchMask({ strength })}
                  />
                  {m.mode !== 'vignette' && (
                    <>
                      <Slider
                        label="Konum X"
                        value={m.x}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={50}
                        unit="%"
                        onChange={(x) => patchMask({ x })}
                      />
                      <Slider
                        label="Konum Y"
                        value={m.y}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={50}
                        unit="%"
                        onChange={(y) => patchMask({ y })}
                      />
                      <Slider
                        label="Genişlik"
                        value={m.w}
                        min={5}
                        max={100}
                        step={1}
                        defaultValue={32}
                        unit="%"
                        onChange={(w) => patchMask({ w })}
                      />
                      <Slider
                        label="Yükseklik"
                        value={m.h}
                        min={5}
                        max={100}
                        step={1}
                        defaultValue={32}
                        unit="%"
                        onChange={(h) => patchMask({ h })}
                      />
                    </>
                  )}
                </div>
              )
            })()}
          </Accordion>

          {/* 4. SES MİKSERİ & EFEKTLERİ (AUDIO MIXER & FX) */}
          <Accordion
            title="Ses Mikseri & Efektleri"
            defaultOpen
            right={
              <button
                type="button"
                onClick={() =>
                  patchClip({
                    gainDb: 0,
                    pan: 0,
                    fadeIn: 0,
                    fadeOut: 0,
                    audioPreset: 'none'
                  })
                }
                disabled={!activeClip}
                className="chip !py-0.5 !text-[10px] disabled:opacity-30"
              >
                Sıfırla
              </button>
            }
          >
            <div>
              <div
                className="mb-1 flex cursor-pointer justify-between text-[10px] text-white/55"
                title="Çift tıkla: 0 dB"
                onDoubleClick={() => patchClip({ gainDb: 0 })}
              >
                <span>Ses Seviyesi (Volume)</span>
                <span className="font-mono text-tungsten">
                  {fmtDb(activeClip?.gainDb ?? 0)}
                </span>
              </div>
              <input
                data-testid="edit-volume-slider"
                type="range"
                min={MIN_DB}
                max={MAX_DB}
                step={0.5}
                value={activeClip?.gainDb ?? 0}
                onChange={(e) => patchClip({ gainDb: parseFloat(e.target.value) })}
                style={
                  {
                    '--pct': `${Math.max(0, Math.min(100, (((activeClip?.gainDb ?? 0) - MIN_DB) / Math.max(0.001, MAX_DB - MIN_DB)) * 100))}%`
                  } as React.CSSProperties
                }
                className="w-full"
              />
            </div>

            <Slider
              label="Pan (Sol ↔ Sağ Denge)"
              testId="edit-pan-slider"
              value={activeClip?.pan ?? 0}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(pan) => patchClip({ pan })}
            />

            <div className="grid grid-cols-2 gap-2.5">
              <Slider
                label="Fade In (Giriş)"
                testId="edit-fadein-slider"
                value={activeClip?.fadeIn ?? 0}
                min={0}
                max={Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)}
                step={0.1}
                defaultValue={0}
                unit=" sn"
                onChange={(fadeIn) => patchClip({ fadeIn })}
              />
              <Slider
                label="Fade Out (Çıkış)"
                testId="edit-fadeout-slider"
                value={activeClip?.fadeOut ?? 0}
                min={0}
                max={Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)}
                step={0.1}
                defaultValue={0}
                unit=" sn"
                onChange={(fadeOut) => patchClip({ fadeOut })}
              />
            </div>

            <div>
              <div className="mb-1.5 text-[10px] text-white/55">Ses Efekt Ön Ayarı (Audio FX)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['none', 'Doğal', 'Ham ses'],
                    ['denoise', 'Denoise', 'Gürültü azalt'],
                    ['bass-boost', 'Sinematik Bas', 'Alt frekans güçlendir']
                  ] as Array<[AudioFxPreset, string, string]>
                ).map(([id, label, desc]) => {
                  const selected = (activeClip?.audioPreset ?? 'none') === id
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`audio-fx-${id}-btn`}
                      onClick={() => patchClip({ audioPreset: id })}
                      className={`flex flex-col items-start rounded-md border p-2 text-left transition ${
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                          : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/30 hover:text-white'
                      }`}
                    >
                      <span className="text-[10px] font-semibold leading-tight">{label}</span>
                      <span className="mt-0.5 text-[8px] text-white/45">{desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Auto-Ducking (Diyalog Önceliği) */}
            <label
              data-testid="auto-ducking-row"
              className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2.5 transition duration-150 hover:border-[var(--accent)]/40"
            >
              <div className="pr-2">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/90">
                  <span>Auto-Ducking (Diyalog Önceliği)</span>
                </div>
                <div className="mt-0.5 text-[8.5px] text-white/45">
                  V1/A1 sesi yükseldiğinde A2 müziğini otomatik yumuşat (-11 dB)
                </div>
              </div>
              <SoftToggle
                testId="auto-ducking-toggle"
                checked={autoDucking}
                onChange={(v) => onToggleAutoDucking?.(v)}
              />
            </label>

            {/* Prosedürel Sinematik Ses Tasarımı (Noir Soundscape) */}
            {onAddSoundscapeClip && (
              <div className="pt-1">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-white/70">
                    Noir Soundscape (Prosedürel SFX)
                  </span>
                  <span className="font-mono text-[8px] text-[var(--accent)]">
                    PLAYHEAD&apos;E EKLE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {NOIR_SOUNDSCAPE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`soundscape-${preset.id}`}
                      onClick={() => onAddSoundscapeClip(preset.id)}
                      title={`${preset.label} (${preset.duration.toFixed(1)} sn) — Seçili saniyeye ses klibi olarak ekle`}
                      className="flex flex-col items-start rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-left transition-all duration-150 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/12  active:scale-95"
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-[10px] font-semibold text-white/90">
                          {preset.label}
                        </span>
                        <span className="font-mono text-[8px] text-[var(--accent)]">
                          {preset.duration.toFixed(1)}s
                        </span>
                      </div>
                      <span className="mt-0.5 text-[8px] text-white/45">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Accordion>
        </>
      )}

      {tab === 'GRADE' && (
        <>
          <Accordion
            title="Renk Tekerlekleri"
            defaultOpen
            right={
              <button
                data-testid="grade-reset-btn"
                className="chip !py-0.5 !text-[10px]"
                onClick={() => onGrade(defaultColorGrade())}
                title="Tüm renk ve LUT ayarlarını sıfırla"
              >
                Sıfırla
              </button>
            }
          >
            {activeClipName && (
              <div className="truncate font-mono text-[9px] text-[#71717A]">Klip: {activeClipName}</div>
            )}
            <HoneycombColorWheels
              lift={grade.lift}
              gamma={grade.gamma}
              gain={grade.gain}
              onLift={setWheel('lift')}
              onGamma={setWheel('gamma')}
              onGain={setWheel('gain')}
            />
          </Accordion>

          <Accordion
            title="Beyaz Dengesi (White Balance)"
            defaultOpen
            right={
              <button
                type="button"
                data-testid="wb-reset-btn"
                disabled={!wbDirty}
                onClick={() => onGrade({ ...grade, temperature: 0, tint: 0 })}
                title="Sıcaklık ve Ton değerlerini sıfırla"
                className="chip !py-0.5 !text-[10px] disabled:opacity-30"
              >
                Sıfırla
              </button>
            }
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="auto-wb-btn"
                onClick={onAutoWhiteBalance}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-[#E4E4E7] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-white active:scale-95"
              >
                <span>Auto WB</span>
              </button>
              <button
                type="button"
                data-testid="wb-picker-btn"
                onClick={onToggleWbPicker}
                className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                  wbPickerActive
                    ? 'border-[var(--accent)] bg-[var(--accent)]/25 text-white'
                    : 'border-[color:var(--border-subtle)] bg-white/[0.04] text-[#E4E4E7]/85'
                }`}
              >
                <span>{wbPickerActive ? 'Seçiliyor…' : 'Damlalık'}</span>
              </button>
            </div>
          </Accordion>
        </>
      )}

      {tab === 'CREDITS' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="panel-title">Jenerik Editörü</span>
            <button
              data-testid="add-credit-btn"
              onClick={onAddCreditToTimeline}
              className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-95"
            >
              + Timeline'a Ekle
            </button>
          </div>

          <Accordion title="İçerik & Satırları" defaultOpen>
            {credit.templateId === 'rolling-credits' ? (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Üst Başlık (Opsiyonel)</div>
                  <input
                    value={credit.title}
                    onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                    placeholder="Örn: NOIRCUT SUNAR"
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/50">Kadro Satırları (Rol — İsim)</span>
                  <button
                    data-testid="add-credit-row-btn"
                    onClick={addCreditRow}
                    className="chip !py-0.5 !text-[10px]"
                  >
                    + Yeni Satır Ekle
                  </button>
                </div>

                <div className="max-h-[150px] space-y-1.5 overflow-y-auto pr-0.5">
                  {credit.rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-1.5">
                      <input
                        value={row.role}
                        onChange={(e) => updateRow(row.id, { role: e.target.value })}
                        placeholder="Rol"
                        className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none focus:border-[#71717A]"
                      />
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.id, { name: e.target.value })}
                        placeholder="İsim"
                        className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white outline-none focus:border-[#71717A]"
                      />
                      <button
                        onClick={() => removeRow(row.id)}
                        title="Satırı sil"
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-white/40 hover:bg-[#71717A]/25 hover:text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : credit.templateId === 'standard-text' ? (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                    <span>Standart Metin (Çok Satırlı)</span>
                    <label className="flex cursor-pointer items-center gap-1 text-[9.5px] text-white/65">
                      <input
                        type="checkbox"
                        checked={Boolean(credit.uppercase)}
                        onChange={(e) => onCredit({ ...credit, uppercase: e.target.checked })}
                        className="accent-[var(--accent)]"
                      />
                      Büyük Harf
                    </label>
                  </div>
                  <textarea
                    data-testid="credit-standard-textarea"
                    rows={3}
                    value={credit.title}
                    onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                    placeholder="Ekranda görünecek standart metni yazın..."
                    className="w-full resize-y rounded border border-[color:var(--border-subtle)] bg-black/45 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Alt Metin (Opsiyonel)</div>
                  <input
                    data-testid="credit-subtitle-input"
                    value={credit.subtitle}
                    onChange={(e) => onCredit({ ...credit, subtitle: e.target.value })}
                    placeholder="İkincil satır veya açıklama..."
                    className="w-full rounded border border-[color:var(--border-subtle)] bg-black/45 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[9.5px] text-white/50">Yatay Hizalama</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          ['left', 'Sol'],
                          ['center', 'Orta'],
                          ['right', 'Sağ']
                        ] as Array<[CreditTextAlign, string]>
                      ).map(([al, lbl]) => (
                        <button
                          key={al}
                          type="button"
                          onClick={() => onCredit({ ...credit, textAlign: al })}
                          className={`rounded border py-1 text-[9.5px] font-medium transition ${
                            (credit.textAlign ?? 'center') === al
                              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                              : 'border-[color:var(--border-subtle)] text-white/60 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[9.5px] text-white/50">Dikey Konum</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          ['top', 'Üst'],
                          ['center', 'Orta'],
                          ['bottom', 'Alt']
                        ] as Array<[CreditTextPosition, string]>
                      ).map(([pos, lbl]) => (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => onCredit({ ...credit, textPosition: pos })}
                          className={`rounded border py-1 text-[9.5px] font-medium transition ${
                            (credit.textPosition ?? 'center') === pos
                              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                              : 'border-[color:var(--border-subtle)] text-white/60 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Ana Başlık</div>
                  <input
                    data-testid="credit-title-input"
                    value={credit.title}
                    onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Alt Başlık</div>
                  <input
                    data-testid="credit-subtitle-input"
                    value={credit.subtitle}
                    onChange={(e) => onCredit({ ...credit, subtitle: e.target.value })}
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>
              </div>
            )}
          </Accordion>

          <Accordion title="Tipografi ve Süre" defaultOpen>
            <div className="space-y-2.5">
              <input
                ref={fontFileInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                onChange={handleUploadCustomFont}
                className="hidden"
                data-testid="custom-font-file-input"
              />
              <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
                <span>Kült Sinema &amp; Korku (20+ Font)</span>
                <button
                  type="button"
                  data-testid="upload-custom-font-btn"
                  onClick={() => fontFileInputRef.current?.click()}
                  className="rounded-full border border-[var(--accent)]/45 bg-[var(--accent)]/12 px-2.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/22 active:scale-95"
                  title="Bilgisayarınızdan .ttf, .otf veya .woff2 font dosyası yükleyin"
                >
                  + .ttf / .otf Font Yükle
                </button>
              </div>

              {fontUploadError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9.5px] text-red-300">
                  {fontUploadError}
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[9.5px]">
                <span className="text-white/50">Seçili Font</span>
                <span className="truncate font-mono font-semibold text-[var(--accent)]">
                  {credit.font === 'custom'
                    ? credit.customFont?.fileName || credit.customFont?.name || 'Özel Font'
                    : FONT_MAP[credit.font]?.label}
                </span>
              </div>

              {/* Akıllı TR -> EN Karakter Düzeltme (Auto-ASCII Toggle) */}
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.08] bg-black/30 px-2.5 py-1.5 text-[10px] text-white/85 transition hover:border-[var(--accent)]/45">
                  <div className="flex flex-col">
                    <span className="font-medium">TR -&gt; EN Harf Dönüştür</span>
                    <span className="text-[8.5px] text-white/45">Ğ→G, Ü→U, Ş→S, İ→I, Ö→O, Ç→C</span>
                  </div>
                  <SoftToggle
                    testId="credit-auto-ascii-toggle"
                    checked={Boolean(credit.autoAscii)}
                    onChange={(v) => onCredit({ ...credit, autoAscii: v })}
                  />
                </label>
                {!credit.autoAscii && isAsciiRecommendedFont(credit.font) && (
                  <div className="flex items-center justify-between rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[8.5px] text-amber-200">
                    <span>Bu afiş fontu İngilizce odaklıdır (tofu kutusu önleme önerisi).</span>
                    <button
                      type="button"
                      onClick={() => onCredit({ ...credit, autoAscii: true })}
                      className="ml-1.5 shrink-0 font-semibold underline hover:text-white"
                    >
                      Dönüştür
                    </button>
                  </div>
                )}
              </div>

              {/* Yüklenen Özel (.ttf / .otf) Fontlar */}
              {customFonts.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[8.5px] font-semibold uppercase tracking-wider text-[var(--accent)]/80">
                    Özel Yüklenen Fontlar ({customFonts.length})
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {customFonts.map((cf) => {
                      const active = credit.font === 'custom' && credit.customFont?.id === cf.id
                      return (
                        <div
                          key={cf.id}
                          className={`group flex items-center justify-between rounded-xl border px-2 py-1.5 transition ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                              : 'border-[color:var(--border-subtle)] bg-black/25 text-white/75 hover:border-white/30'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onCredit({
                                ...credit,
                                font: 'custom',
                                customFont: {
                                  id: cf.id,
                                  name: cf.name,
                                  dataUrl: cf.dataUrl,
                                  fileName: cf.fileName
                                }
                              })
                            }
                            className="min-w-0 flex-1 text-left"
                            title={cf.fileName || cf.label}
                          >
                            <div
                              className="truncate text-[11px] font-semibold leading-tight"
                              style={{ fontFamily: `"${cf.name}", "Inter", sans-serif` }}
                            >
                              {cf.label}
                            </div>
                            <div className="truncate text-[8px] text-white/45">Özel TTF/OTF</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = removeStoredCustomFont(cf.id)
                              setCustomFonts(next)
                              if (credit.font === 'custom' && credit.customFont?.id === cf.id) {
                                onCredit({ ...credit, font: 'bebas', customFont: undefined })
                              }
                            }}
                            title="Özel fontu kaldır"
                            className="ml-1 shrink-0 rounded px-1 text-[10px] text-white/35 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Kategori Filtreleri */}
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['ALL', 'Tümü'],
                    ['Horror, Slasher & Occult', 'Horror / Occult'],
                    ['Noir, Pulp & Dedektif Afişleri', 'Noir / Pulp'],
                    ['Klasik Sinema & Sanatsal Başlıklar', 'Klasik'],
                    ['Senaryo, Daktilo & Analog Kayıt', 'Senaryo / VHS']
                  ] as Array<['ALL' | CreditFontCategory, string]>
                ).map(([catKey, catLbl]) => (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setFontCategoryFilter(catKey)}
                    className={`rounded-full border px-2 py-0.5 text-[8.5px] font-semibold transition ${
                      fontCategoryFilter === catKey
                        ? 'border-[var(--accent)] bg-[var(--accent)]/18 text-[var(--accent)]'
                        : 'border-white/[0.08] bg-black/25 text-white/55 hover:text-white'
                    }`}
                  >
                    {catLbl}
                  </button>
                ))}
              </div>

              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-0.5">
                {CREDIT_FONT_CATEGORIES.filter(
                  (cat) => fontCategoryFilter === 'ALL' || fontCategoryFilter === cat
                ).map((cat) => (
                  <div key={cat} className="space-y-1">
                    <div className="text-[8.5px] font-semibold uppercase tracking-wider text-white/40">
                      {cat}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {CINEMATIC_FONTS.filter((f) => f.category === cat).map((f) => {
                        const active = credit.font === f.id
                        return (
                          <button
                            key={f.id}
                            type="button"
                            data-testid={`credit-font-${f.id}`}
                            onClick={() => onCredit({ ...credit, font: f.id })}
                            title={`${f.label} — ${f.role}`}
                            className={`flex flex-col items-start rounded-xl border px-2.5 py-1.5 text-left transition duration-150 ${
                              active
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white shadow-[0_0_10px_var(--accent-glow)]'
                                : 'border-[color:var(--border-subtle)] bg-black/25 text-white/75 hover:border-white/30 hover:text-white'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span
                                className="truncate text-[11.5px] font-semibold leading-tight"
                                style={{ fontFamily: f.css }}
                              >
                                {f.label}
                              </span>
                              <span
                                className={`shrink-0 rounded px-1 py-0 text-[7.5px] font-mono ${
                                  f.trSupport === 'ascii'
                                    ? 'bg-amber-400/15 text-amber-300'
                                    : 'bg-[var(--accent)]/15 text-[var(--accent)]'
                                }`}
                              >
                                {f.trSupport === 'ascii' ? 'EN' : 'TR'}
                              </span>
                            </div>
                            <span className="mt-0.5 truncate text-[8px] text-white/45">
                              {f.role}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                <span>Metin Rengi</span>
                <span className="font-mono text-[#71717A]">{credit.color}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={credit.color}
                  onChange={(e) => onCredit({ ...credit, color: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-[#71717A]/30 bg-transparent"
                />
                {['#FFFFFF', '#E4E4E7', '#EF4444', '#F59E0B', '#B7E36A'].map((sw) => (
                  <button
                    key={sw}
                    onClick={() => onCredit({ ...credit, color: sw })}
                    className={`h-5 w-5 rounded-full border transition ${
                      credit.color.toUpperCase() === sw ? 'scale-110 border-white' : 'border-white/20'
                    }`}
                    style={{ background: sw }}
                    title={sw}
                  />
                ))}
              </div>
            </div>

            <Slider
              label="Yazı Boyutu"
              value={credit.fontSize}
              min={16}
              max={96}
              step={1}
              defaultValue={40}
              unit="px"
              onChange={(fontSize) => onCredit({ ...credit, fontSize })}
            />
            <Slider
              label="Harf Aralığı (Tracking)"
              testId="credit-letter-spacing-slider"
              value={credit.letterSpacing}
              min={0}
              max={20}
              step={0.5}
              defaultValue={2}
              unit="px"
              onChange={(letterSpacing) => onCredit({ ...credit, letterSpacing })}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <Slider
                label="Satır Yüksekliği"
                testId="credit-line-height-slider"
                value={credit.lineHeight ?? 1.25}
                min={0.85}
                max={2.4}
                step={0.05}
                defaultValue={1.25}
                unit="x"
                onChange={(lineHeight) => onCredit({ ...credit, lineHeight })}
              />
              <Slider
                label="Metin Gölgesi / Glow"
                testId="credit-text-shadow-slider"
                value={credit.textShadow ?? 45}
                min={0}
                max={100}
                step={1}
                defaultValue={45}
                unit="%"
                onChange={(textShadow) => onCredit({ ...credit, textShadow })}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                <span>Neon Glow Rengi</span>
                <span className="font-mono text-[#71717A]">
                  {credit.glowColor && credit.glowColor.toLowerCase() !== '#000000'
                    ? credit.glowColor
                    : 'Klasik Gölge'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={credit.glowColor || '#000000'}
                  onChange={(e) => onCredit({ ...credit, glowColor: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-[#71717A]/30 bg-transparent"
                  title="Özel Neon Glow Rengi"
                />
                {(
                  [
                    ['#000000', 'Klasik Koyu Gölge'],
                    ['#EF4444', 'Kan Kırmızısı Neon'],
                    ['#B7E36A', 'Noir Lime Glow'],
                    ['#22D3EE', 'Siber Cyan Neon'],
                    ['#F59E0B', 'Tungsten Amber']
                  ] as const
                ).map(([sw, title]) => (
                  <button
                    key={sw}
                    type="button"
                    onClick={() => onCredit({ ...credit, glowColor: sw })}
                    className={`h-5 w-5 rounded-full border transition ${
                      (credit.glowColor || '#000000').toUpperCase() === sw
                        ? 'scale-110 border-white'
                        : 'border-white/25'
                    }`}
                    style={{
                      background: sw,
                      boxShadow: sw !== '#000000' ? `0 0 8px ${sw}` : undefined
                    }}
                    title={title}
                  />
                ))}
              </div>
            </div>
            <Slider
              label="Toplam Akış Süresi"
              value={credit.duration}
              min={2}
              max={30}
              step={0.5}
              defaultValue={5}
              unit="s"
              onChange={(duration) => onCredit({ ...credit, duration })}
            />
          </Accordion>

          <Accordion title="Efektler & Foley Ses" defaultOpen>
            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
              <span>Daktilo Efekti (Typewriter)</span>
              <SoftToggle
                testId="credit-typewriter-toggle"
                checked={credit.typewriter}
                onChange={(v) => onCredit({ ...credit, typewriter: v })}
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
              <span>Film Titremesi (Gate Weave)</span>
              <SoftToggle
                testId="credit-weave-toggle"
                checked={credit.filmWeave}
                onChange={(v) => onCredit({ ...credit, filmWeave: v })}
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
              <span>Efekt Sesi Ekle (Foley SFX)</span>
              <SoftToggle
                testId="credit-sfx-toggle"
                checked={credit.sfxEnabled}
                onChange={(v) => onCredit({ ...credit, sfxEnabled: v })}
              />
            </label>

            {credit.sfxEnabled && (
              <Slider
                label="Foley Ses Seviyesi"
                value={credit.sfxVolume}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(sfxVolume) => onCredit({ ...credit, sfxVolume })}
              />
            )}
          </Accordion>
        </div>
      )}
    </aside>
  )
}
