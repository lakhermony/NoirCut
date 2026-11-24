import type React from 'react'
import type { MediaItem } from '../../../../shared/types'
import { fmt } from '../../lib/format'

export interface MonitorTransportBarProps {
  media: MediaItem | null
  playing: boolean
  shuttleRate: number
  time: number
  timeRef?: React.MutableRefObject<number>
  duration: number
  progress: number
  progressFillRef: React.RefObject<HTMLDivElement | null>
  progressThumbRef: React.RefObject<HTMLDivElement | null>
  bottomTimecodeCurrentRef: React.RefObject<HTMLSpanElement | null>
  hasCopiedGrade: boolean
  onToggle: () => void
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onScrubPointer: (e: React.PointerEvent) => void
  onShuttleReverse?: () => void
  onShuttlePause?: () => void
  onShuttleForward?: () => void
  onGrabStill?: () => void
  onCopyGrade?: () => void
  onPasteGrade?: () => void
}

export function MonitorTransportBar({
  media,
  playing,
  shuttleRate,
  time,
  timeRef,
  duration,
  progress,
  progressFillRef,
  progressThumbRef,
  bottomTimecodeCurrentRef,
  hasCopiedGrade,
  onToggle,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onScrubPointer,
  onShuttleReverse,
  onShuttlePause,
  onShuttleForward,
  onGrabStill,
  onCopyGrade,
  onPasteGrade
}: MonitorTransportBarProps) {
  return (
    <div className="flex items-center gap-2 border-t border-[color:var(--border-subtle)] bg-[var(--bg-app)]/70 px-4 py-2.5">
      {onShuttleReverse && onShuttlePause && onShuttleForward ? (
        <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-0.5">
          <button
            type="button"
            data-testid="shuttle-j-btn"
            onClick={onShuttleReverse}
            disabled={!media}
            title="Geri Sarma 1x / 2x (J)"
            className={`flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              playing && shuttleRate < 0
                ? 'bg-amber-400/20 text-amber-300 '
                : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <span>◀◀</span>
            <span>{playing && shuttleRate < 0 ? `${Math.abs(shuttleRate)}x` : 'J'}</span>
          </button>
          <button
            type="button"
            data-testid="shuttle-k-btn"
            onClick={onShuttlePause}
            disabled={!media}
            title="Durdur / Pause (K)"
            className={`flex h-6 items-center rounded-full px-2 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              !playing
                ? 'bg-white/[0.12] text-white'
                : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            K
          </button>
          <button
            type="button"
            data-testid="shuttle-l-btn"
            onClick={onShuttleForward}
            disabled={!media}
            title="İleri Oynatma 1x / 2x / 4x (L)"
            className={`flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
              playing && shuttleRate > 0
                ? 'bg-[var(--accent)]/20 text-[var(--accent)] '
                : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <span>{playing && shuttleRate > 0 ? `${shuttleRate}x` : 'L'}</span>
            <span>▶▶</span>
          </button>
        </div>
      ) : (
        <button
          onClick={() => onSeek(Math.max(0, (timeRef ? timeRef.current : time) - 5))}
          disabled={!media}
          title="5 sn Geri Sar"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-muted)] transition hover:border-white/40 hover:text-white disabled:opacity-30"
        >
          ↺5
        </button>
      )}
      <button
        data-testid="play-btn"
        onClick={onToggle}
        disabled={!media}
        title="Oynat / Durdur (Boşluk)"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-[var(--accent-fg)] shadow-[0_2px_12px_var(--accent-glow)] transition duration-150 hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_16px_var(--accent-glow)] active:scale-95 disabled:opacity-30"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        onClick={() => onSeek(Math.min(duration, (timeRef ? timeRef.current : time) + 5))}
        disabled={!media}
        title="5 sn İleri Sar"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-muted)] transition duration-150 hover:border-white/30 hover:bg-[var(--bg-elevated,#292E36)] hover:text-white active:scale-95 disabled:opacity-30"
      >
        5↻
      </button>
      <div
        className="relative mx-1 h-5 flex-1 cursor-pointer"
        onPointerDown={(e) => {
          onScrubStart()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          onScrubPointer(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && onScrubPointer(e)}
        onPointerUp={() => onScrubEnd()}
        onPointerCancel={() => onScrubEnd()}
      >
        <div className="absolute left-0 right-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-white/12" />
        <div
          ref={progressFillRef}
          className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[var(--accent)]"
          style={{ width: `${progress}%` }}
        />
        <div
          ref={progressThumbRef}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--bg-panel)] transition-transform duration-150 hover:scale-110"
          style={{ left: `${progress}%` }}
        />
      </div>

      {/* Kare Yakala (Grab Still) & Rengi Kopyala / Yapıştır */}
      {(onGrabStill || onCopyGrade || onPasteGrade) && (
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
          {onGrabStill && (
            <button
              type="button"
              data-testid="grab-still-btn"
              onClick={onGrabStill}
              title="Anlık Kare Yakala ve Referans Galerisine Kaydet (Grab Still)"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium text-white/80 transition duration-150 hover:bg-white/[0.1] hover:text-white active:scale-95"
            >
              <span>Kare Yakala</span>
            </button>
          )}
          {onCopyGrade && (
            <button
              type="button"
              data-testid="copy-grade-btn"
              onClick={onCopyGrade}
              title="Aktif Klibin Renk Ayarlarını Kopyala (Copy Grade)"
              className="rounded-full px-2.5 py-1 text-[10px] font-medium text-white/70 transition duration-150 hover:bg-white/[0.1] hover:text-white active:scale-95"
            >
              Kopyala
            </button>
          )}
          {onPasteGrade && (
            <button
              type="button"
              data-testid="paste-grade-btn"
              onClick={onPasteGrade}
              disabled={!hasCopiedGrade}
              title="Kopyalanan Renk Ayarlarını Bu Klibe Yapıştır (Paste Grade)"
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition duration-150 active:scale-95 disabled:opacity-25 ${
                hasCopiedGrade ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-white/50'
              }`}
            >
              Yapıştır
            </button>
          )}
        </div>
      )}

      <span className="shrink-0 rounded-full border border-[var(--accent)]/40 bg-[var(--bg-surface)] px-3 py-1 font-mono text-[10px] tracking-wider text-[var(--accent)]">
        <span ref={bottomTimecodeCurrentRef}>{fmt(time, media?.fps || 25)}</span>{' '}
        <span className="text-white/30">/</span> {fmt(duration, media?.fps || 25)}
      </span>
    </div>
  )
}
