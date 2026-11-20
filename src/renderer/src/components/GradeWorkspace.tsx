import { useState } from 'react'
import {
  CAMERA_PROFILES,
  COLOR_GRADE_PRESETS,
  GRADE_PRESET_CATEGORIES,
  applyGradePreset,
  defaultColorGrade,
  isNeutralGrade,
  neutralWheel,
  type CameraProfileId,
  type ColorGrade,
  type GradePresetCategory,
  type WheelValue
} from '../../../shared/color'
import { BUILTIN_LUTS, type Lut3D } from '../../../shared/lut'
import type { GradeStill, TimelineClip } from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'
import { fmtDuration } from '../lib/format'
import ColorCurvesEditor from './ColorCurvesEditor'
import { HoneycombColorWheels } from './ColorWheel'
import type { OverlayVisualLayer, VideoSlot } from '../hooks/usePlayer'
import Monitor from './Monitor'
import NoirFilmPanel from './noirfilm/NoirFilmPanel'
import {
  LookComparisonFullscreenModal,
  type ComparisonMode
} from './noirfilm/LookComparisonViewer'
import VideoScopes from './VideoScopes'

function CompactSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
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
  gradient?: string
  testId?: string
  onChange: (n: number) => void
}) {
  const formatted =
    step < 1
      ? value > 0
        ? `+${value.toFixed(2)}`
        : value.toFixed(2)
      : value > 0 && min < 0
        ? `+${Math.round(value)}`
        : String(Math.round(value))

  // Pürüzsüz dolgu çubuğu (merkezden veya soldan var(--accent) ile dolan akıcı kanal)
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
    <div className="space-y-1">
      <div
        className="flex cursor-pointer items-center justify-between text-[9.5px] text-white/65 transition-colors hover:text-white/90"
        title="Çift tıkla: varsayılana sıfırla"
        onDoubleClick={() => onChange(defaultValue)}
      >
        <span className="truncate">{label}</span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-[var(--accent)]">
            {formatted}
            {unit}
          </span>
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            disabled={Math.abs(value - defaultValue) <= 0.005}
            title="Sıfırla"
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-[var(--text-muted)] transition-all duration-200 hover:bg-white/10 hover:text-white disabled:opacity-20"
          >
            ↺
          </button>
        </div>
      </div>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ background: trackBg }}
      />
    </div>
  )
}

