import {
  CASE_MARKER_COLOR_META,
  type CaseMarker,
  type CaseMarkerColor
} from '../../../../shared/timeline'
import { fmt } from '../../lib/format'

export function CaseMarkerPopover({
  activeMarker,
  markersCount,
  fps,
  onStepMarker,
  onDeleteMarker,
  onSelectMarker,
  onUpdateMarker
}: {
  activeMarker: CaseMarker
  markersCount: number
  fps: number
  onStepMarker?: (dir: -1 | 1) => void
  onDeleteMarker?: (id: string) => void
  onSelectMarker?: (id: string | null) => void
  onUpdateMarker?: (id: string, patch: Partial<CaseMarker>) => void
}) {
  return (
    <div
      data-testid="case-marker-popover"
      className="absolute bottom-full left-36 z-50 mb-2 w-[320px] rounded-lg border border-white/15 bg-[#0F0F12]/95 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.85)]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rotate-45 rounded-[2px]"
            style={{
              backgroundColor: CASE_MARKER_COLOR_META[activeMarker.color].hex,
              boxShadow: `0 0 8px ${CASE_MARKER_COLOR_META[activeMarker.color].glow}`
            }}
          />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white/90">
            Sahne Notu · {fmt(activeMarker.time, fps)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {markersCount > 1 && onStepMarker && (
            <>
              <button
                type="button"
                data-testid="popover-prev-marker"
                onClick={() => onStepMarker(-1)}
                title="Önceki İşaretçi"
                className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/70 hover:bg-white/[0.14] hover:text-white"
              >
                ◀
              </button>
              <button
                type="button"
                data-testid="popover-next-marker"
                onClick={() => onStepMarker(1)}
                title="Sonraki İşaretçi"
                className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/70 hover:bg-white/[0.14] hover:text-white"
              >
                ▶
              </button>
            </>
          )}
          {onDeleteMarker && (
            <button
              type="button"
              data-testid="popover-delete-marker"
              onClick={() => onDeleteMarker(activeMarker.id)}
              title="İşaretçiyi Sil"
              className="rounded-full bg-red-500/15 px-2 py-0.5 font-mono text-[9px] text-red-300 hover:bg-red-500/30"
            >
              Sil
            </button>
          )}
          <button
            type="button"
            data-testid="popover-close-marker"
            onClick={() => onSelectMarker?.(null)}
            className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/60 hover:bg-white/[0.14] hover:text-white"
          >
            ×
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="mb-1 text-[9px] font-medium text-white/50">Sahne Başlığı</div>
          <input
            data-testid="marker-title-input"
            value={activeMarker.title}
            onChange={(e) => onUpdateMarker?.(activeMarker.id, { title: e.target.value })}
            placeholder="Örn: Sahne 1 — Sorgu Odası"
            className="w-full rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs font-medium text-white outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <div className="mb-1 text-[9px] font-medium text-white/50">Yönetmen Notu</div>
          <textarea
            data-testid="marker-note-input"
            rows={2}
            value={activeMarker.note}
            onChange={(e) => onUpdateMarker?.(activeMarker.id, { note: e.target.value })}
            placeholder="Kamera hareketi, ışık veya ses kurgusu için not ekleyin…"
            className="w-full resize-none rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-[11px] text-white/85 outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[9px] text-white/45">Etiket Rengi</span>
          <div className="flex items-center gap-1.5">
            {(Object.keys(CASE_MARKER_COLOR_META) as CaseMarkerColor[]).map((cKey) => {
              const meta = CASE_MARKER_COLOR_META[cKey]
              const selected = activeMarker.color === cKey
              return (
                <button
                  key={cKey}
                  type="button"
                  data-testid={`marker-color-${cKey}`}
                  onClick={() => onUpdateMarker?.(activeMarker.id, { color: cKey })}
                  title={meta.label}
                  style={{ backgroundColor: meta.hex }}
                  className={`h-4 w-4 rounded-full transition ${
                    selected ? 'scale-125 ring-2 ring-white' : 'opacity-65 hover:opacity-100'
                  }`}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
