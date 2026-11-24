import { type ColorGrade } from '../../../shared/color'
import type { CreditConfig } from '../../../shared/credits'
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
import { Accordion, fmtDb, Slider, SoftToggle } from './right-panel/RightPanelControls'
import { RightPanelCreditsTab } from './right-panel/RightPanelCreditsTab'
import { RightPanelGradeTab } from './right-panel/RightPanelGradeTab'

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
        <RightPanelGradeTab
          grade={grade}
          activeClipName={activeClipName}
          wbDirty={wbDirty}
          wbPickerActive={wbPickerActive}
          onGrade={onGrade}
          onAutoWhiteBalance={onAutoWhiteBalance}
          onToggleWbPicker={onToggleWbPicker}
        />
      )}

      {tab === 'CREDITS' && (
        <RightPanelCreditsTab
          credit={credit}
          onCredit={onCredit}
          onAddCreditToTimeline={onAddCreditToTimeline}
        />
      )}
    </aside>
  )
}
