import { useEffect, useRef } from 'react'
import type { ColorGrade } from '../../../../shared/color'
import type { Lut3D } from '../../../../shared/lut'
import { WebGLColorEngine } from '../../lib/webgl-grade'

export type ComparisonMode = 'none' | 'v-wipe' | 'h-wipe' | 'side-by-side' | 'original'

const MODES: Array<{ id: ComparisonMode; label: string }> = [
  { id: 'none', label: 'Graded' },
  { id: 'original', label: 'Original' },
  { id: 'v-wipe', label: 'Dikey Bölme' },
  { id: 'h-wipe', label: 'Yatay Bölme' },
  { id: 'side-by-side', label: 'Yan Yana' }
]

export function LookComparisonBar({
  mode,
  wipePercent,
  onMode,
  onWipe,
  onOpenFullscreen
}: {
  mode: ComparisonMode
  wipePercent: number
  onMode: (m: ComparisonMode) => void
  onWipe: (n: number) => void
  onOpenFullscreen: () => void
}) {
  return (
    <div
      data-testid="noirfilm-comparison-bar"
      className="flex flex-wrap items-center justify-between gap-2 rounded-full bg-[#1B1E24] px-2.5 py-1"
    >
      <div className="flex items-center gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`compare-mode-${m.id}`}
            onClick={() => onMode(m.id)}
            className={`rounded-full px-2.5 py-0.5 text-[9.5px] font-medium transition-all ${
              mode === m.id
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] font-semibold'
                : 'text-[#9298A3] hover:bg-[#242830] hover:text-[#F1F2EE]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {(mode === 'v-wipe' || mode === 'h-wipe') && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[#9298A3]">Bölme</span>
            <input
              type="range"
              min={5}
              max={95}
              value={wipePercent}
              onChange={(e) => onWipe(Number(e.target.value))}
              className="w-20"
            />
          </div>
        )}
        <button
          type="button"
          data-testid="compare-fullscreen-btn"
          onClick={onOpenFullscreen}
          className="rounded-full bg-[#242830] px-2.5 py-0.5 text-[9.5px] font-medium text-[#F1F2EE] transition-colors hover:bg-[#292E36] hover:text-[var(--accent)]"
        >
          Tam Ekran Karşılaştır
        </button>
      </div>
    </div>
  )
}

export function LookComparisonFullscreenModal({
  open,
  videoEl,
  grade,
  activeLut,
  mode,
  wipePercent,
  playing,
  onMode,
  onWipe,
  onTogglePlay,
  onClose
}: {
  open: boolean
  videoEl: HTMLVideoElement | null
  grade: ColorGrade
  activeLut: Lut3D | null
  mode: ComparisonMode
  wipePercent: number
  playing: boolean
  onMode: (m: ComparisonMode) => void
  onWipe: (n: number) => void
  onTogglePlay: () => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<WebGLColorEngine | null>(null)

  useEffect(() => {
    if (!open || !canvasRef.current || !videoEl) return
    let engine: WebGLColorEngine | null = null
    try {
      engine = new WebGLColorEngine(canvasRef.current)
      engineRef.current = engine
    } catch {
      return
    }
    let raf = 0
    const tick = () => {
      if (engineRef.current && videoEl) {
        engineRef.current.render(
          videoEl,
          grade,
          activeLut,
          false,
          wipePercent,
          false,
          mode,
          playing
        )
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      engine?.dispose()
      engineRef.current = null
    }
  }, [open, videoEl, grade, activeLut, mode, wipePercent, playing])

  if (!open) return null

  return (
    <div
      data-testid="noirfilm-fullscreen-compare-modal"
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-[#101114]/95 p-5 backdrop-blur-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
          <span className="text-[12px] font-semibold tracking-wider text-[#F1F2EE] uppercase">
            NoirFilm · Tam Ekran Görünüm Karşılaştırma
          </span>
        </div>

        <LookComparisonBar
          mode={mode === 'none' ? 'v-wipe' : mode}
          wipePercent={wipePercent}
          onMode={onMode}
          onWipe={onWipe}
          onOpenFullscreen={() => {}}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="rounded-full bg-[#242830] px-3.5 py-1 text-[10.5px] font-semibold text-[#F1F2EE] hover:bg-[#292E36]"
          >
            {playing ? 'Duraklat' : 'Oynat'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[var(--accent)] px-3.5 py-1 text-[10.5px] font-semibold text-[var(--accent-fg)]"
          >
            Kapat
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[20px] border border-[#343943] bg-black">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full object-contain"
        />
        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-[#101114]/80 px-3 py-1 text-[10px] font-medium text-[#9298A3]">
          ORİJİNAL
        </div>
        <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-[var(--accent)]/90 px-3 py-1 text-[10px] font-semibold text-[var(--accent-fg)]">
          NOIRFILM GRADED
        </div>
      </div>
    </div>
  )
}
