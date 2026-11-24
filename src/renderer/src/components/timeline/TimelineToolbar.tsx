import type React from 'react'
import type { CaseMarker, LaneId, TimelineClip } from '../../../../shared/timeline'
import { fmt } from '../../lib/format'
import { Kbd, MAX_ZOOM, SHORTCUT_GUIDE, shuttleLabel } from './TimelineConstants'

export type EditTool = 'select' | 'razor' | 'slip' | 'roll'

export interface TimelineToolbarProps {
  playing: boolean
  canPlay: boolean
  shuttleRate: number
  onPlay: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo: boolean
  canRedo: boolean
  editTool: EditTool
  setEditTool: (t: EditTool) => void
  onCut: () => void
  rippleMode: boolean
  onRippleDelete?: () => void
  onDeleteSelected: () => void
  selectedSetSize: number
  onToggleRippleMode?: () => void
  onCloseGaps?: (lane?: LaneId) => void
  selectedClip: TimelineClip | null | undefined
  clipsCount: number
  onDetachSelected: () => void
  canDetach: boolean
  onMarkIn?: () => void
  onMarkOut?: () => void
  inPoint: number | null
  outPoint: number | null
  onClearInOut?: () => void
  onAddMarkerAtPlayhead?: () => void
  markersCount: number
  onStepMarker?: (dir: -1 | 1) => void
  activeMarker: CaseMarker | null | undefined
  timecodeRef: React.RefObject<HTMLSpanElement | null>
  time: number
  timeRef?: React.MutableRefObject<number>
  fps: number
  snap: boolean
  setSnap: React.Dispatch<React.SetStateAction<boolean>>
  zoom: number
  setZoom: (z: number) => void
  showGuide: boolean
  setShowGuide: React.Dispatch<React.SetStateAction<boolean>>
}