export default function GradeWorkspace({
  media,
  mediaItems,
  mediaMap,
  v1Clips,
  activeClip,
  overlayLayers = [],
  registerOverlayVideoEl,
  registerVideoBufferEl,
  selectedClipId,
  onSelectClip,
  onImportMedia,
  videoProps,
  videoRef,
  error,
  playing,
  time,
  timeRef,
  subscribeTime,
  duration,
  onToggle,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onDropMedia,
  grade,
  onGrade,
  activeLut,
  customLuts,
  onImportLut,
  onAutoWhiteBalance,
  wbPickerActive,
  onToggleWbPicker,
  onPickWbRgb,
  onCancelWbPicker,
  stills = [],
  onGrabStill,
  onCopyGrade,
  onPasteGrade,
  hasCopiedGrade = false,
  onApplyStill,
  onDeleteStill,
  onApplyGradeToTimeline,
  onRegisterImportedLut
}: {
  media: MediaItem | null
  mediaItems: MediaItem[]
  mediaMap: Map<string, MediaItem>
  v1Clips: TimelineClip[]
  activeClip: TimelineClip | null
  overlayLayers?: OverlayVisualLayer[]
  registerOverlayVideoEl?: (clipId: string, el: HTMLVideoElement | null) => void
  registerVideoBufferEl?: (slot: VideoSlot, el: HTMLVideoElement | null) => void
  selectedClipId: string | null
  onSelectClip: (clipId: string, seekTime?: number) => void
  onImportMedia: () => void
  videoProps: React.VideoHTMLAttributes<HTMLVideoElement>
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  error: string | null
  playing: boolean
  time: number
  timeRef?: React.MutableRefObject<number>
  subscribeTime?: (cb: (t: number) => void) => () => void
  duration: number
  onToggle: () => void
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onDropMedia: (id: string) => void
  grade: ColorGrade
  onGrade: (g: ColorGrade) => void
  activeLut: Lut3D | null
  customLuts: Lut3D[]
  onImportLut: () => void
  onAutoWhiteBalance: () => void
  wbPickerActive: boolean
  onToggleWbPicker: () => void
  onPickWbRgb: (r01: number, g01: number, b01: number) => void
  onCancelWbPicker: () => void
  stills?: GradeStill[]
  onGrabStill?: () => void
  onCopyGrade?: () => void
  onPasteGrade?: () => void
  hasCopiedGrade?: boolean
  onApplyStill?: (still: GradeStill) => void
  onDeleteStill?: (id: string) => void
  onApplyGradeToTimeline?: (g: ColorGrade) => void
  onRegisterImportedLut?: (lut: Lut3D) => void
}) {
  const setWheel = (k: 'lift' | 'gamma' | 'gain' | 'offset') => (v: WheelValue) =>
    onGrade({ ...grade, [k]: v })

  const [studioMode, setStudioMode] = useState<'standard' | 'noirfilm' | 'lut-library'>('standard')
  const [lutLibraryType, setLutLibraryType] = useState<'all' | 'presets' | 'luts'>('all')
  const [presetCategory, setPresetCategory] = useState<GradePresetCategory | 'ALL' | 'CUSTOM'>('ALL')
  const [lutSearch, setLutSearch] = useState('')
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [previewGrade, setPreviewGrade] = useState<ColorGrade | null>(null)
  const [compareMode, setCompareMode] = useState<ComparisonMode>('none')
  const [compareWipe, setCompareWipe] = useState(50)
  const [fullscreenCompareOpen, setFullscreenCompareOpen] = useState(false)

  const displayGrade = previewGrade ?? grade
  const allLuts = [...BUILTIN_LUTS, ...customLuts]
  const effectiveLut = displayGrade.lutId
    ? (allLuts.find((l) => l.id === displayGrade.lutId) ?? activeLut)
    : activeLut
  const wbDirty = Math.abs(grade.temperature) > 0.01 || Math.abs(grade.tint) > 0.01
  const lutPct = Math.max(0, Math.min(100, grade.lutIntensity))

  return (
    <div
      data-testid="grade-studio-workspace"
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden"
    >
      {/* 1. ÜST / ORTA ALAN: Genişletilmiş Program Monitörü + Sağda Altıgen Petek (Lift / Gamma / Gain / Offset) */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <Monitor
          media={media}
          activeClip={activeClip}
          overlayLayers={overlayLayers}
          registerOverlayVideoEl={registerOverlayVideoEl}
          registerVideoBufferEl={registerVideoBufferEl}
          videoProps={videoProps}
          videoRef={videoRef}
          error={error}
          playing={playing}
          time={time}
          timeRef={timeRef}
          subscribeTime={subscribeTime}
          duration={duration}
          onToggle={onToggle}
          onSeek={onSeek}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onDropMedia={onDropMedia}
          grade={displayGrade}
          activeLut={effectiveLut}
          compareMode={compareMode}
          externalWipe={compareWipe}
          forceWebGL={true}
          wbPickerActive={wbPickerActive}
          onPickWbRgb={onPickWbRgb}
          onCancelWbPicker={onCancelWbPicker}
          onGrabStill={onGrabStill}
          onCopyGrade={onCopyGrade}
          onPasteGrade={onPasteGrade}
          hasCopiedGrade={hasCopiedGrade}
        />

        {/* SAĞ ÜST PANEL: Birbirine Kenetlenen Altıgen Petek (Honeycomb) Lift / Gamma / Gain + Offset */}
        <aside
          data-testid="honeycomb-wheels-panel"
          className="glass flex h-full w-[348px] shrink-0 flex-col justify-between overflow-y-auto p-3.5"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] " />
              <span className="panel-title truncate !text-[#E4E4E7]/90">
                Lift · Gamma · Gain · Offset
              </span>
            </div>
            <button
              type="button"
              data-testid="grade-reset-btn"
              onClick={() => onGrade(defaultColorGrade())}
              title="Tüm renk ve LUT ayarlarını sıfırla"
              className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[9px] font-medium text-white/80 transition-all duration-200 hover:bg-white/[0.12] hover:text-white active:scale-95"
            >
              Tümünü Sıfırla
            </button>
          </div>

          {activeClip && (
            <div className="mb-1 flex items-center justify-between rounded-full bg-black/30 px-3 py-1 font-mono text-[9px]">
              <span className="text-white/45">AKTİF KLİP:</span>
              <span className="max-w-[190px] truncate text-[var(--accent)]">{activeClip.name}</span>
            </div>
          )}

          <div className="flex flex-1 items-center justify-center">
            <div className="w-full">
              <HoneycombColorWheels
                lift={grade.lift}
                gamma={grade.gamma}
                gain={grade.gain}
                offset={grade.offset ?? neutralWheel()}
                onLift={setWheel('lift')}
                onGamma={setWheel('gamma')}
                onGain={setWheel('gain')}
                onOffset={setWheel('offset')}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* GRADE STÜDYO MOD SEÇİCİ: Color Deck & Scopes · NoirFilm Studio · LUT Kütüphanesi */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <div
          data-testid="grade-mode-switcher"
          className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-0.5"
        >
          <button
            type="button"
            data-testid="grade-mode-standard-btn"
            onClick={() => {
              setPreviewGrade(null)
              setStudioMode('standard')
            }}
            className={`rounded-full px-3.5 py-1 text-[10px] font-semibold tracking-wider transition-all duration-150 ${
              studioMode === 'standard'
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_10px_var(--accent-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            COLOR DECK & SCOPES
          </button>
          <button
            type="button"
            data-testid="grade-mode-noirfilm-btn"
            onClick={() => setStudioMode('noirfilm')}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[10px] font-semibold tracking-wider transition-all duration-150 ${
              studioMode === 'noirfilm'
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_12px_var(--accent-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                studioMode === 'noirfilm' ? 'bg-[var(--accent-fg)]' : 'bg-[var(--accent)]'
              }`}
            />
            NOIRFILM STUDIO
          </button>
          <button
            type="button"
            data-testid="grade-mode-luts-btn"
            onClick={() => {
              setPreviewGrade(null)
              setStudioMode('lut-library')
            }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[10px] font-semibold tracking-wider transition-all duration-150 ${
              studioMode === 'lut-library'
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_12px_var(--accent-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                studioMode === 'lut-library' ? 'bg-[var(--accent-fg)]' : 'bg-[var(--accent)]'
              }`}
            />
            LUT KÜTÜPHANESİ
          </button>
        </div>

        <span className="truncate text-[9.5px] text-[var(--text-muted)]">
          {studioMode === 'noirfilm'
            ? 'NoirFilm · Sinematik Look, Dijital Film Emülasyonu, Doku & Işık Laboratuvarı'
            : studioMode === 'lut-library'
              ? `Geniş Galeri · ${COLOR_GRADE_PRESETS.length} Renk Şablonu · ${allLuts.length} 3D LUT & .cube İçeri Aktarma`
              : 'Birincil Renk Düzeltme & WB · Canlı Skoplar · RGB & HSL Eğriler'}
        </span>
      </div>

      {studioMode === 'noirfilm' ? (
        <div className="flex h-[340px] shrink-0 overflow-hidden">
          <NoirFilmPanel
            grade={grade}
            customLuts={customLuts}
            videoEl={videoRef.current}
            compareMode={compareMode}
            wipePercent={compareWipe}
            onGrade={onGrade}
            onPreviewGrade={setPreviewGrade}
            onApplyToTimeline={onApplyGradeToTimeline}
            onImportLut={onImportLut}
            onRegisterImportedLut={onRegisterImportedLut}
            onCompareMode={setCompareMode}
            onWipePercent={setCompareWipe}
            onOpenFullscreenCompare={() => setFullscreenCompareOpen(true)}
          />
        </div>
      ) : studioMode === 'lut-library' ? (
        /* GENİŞ EKRAN LUT KÜTÜPHANESİ & ŞABLON GALERİSİ */
        <section
          data-testid="lut-library-panel"
          className="glass flex h-[340px] shrink-0 flex-col gap-2.5 overflow-hidden p-3.5"
        >
          {/* Üst Kontrol ve Filtre Barı */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Sol: Kategori Filtre Hapları */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                data-testid="grade-cat-ALL"
                onClick={() => setPresetCategory('ALL')}
                className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition ${
                  presetCategory === 'ALL'
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_8px_var(--accent-glow)]'
                    : 'bg-white/[0.05] text-white/65 hover:bg-white/[0.1] hover:text-white'
                }`}
              >
                Tümü
              </button>
              {GRADE_PRESET_CATEGORIES.map((cat) => {
                const shortLabel =
                  cat === 'Psikolojik Gerilim & Korku'
                    ? 'Gerilim & Korku'
                    : cat === 'Neo-Noir & Gece Atmosferi'
                      ? 'Neo-Noir & Gece'
                      : cat === '35mm Film Stokları'
                        ? '35mm Film'
                        : 'Stüdyo'
                return (
                  <button
                    key={cat}
                    type="button"
                    data-testid={`grade-cat-${cat}`}
                    onClick={() => setPresetCategory(cat)}
                    title={cat}
                    className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition ${
                      presetCategory === cat
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_8px_var(--accent-glow)]'
                        : 'bg-white/[0.05] text-white/65 hover:bg-white/[0.1] hover:text-white'
                    }`}
                  >
                    {shortLabel}
                  </button>
                )
              })}
              <button
                type="button"
                data-testid="grade-cat-CUSTOM"
                onClick={() => setPresetCategory('CUSTOM')}
                className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition ${
                  presetCategory === 'CUSTOM'
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_8px_var(--accent-glow)]'
                    : 'bg-white/[0.05] text-white/65 hover:bg-white/[0.1] hover:text-white'
                }`}
              >
                Özel .cube ({customLuts.length})
              </button>
            </div>

            {/* Sağ: Tür Seçimi + Arama + + .cube Yükle */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-full bg-[var(--bg-elevated,#292E36)] p-0.5">
                {(
                  [
                    ['all', 'Hepsi'],
                    ['presets', `Şablonlar (${COLOR_GRADE_PRESETS.length})`],
                    ['luts', `3D LUT (${allLuts.length})`]
                  ] as const
                ).map(([tId, tLbl]) => (
                  <button
                    key={tId}
                    type="button"
                    data-testid={`grade-tab-${tId}`}
                    onClick={() => setLutLibraryType(tId)}
                    className={`rounded-full px-2.5 py-0.5 text-[9px] font-semibold transition ${
                      lutLibraryType === tId
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {tLbl}
                  </button>
                ))}
              </div>

              <input
                type="text"
                data-testid="lut-search-input"
                value={lutSearch}
                onChange={(e) => setLutSearch(e.target.value)}
                placeholder="LUT veya şablon ara…"
                className="w-40 rounded-full border border-[color:var(--border-subtle)] bg-black/35 px-3 py-1 text-[10px] text-white placeholder:text-white/35 outline-none transition focus:border-[var(--accent)]"
              />

              <button
                type="button"
                data-testid="import-lut-btn"
                onClick={onImportLut}
                title="Bilgisayardan .cube 3D LUT içe aktar"
                className="rounded-full bg-[var(--accent)] px-3 py-1 text-[9.5px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition hover:brightness-110 active:scale-95"
              >
                + .cube Yükle
              </button>
            </div>
          </div>

          {/* 4 Yan Yana Sinematik Efekt & LUT Yoğunluğu Kaydırıcıları */}
          <div className="soft-card grid shrink-0 grid-cols-2 gap-4 px-3.5 py-2 md:grid-cols-4">
            <div className="space-y-1">
              <div className="flex justify-between text-[9.5px] text-white/65">
                <span>LUT Yoğunluğu</span>
                <span className="font-mono text-[9px] text-[var(--accent)]">
                  {Math.round(grade.lutIntensity)}%
                </span>
              </div>
              <input
                data-testid="lut-intensity-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                disabled={!grade.lutId}
                value={grade.lutIntensity}
                onChange={(e) => onGrade({ ...grade, lutIntensity: parseFloat(e.target.value) })}
                className="w-full disabled:opacity-35"
                style={{
                  background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${lutPct}%, rgba(255,255,255,0.08) ${lutPct}%, rgba(255,255,255,0.08) 100%)`
                }}
              />
            </div>

            <CompactSlider
              label="Film Grain (35mm)"
              testId="grade-film-grain-slider"
              value={grade.filmGrain ?? 0}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              unit="%"
              onChange={(filmGrain) => onGrade({ ...grade, filmGrain })}
            />

            <CompactSlider
              label="Halation (Kırmızı Hale)"
              testId="grade-halation-slider"
              value={grade.halation ?? 0}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              unit="%"
              gradient={`linear-gradient(90deg, #f97316 0%, #ef4444 ${grade.halation ?? 0}%, rgba(255,255,255,0.08) ${grade.halation ?? 0}%, rgba(255,255,255,0.08) 100%)`}
              onChange={(halation) => onGrade({ ...grade, halation })}
            />

            <CompactSlider
              label="Mist / Diffusion (Pus)"
              testId="grade-mist-slider"
              value={grade.mist ?? 0}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              unit="%"
              onChange={(mist) => onGrade({ ...grade, mist })}
            />
          </div>

          {/* Geniş Önizleme Kartları Galerisi */}
          <div
            data-testid="grade-presets-grid"
            className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto p-0.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
          >
            {/* Bypass / Ham Kartı */}
            <button
              type="button"
              onClick={() => {
                setActivePresetId(null)
                onGrade({ ...grade, lutId: null })
              }}
              className={`group flex flex-col overflow-hidden rounded-[14px] border text-left transition duration-150 ${
                grade.lutId === null && activePresetId === null
                  ? 'border-[var(--accent)] bg-[var(--bg-elevated,#292E36)] shadow-[0_0_14px_var(--accent-glow)]'
                  : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 hover:border-white/25 hover:bg-[var(--bg-elevated,#292E36)]'
              }`}
            >
              <div className="flex h-10 items-center justify-center bg-black/50 font-mono text-[9px] tracking-widest text-white/50">
                BYPASS · HAM
              </div>
              <div className="px-2.5 py-2">
                <div className="truncate text-[10.5px] font-semibold text-white/95">Orijinal</div>
                <div className="mt-0.5 truncate text-[8.5px] text-white/45">
                  3D LUT devre dışı
                </div>
              </div>
            </button>

            {/* Hazır Renk Şablonları */}
            {lutLibraryType !== 'luts' &&
              presetCategory !== 'CUSTOM' &&
              COLOR_GRADE_PRESETS.filter((p) => {
                const catOk = presetCategory === 'ALL' || p.category === presetCategory
                const q = lutSearch.trim().toLowerCase()
                const searchOk =
                  !q ||
                  p.name.toLowerCase().includes(q) ||
                  p.desc.toLowerCase().includes(q) ||
                  p.category.toLowerCase().includes(q)
                return catOk && searchOk
              }).map((preset) => {
                const isActive = activePresetId === preset.id
                const grad = `linear-gradient(115deg, ${preset.swatches[0]} 0%, ${preset.swatches[1]} 52%, ${preset.swatches[2]} 100%)`
                return (
                  <button
                    key={`preset-${preset.id}`}
                    type="button"
                    data-testid={`grade-preset-${preset.id}`}
                    onClick={() => {
                      setActivePresetId(preset.id)
                      onGrade(applyGradePreset(preset, grade.cameraProfile))
                    }}
                    title={`${preset.category} · ${preset.desc}`}
                    className={`group flex flex-col overflow-hidden rounded-[14px] border text-left transition duration-150 ${
                      isActive
                        ? 'border-[var(--accent)] bg-[var(--bg-elevated,#292E36)] shadow-[0_0_14px_var(--accent-glow)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 hover:border-white/25 hover:bg-[var(--bg-elevated,#292E36)]'
                    }`}
                  >
                    <div
                      className="relative h-10 w-full transition-transform duration-200 group-hover:scale-[1.03]"
                      style={{ background: grad }}
                    >
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/75 px-1.5 py-px font-mono text-[7px] font-bold text-[var(--accent)]">
                        ŞABLON
                      </span>
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-px font-mono text-[7px] text-white/85">
                        {preset.tag}
                      </span>
                    </div>
                    <div className="px-2.5 py-2">
                      <div className="truncate text-[10.5px] font-semibold text-white/95">
                        {preset.name}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[8px] text-white/45">
                        {preset.desc}
                      </div>
                    </div>
                  </button>
                )
              })}

            {/* Dahili ve Özel .cube 3D LUT'lar */}
            {lutLibraryType !== 'presets' &&
              allLuts
                .filter((l) => {
                  const catOk =
                    presetCategory === 'CUSTOM'
                      ? !l.isBuiltIn
                      : presetCategory === 'ALL' || l.category === presetCategory
                  const q = lutSearch.trim().toLowerCase()
                  const searchOk =
                    !q ||
                    l.name.toLowerCase().includes(q) ||
                    (l.desc ?? '').toLowerCase().includes(q) ||
                    (l.category ?? '').toLowerCase().includes(q)
                  return catOk && searchOk
                })
                .map((l) => {
                  const [cA, cB] = l.previewColors ?? ['#2c303a', '#f5a623']
                  const isSelected = grade.lutId === l.id
                  return (
                    <button
                      key={`lut-${l.id}`}
                      type="button"
                      data-testid={`lut-card-${l.id}`}
                      onClick={() => {
                        setActivePresetId(null)
                        onGrade({ ...grade, lutId: l.id })
                      }}
                      title={l.desc ? `${l.name} — ${l.desc}` : l.name}
                      className={`group relative flex flex-col overflow-hidden rounded-[14px] border text-left transition duration-150 ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--bg-elevated,#292E36)] shadow-[0_0_14px_var(--accent-glow)]'
                          : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 hover:border-white/25 hover:bg-[var(--bg-elevated,#292E36)]'
                      }`}
                    >
                      <div
                        className="relative h-10 w-full transition-transform duration-200 group-hover:scale-[1.03]"
                        style={{
                          background:
                            l.previewGradient ?? `linear-gradient(115deg, ${cA} 0%, ${cB} 100%)`
                        }}
                      >
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/75 px-1.5 py-px font-mono text-[7px] font-bold text-white/90">
                          {!l.isBuiltIn ? '.CUBE' : '3D LUT'}
                        </span>
                        {l.category && l.isBuiltIn && (
                          <span className="absolute right-1.5 top-1.5 max-w-[58%] truncate rounded-full bg-black/70 px-1.5 py-px font-mono text-[6.5px] text-white/80">
                            {l.category}
                          </span>
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <div className="truncate text-[10.5px] font-semibold text-white/95">
                          {l.name}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-[8px] text-white/45">
                          {l.desc || (!l.isBuiltIn ? 'Özel 3D LUT (.cube)' : '3D Sinematik LUT')}
                        </div>
                      </div>
                    </button>
                  )
                })}
          </div>
        </section>
      ) : (
        /* 2. COLOR DECK & SCOPES — 3 Geniş & Ferah Bloklu Düzen (4 + 4 + 4 Sütun) */
        <div
          data-testid="color-deck"
          className="glass grid h-[278px] shrink-0 grid-cols-12 gap-3 overflow-hidden p-3"
        >
        {/* 1. BLOK (SOL): Temel Ayarlar & WB */}
        <section className="soft-card col-span-4 flex flex-col justify-between overflow-y-auto p-3.5">
          {/* Kamera Profili (Input LUT / CST: Log → Rec.709) */}
          <div className="mb-2 flex items-center justify-between gap-2 rounded-full bg-white/[0.04] py-1 pl-3 pr-1.5">
            <span className="text-[9px] font-semibold tracking-wider text-white/55">KAMERA PROFİLİ</span>
            <select
              data-testid="camera-profile-select"
              value={grade.cameraProfile ?? 'rec709'}
              onChange={(e) =>
                onGrade({ ...grade, cameraProfile: e.target.value as CameraProfileId })
              }
              title="Düz (flat/log) çekimi tek tıkla Rec.709'a dönüştürür"
              className="max-w-[140px] cursor-pointer rounded-full bg-white/[0.08] px-2 py-0.5 text-[9.5px] text-white outline-none transition-all duration-200 hover:bg-white/[0.14]"
            >
              {CAMERA_PROFILES.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#18181b] text-white">
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] " />
              <span className="panel-title !text-[#E4E4E7]/90">Temel Ayarlar & WB</span>
            </div>
            <button
              type="button"
              data-testid="wb-reset-btn"
              disabled={!wbDirty}
              onClick={() => onGrade({ ...grade, temperature: 0, tint: 0 })}
              className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[8.5px] font-medium text-white/75 transition-all duration-200 hover:bg-white/[0.12] hover:text-white disabled:opacity-25"
            >
              WB Sıfırla
            </button>
          </div>

          {/* Auto WB + Eyedropper yumuşak hap (pill) butonları */}
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="auto-wb-btn"
              onClick={onAutoWhiteBalance}
              title="Aktif kareyi analiz ederek Sıcaklık ve Ton değerlerini otomatik kalibre et"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-[9.5px] font-semibold text-[#E4E4E7] transition-all duration-200 hover:bg-white/[0.12] hover:text-white  active:scale-95"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3 fill-current text-[var(--accent)]"
                aria-hidden="true"
              >
                <path d="M7.5 1.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1 1.1-2.9zm5 7l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6zm-9 1l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3z" />
              </svg>
              <span>Auto WB</span>
            </button>

            <button
              type="button"
              data-testid="wb-picker-btn"
              onClick={onToggleWbPicker}
              title="Damlalık Seçici: Monitörde beyaz veya nötr gri bir noktaya tıklayın"
              className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[9.5px] font-semibold transition-all duration-200 active:scale-95 ${
                wbPickerActive
                  ? 'bg-[var(--accent)]/25 text-white ring-1 ring-[var(--accent)]/60 '
                  : 'bg-white/[0.06] text-[#E4E4E7]/85 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              <span>{wbPickerActive ? 'Seçiliyor…' : 'Damlalık'}</span>
            </button>
          </div>

          {/* 2 sütunlu pürüzsüz kaydırıcı ızgarası */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <CompactSlider
              label="Sıcaklık (Temp)"
              testId="wb-temperature-slider"
              value={grade.temperature}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              gradient="linear-gradient(90deg, rgba(56,189,248,0.65) 0%, rgba(255,255,255,0.12) 50%, rgba(245,158,11,0.75) 100%)"
              onChange={(temperature) => onGrade({ ...grade, temperature })}
            />
            <CompactSlider
              label="Ton (Tint)"
              testId="wb-tint-slider"
              value={grade.tint}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              gradient="linear-gradient(90deg, rgba(34,197,94,0.65) 0%, rgba(255,255,255,0.12) 50%, rgba(236,72,153,0.75) 100%)"
              onChange={(tint) => onGrade({ ...grade, tint })}
            />
            <CompactSlider
              label="Pozlama (EV)"
              value={grade.exposure}
              min={-2}
              max={2}
              step={0.05}
              defaultValue={0}
              unit=" EV"
              onChange={(exposure) => onGrade({ ...grade, exposure })}
            />
            <CompactSlider
              label="Kontrast"
              value={grade.contrast}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(contrast) => onGrade({ ...grade, contrast })}
            />
            <CompactSlider
              label="Parlak (High)"
              testId="grade-highlights-slider"
              value={grade.highlights ?? 0}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(highlights) => onGrade({ ...grade, highlights })}
            />
            <CompactSlider
              label="Gölgeler (Shad)"
              testId="grade-shadows-slider"
              value={grade.shadows ?? 0}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(shadows) => onGrade({ ...grade, shadows })}
            />
            <CompactSlider
              label="Vibrance (Canlılık)"
              testId="grade-vibrance-slider"
              value={grade.vibrance ?? 0}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(vibrance) => onGrade({ ...grade, vibrance })}
            />
            <CompactSlider
              label="Doygunluk (Sat)"
              value={grade.saturation}
              min={0}
              max={200}
              step={1}
              defaultValue={100}
              unit="%"
              onChange={(saturation) => onGrade({ ...grade, saturation })}
            />
          </div>

          <div className="mt-1">
            <CompactSlider
              label="Optik Vignette (Köşe Karartma)"
              testId="grade-vignette-slider"
              value={grade.vignette ?? 0}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              unit="%"
              onChange={(vignette) => onGrade({ ...grade, vignette })}
            />
          </div>
        </section>

        {/* 2. BLOK (ORTA): Canlı Renk Skopları (RGB Parade / Waveform / Vectorscope / Histogram) */}
        <VideoScopes
          videoRef={videoRef}
          media={media}
          grade={grade}
          activeLut={activeLut}
          playing={playing}
          time={time}
          className="soft-card col-span-4 flex h-full flex-col justify-between overflow-hidden p-3.5"
        />

        {/* 3. BLOK (SAĞ): Etkileşimli Eğriler (Custom RGB & Luma Curves + Hue vs Sat + Hue vs Hue) */}
        <section className="soft-card col-span-4 flex h-full flex-col justify-between overflow-hidden p-3.5">
          <ColorCurvesEditor grade={grade} onGrade={onGrade} />
        </section>
      </div>
      )}

      {/* 3. ALT KLİP ŞERİDİ (FILMSTRIP) — Çoklu Timeline Yerine Sadece Video Klipleri */}
      <div
        data-testid="grade-filmstrip"
        className="glass flex h-[86px] shrink-0 items-center gap-3 overflow-hidden px-3.5 py-2"
      >
        <div className="flex shrink-0 flex-col justify-between pr-3">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            <span className="panel-title">Klip Şeridi (Filmstrip)</span>
          </div>
          <span className="font-mono text-[9px] text-[var(--text-muted)]">
            {v1Clips.length} Sahne Klibi
          </span>
          <button
            type="button"
            onClick={onImportMedia}
            className="mt-1 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[9px] font-medium text-white/80 transition-all duration-200 hover:bg-white/[0.12] hover:text-white active:scale-95"
          >
            + Medya Ekle
          </button>
        </div>

        <div className="flex flex-1 items-center gap-2.5 overflow-x-auto py-0.5">
          {v1Clips.length === 0 ? (
            <div className="flex items-center gap-3 text-xs text-white/45">
              <span>Henüz sahnede video klibi yok.</span>
              {mediaItems.length === 0 && (
                <button type="button" onClick={onImportMedia} className="chip">
                  + Video İçe Aktar
                </button>
              )}
            </div>
          ) : (
            v1Clips.map((clip, idx) => {
              const m = mediaMap.get(clip.mediaId)
              const isSelected =
                (selectedClipId && clip.id === selectedClipId) ||
                (!selectedClipId && activeClip?.id === clip.id)
              const graded = clip.grade ? !isNeutralGrade(clip.grade) : false

              return (
                <button
                  key={clip.id}
                  type="button"
                  data-testid={`filmstrip-clip-${idx}`}
                  onClick={() => onSelectClip(clip.id, clip.start + 0.01)}
                  className={`case-file-card group relative flex h-[66px] w-[148px] shrink-0 overflow-hidden rounded-[13px] text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-white/[0.08] ring-1 ring-[var(--accent)]/60 shadow-lg '
                      : 'bg-black/40 hover:bg-white/[0.05]'
                  }`}
                >
                  {m?.thumbnail ? (
                    <img
                      src={m.thumbnail}
                      alt={clip.name}
                      draggable={false}
                      className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-white/10 to-black" />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />

                  <span className="absolute left-1.5 top-1 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[8px] font-bold tracking-wider text-white/90">
                    #{String(idx + 1).padStart(2, '0')} • {Math.round(m?.fps || 24)}FPS
                  </span>

                  {graded && (
                    <span
                      title="Renk düzenlemesi aktif"
                      className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/80 px-1.5 py-0.5 font-mono text-[8px] text-[var(--accent)] ring-1 ring-[var(--accent)]/50"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                      GRADE
                    </span>
                  )}

                  <div className="absolute inset-x-2 bottom-1 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] font-medium text-white/90">
                      {clip.name}
                    </span>
                    <span className="shrink-0 font-mono text-[8px] text-white/60">
                      {fmtDuration(clip.duration)}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Sağ: Yakalanan Referans Kareler (Grab Stills Gallery) & Kopyala/Yapıştır */}
        <div
          data-testid="stills-gallery"
          className="flex h-full shrink-0 items-center gap-2.5 border-l border-white/[0.06] pl-3"
        >
          <div className="flex flex-col justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]"></span>
              <span className="panel-title">Referans Kareler</span>
            </div>
            <div className="flex items-center gap-1 pt-1">
              {onGrabStill && (
                <button
                  type="button"
                  data-testid="grade-grab-still-btn"
                  onClick={onGrabStill}
                  className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[9px] font-medium text-white transition hover:bg-white/[0.15] active:scale-95"
                >
                  + Kare Yakala
                </button>
              )}
              {onCopyGrade && (
                <button
                  type="button"
                  onClick={onCopyGrade}
                  title="Rengi Kopyala"
                  className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] text-white/75 transition hover:bg-white/[0.12] hover:text-white"
                >
                  Kopyala
                </button>
              )}
              {onPasteGrade && (
                <button
                  type="button"
                  onClick={onPasteGrade}
                  disabled={!hasCopiedGrade}
                  title="Kopyalanan Rengi Yapıştır"
                  className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-[9px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/30 disabled:opacity-25"
                >
                  Yapıştır
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            {stills.length === 0 ? (
              <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-[9.5px] text-white/40">
                Henüz yakalanmış referans kare yok
              </div>
            ) : (
              stills.map((st, sIdx) => (
                <div
                  key={st.id}
                  data-testid={`still-card-${sIdx}`}
                  onClick={() => onApplyStill?.(st)}
                  title={`${st.name} (${st.timecode}) — Tıkla: Bu karenin renk ayarlarını aktif klibe uygula`}
                  className="group relative h-[64px] w-[112px] shrink-0 cursor-pointer overflow-hidden rounded-[13px] bg-black/50 ring-1 ring-[color:var(--border-subtle)] transition hover:ring-[var(--accent)]"
                >
                  <img
                    src={st.thumbnailDataUrl}
                    alt={st.name}
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/35" />
                  <span className="absolute left-1.5 top-1 rounded-full bg-black/75 px-1.5 py-0.5 font-mono text-[7.5px] text-[var(--accent)]">
                    STILL #{sIdx + 1}
                  </span>
                  {onDeleteStill && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteStill(st.id)
                      }}
                      title="Referans Kareyi Sil"
                      className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[9px] text-white/60 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/80 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                  <div className="absolute inset-x-1.5 bottom-1 flex items-center justify-between">
                    <span className="truncate text-[8.5px] font-medium text-white/90">
                      {st.timecode}
                    </span>
                    <span className="rounded bg-[var(--accent)]/25 px-1 py-0.2 font-mono text-[7px] text-[var(--accent)]">
                      Rengi Uygula
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <LookComparisonFullscreenModal
        open={fullscreenCompareOpen}
        videoEl={videoRef.current}
        grade={displayGrade}
        activeLut={effectiveLut}
        mode={compareMode === 'none' ? 'v-wipe' : compareMode}
        wipePercent={compareWipe}
        playing={playing}
        onMode={setCompareMode}
        onWipe={setCompareWipe}
        onTogglePlay={onToggle}
        onClose={() => setFullscreenCompareOpen(false)}
      />
    </div>
  )
}