export function TimelineToolbar({
  playing,
  canPlay,
  shuttleRate,
  onPlay,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  editTool,
  setEditTool,
  onCut,
  rippleMode,
  onRippleDelete,
  onDeleteSelected,
  selectedSetSize,
  onToggleRippleMode,
  onCloseGaps,
  selectedClip,
  clipsCount,
  onDetachSelected,
  canDetach,
  onMarkIn,
  onMarkOut,
  inPoint,
  outPoint,
  onClearInOut,
  onAddMarkerAtPlayhead,
  markersCount,
  onStepMarker,
  activeMarker,
  timecodeRef,
  time,
  timeRef,
  fps,
  snap,
  setSnap,
  zoom,
  setZoom,
  showGuide,
  setShowGuide
}: TimelineToolbarProps) {
  return (
    <div className="flex items-center gap-1.5 border-b border-[color:var(--border-subtle)] px-3 py-1.5">
      <button
        data-testid="timeline-play-btn"
        onClick={onPlay}
        disabled={!canPlay}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-95 disabled:opacity-30"
        title="Oynat / Durdur (Boşluk) · J/K/L Shuttle"
      >
        {playing ? '❚❚' : '▶'}
      </button>

      {/* J / K / L Canlı Mekik Hız Göstergesi */}
      <div
        data-testid="shuttle-indicator"
        className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px]"
        title="J geri · K durdur · L ileri"
      >
        <span className={shuttleRate < 0 && playing ? 'text-[var(--accent)]' : 'text-white/30'}>J</span>
        <span className={!playing ? 'text-[var(--accent)]' : 'text-white/30'}>K</span>
        <span className={shuttleRate > 0 && playing ? 'text-[var(--accent)]' : 'text-white/30'}>L</span>
        <span
          className="min-w-[44px] text-center font-semibold tracking-wide text-[var(--accent)] transition-all duration-200"
          style={{
            opacity: shuttleLabel(shuttleRate, playing) ? 1 : 0.4
          }}
        >
          {shuttleLabel(shuttleRate, playing) ?? '❚❚'}
        </span>
      </div>

      {/* Geri Al (Undo) & Yinele (Redo) */}
      {(onUndo || onRedo) && (
        <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
          <button
            type="button"
            data-testid="undo-btn"
            onClick={onUndo}
            disabled={!canUndo}
            title="Geri Al (Ctrl+Z)"
            className="rounded-full px-2 py-0.5 font-mono text-[10px] text-white/75 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
          >
            <span className="flex items-center gap-1.5">
              ↶ Geri Al <Kbd>Ctrl+Z</Kbd>
            </span>
          </button>
          <button
            type="button"
            data-testid="redo-btn"
            onClick={onRedo}
            disabled={!canRedo}
            title="Yinele (Ctrl+Shift+Z)"
            className="rounded-full px-2 py-0.5 font-mono text-[10px] text-white/75 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
          >
            <span className="flex items-center gap-1.5">
              ↷ Yinele <Kbd>Ctrl+⇧+Z</Kbd>
            </span>
          </button>
        </div>
      )}

      {/* Profesyonel Kurgu Araçları Seçici: Select (V) · Razor (B) · Slip (Y) · Roll (N) */}
      <div
        data-testid="editing-tools-selector"
        className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5"
      >
        {(
          [
            ['select', 'Seç (V)', 'Seçim ve Taşıma Aracı (V)'],
            ['razor', 'Jilet (B)', 'Razor / Blade Kesim Aracı — Klibe tıklayarak böl (B)'],
            ['slip', 'Slip (Y)', 'Slip Aracı — Klip konumunu değiştirmeden kaynak In/Out kaydır (Y)'],
            ['roll', 'Roll (N)', 'Roll Edit — Bitişik iki klibin kesişim sınırını kaydır (N)']
          ] as const
        ).map(([toolId, lbl, ttl]) => (
          <button
            key={toolId}
            type="button"
            data-testid={`tool-${toolId}-btn`}
            onClick={() => setEditTool(toolId)}
            title={ttl}
            className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold transition ${
              editTool === toolId
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_8px_var(--accent-glow)]'
                : 'text-white/65 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <button
        data-testid="cut-btn"
        onClick={onCut}
        disabled={!canPlay}
        className="chip disabled:opacity-30"
        title="Playhead konumundan böl (C)"
      >
        <span className="flex items-center gap-1.5">
          Kes <Kbd>C</Kbd>
        </span>
      </button>
      <button
        data-testid="delete-btn"
        onClick={rippleMode && onRippleDelete ? onRippleDelete : onDeleteSelected}
        disabled={selectedSetSize === 0}
        className="chip disabled:opacity-30"
        title={
          rippleMode
            ? 'Ripple Sil — Sonraki klipleri geri kaydır (Del)'
            : selectedSetSize > 1
              ? `Seçili ${selectedSetSize} klibi sil (Del)`
              : 'Seçili klibi sil (Del)'
        }
      >
        <span className="flex items-center gap-1.5">
          {rippleMode
            ? 'Ripple Sil'
            : selectedSetSize > 1
              ? `Sil (${selectedSetSize})`
              : 'Sil'}{' '}
          <Kbd>Del</Kbd>
        </span>
      </button>
      {onToggleRippleMode && (
        <button
          type="button"
          data-testid="ripple-mode-btn"
          onClick={onToggleRippleMode}
          title="Ripple Modu: Silme işleminde sonraki klipleri otomatik geri kaydır (Shift+Del)"
          className={`chip ${
            rippleMode
              ? '!border-[var(--accent)] !bg-[var(--accent)]/18 !text-[var(--accent)]'
              : 'text-white/60'
          }`}
        >
          Ripple
        </button>
      )}
      {onCloseGaps && (
        <button
          type="button"
          data-testid="close-gaps-btn"
          onClick={() => onCloseGaps(selectedClip?.lane)}
          disabled={clipsCount === 0}
          title="Zaman çizelgesindeki boşlukları kapat (Close Gaps)"
          className="chip disabled:opacity-30"
        >
          Boşluk Kapat
        </button>
      )}
      <button
        data-testid="timeline-detach-btn"
        onClick={onDetachSelected}
        disabled={!canDetach}
        className="chip disabled:opacity-30"
        title="Seçili videonun sesini A1 kanalına bağımsız klip olarak ayır"
      >
        Sesi Ayır
      </button>

      {/* NLE Giriş (I) ve Çıkış (O) Noktası Kontrolleri */}
      {(onMarkIn || onMarkOut) && (
        <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
          <button
            type="button"
            data-testid="mark-in-btn"
            onClick={onMarkIn}
            disabled={!canPlay}
            title="Giriş (In) Noktası İşaretle (I)"
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              inPoint !== null
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-white/60 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            <span className="flex items-center gap-1">
              <Kbd>I</Kbd>
              {inPoint !== null ? `${inPoint.toFixed(1)}s` : 'Giriş'}
            </span>
          </button>
          <button
            type="button"
            data-testid="mark-out-btn"
            onClick={onMarkOut}
            disabled={!canPlay}
            title="Çıkış (Out) Noktası İşaretle (O)"
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              outPoint !== null
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-white/60 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            <span className="flex items-center gap-1">
              {outPoint !== null ? `${outPoint.toFixed(1)}s` : 'Çıkış'}
              <Kbd>O</Kbd>
            </span>
          </button>
          {(inPoint !== null || outPoint !== null) && onClearInOut && (
            <button
              type="button"
              data-testid="clear-inout-btn"
              onClick={onClearInOut}
              title="In / Out İşaretlerini Temizle"
              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/45 hover:bg-white/[0.1] hover:text-white"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Sahne İşaretçileri ve Yönetmen Notları (Case Markers - M) */}
      {onAddMarkerAtPlayhead && (
        <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
          {markersCount > 0 && onStepMarker && (
            <button
              type="button"
              data-testid="prev-marker-btn"
              onClick={() => onStepMarker(-1)}
              title="Önceki Sahne İşaretçisine Git (Sol Ok)"
              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/60 transition hover:bg-white/[0.1] hover:text-white"
            >
              ◀
            </button>
          )}
          <button
            type="button"
            data-testid="add-marker-btn"
            onClick={onAddMarkerAtPlayhead}
            disabled={!canPlay}
            title="Playhead Konumuna Sahne İşaretçisi ve Yönetmen Notu Ekle (M)"
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              activeMarker
                ? 'bg-amber-500/20 text-amber-300 '
                : 'text-white/75 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            <span className="text-amber-400">◆</span>
            <span>İşaretçi Ekle</span>
            <Kbd>M</Kbd>
            {markersCount > 0 && (
              <span className="rounded-full bg-white/10 px-1.5 text-[8px] text-amber-300">
                {markersCount}
              </span>
            )}
          </button>
          {markersCount > 0 && onStepMarker && (
            <button
              type="button"
              data-testid="next-marker-btn"
              onClick={() => onStepMarker(1)}
              title="Sonraki Sahne İşaretçisine Git (Sağ Ok)"
              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/60 transition hover:bg-white/[0.1] hover:text-white"
            >
              ▶
            </button>
          )}
        </div>
      )}

      <span
        ref={timecodeRef}
        className="ml-1 rounded border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] tracking-wider text-white/90"
        data-testid="timeline-timecode"
      >
        {fmt(timeRef ? timeRef.current : time, fps)}
      </span>
      {selectedSetSize > 1 ? (
        <span
          data-testid="timeline-selection-badge"
          className="truncate rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]"
        >
          Seçili: {selectedSetSize} klip
        </span>
      ) : (
        selectedClip && (
          <span
            data-testid="timeline-selection-badge"
            className="truncate rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/60"
          >
            Seçili: {selectedClip.lane} · {selectedClip.name}
          </span>
        )
      )}
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          data-testid="snap-btn"
          onClick={() => setSnap((v) => !v)}
          className={`chip ${snap ? '!border-[#71717A] !bg-[#71717A]/20 !text-white' : 'text-[#71717A]'}`}
          title="Mıknatıs / Kenar Hizalama (Snap)"
        >
          Mıknatıs
        </button>
        <label
          className="flex items-center gap-1.5 font-mono text-[10px] text-[#71717A]"
          title="Zaman Çizelgesi Yakınlaştırma"
        >
          <span>Zoom</span>
          <input
            type="range"
            min={0.5}
            max={MAX_ZOOM}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={
              {
                '--pct': `${Math.max(0, Math.min(100, ((zoom - 0.5) / Math.max(0.01, MAX_ZOOM - 0.5)) * 100))}%`
              } as React.CSSProperties
            }
            className="w-24 cursor-pointer"
          />
          <span className="w-8 text-right">{zoom.toFixed(1)}x</span>
        </label>
        <div className="relative">
          <button
            type="button"
            data-testid="shortcut-guide-btn"
            onClick={() => setShowGuide((v) => !v)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] transition-all duration-200 ${
              showGuide
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
            }`}
            title="Klavye Kısayolları"
          >
            <span className="font-bold">?</span> Kısayollar
          </button>
          {showGuide && (
            <div
              data-testid="shortcut-guide"
              className="absolute bottom-full right-0 z-50 mb-2 w-[300px] rounded-lg bg-black/60 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] "
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-widest text-[var(--accent)]">
                  NOIRCUT KISAYOLLARI
                </span>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="rounded-full px-1.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
                >
                  ×
                </button>
              </div>
              {SHORTCUT_GUIDE.map((g) => (
                <div key={g.group} className="mb-2 last:mb-0">
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-white/35">{g.group}</div>
                  {g.items.map(([k, d]) => (
                    <div key={k} className="flex items-center justify-between py-0.5 text-[10px] text-white/75">
                      <span>{d}</span>
                      <Kbd>{k}</Kbd>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="panel-title">Timeline</span>
      </div>
    </div>
  )
}
