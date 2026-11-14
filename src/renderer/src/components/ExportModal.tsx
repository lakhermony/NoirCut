import {
  EXPORT_RESOLUTION_DIM,
  type ExportFormat,
  type ExportFps,
  type ExportQuality,
  type ExportResolution,
  type ExportSettings
} from '../../../shared/timeline'

const RESOLUTIONS: ExportResolution[] = ['1080p', '4k', 'vertical']
const FPS_OPTIONS: Array<{ value: ExportFps; label: string }> = [
  { value: 24, label: '24 fps (Sinema)' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' }
]
const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'mov', label: 'MOV' }
]
const QUALITIES: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'low', label: 'Düşük', hint: 'Hızlı / Küçük Dosya' },
  { value: 'medium', label: 'Orta', hint: 'Dengeli' },
  { value: 'high', label: 'Yüksek', hint: 'Maksimum Netlik' }
]

export default function ExportModal({
  open,
  settings,
  onSettings,
  exporting,
  progress,
  resultPath,
  error,
  onStart,
  onCancel,
  onClose,
  onReveal
}: {
  open: boolean
  settings: ExportSettings
  onSettings: (s: ExportSettings) => void
  exporting: boolean
  progress: number
  resultPath: string | null
  error: string | null
  onStart: () => void
  onCancel: () => void
  onClose: () => void
  onReveal: (path: string) => void
}) {
  if (!open) return null

  return (
    <div
      data-testid="export-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      onClick={() => !exporting && onClose()}
    >
      <div
        className="glass w-full max-w-[480px] space-y-5 border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider text-white">DIŞA AKTAR (EXPORT)</h2>
            <p className="text-[11px] text-white/45">
              Kurgu, renk, .cube LUT ve jenerikler FFmpeg ile işlenir
            </p>
          </div>
          <button
            disabled={exporting}
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {/* Çözünürlük */}
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Çözünürlük
          </div>
          <div className="grid grid-cols-3 gap-2">
            {RESOLUTIONS.map((r) => (
              <button
                key={r}
                disabled={exporting}
                onClick={() => onSettings({ ...settings, resolution: r })}
                className={`rounded-lg border px-2.5 py-2 text-center text-[11px] transition disabled:opacity-50 ${
                  settings.resolution === r
                    ? 'border-tungsten bg-tungsten/15 text-tungsten font-semibold'
                    : 'border-white/10 bg-black/30 text-white/70 hover:border-white/30'
                }`}
              >
                {EXPORT_RESOLUTION_DIM[r].label}
              </button>
            ))}
          </div>
        </div>

        {/* Kare Hızı (FPS) */}
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Kare Hızı (FPS)
          </div>
          <div className="grid grid-cols-3 gap-2">
            {FPS_OPTIONS.map((f) => (
              <button
                key={f.value}
                disabled={exporting}
                onClick={() => onSettings({ ...settings, fps: f.value })}
                className={`rounded-lg border px-2.5 py-2 text-[11px] transition disabled:opacity-50 ${
                  settings.fps === f.value
                    ? 'border-tungsten bg-tungsten/15 text-tungsten font-semibold'
                    : 'border-white/10 bg-black/30 text-white/70 hover:border-white/30'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Format ve Kalite */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Format
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {FORMATS.map((fmt) => (
                <button
                  key={fmt.value}
                  disabled={exporting}
                  onClick={() => onSettings({ ...settings, format: fmt.value })}
                  className={`rounded-lg border py-2 text-[11px] transition disabled:opacity-50 ${
                    settings.format === fmt.value
                      ? 'border-tungsten bg-tungsten/15 text-tungsten font-semibold'
                      : 'border-white/10 bg-black/30 text-white/70 hover:border-white/30'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Kalite / Bitrate
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  disabled={exporting}
                  title={q.hint}
                  onClick={() => onSettings({ ...settings, quality: q.value })}
                  className={`rounded-lg border py-2 text-[11px] transition disabled:opacity-50 ${
                    settings.quality === q.value
                      ? 'border-tungsten bg-tungsten/15 text-tungsten font-semibold'
                      : 'border-white/10 bg-black/30 text-white/70 hover:border-white/30'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* İlerleme Çubuğu / Sonuç */}
        {(exporting || resultPath || error) && (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
            {exporting && (
              <>
                <div className="flex justify-between font-mono text-[11px] text-tungsten">
                  <span>İşleniyor…</span>
                  <span>%{progress}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-tungsten transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            )}

            {resultPath && !exporting && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-emerald-400">
                    Dışa aktarma tamamlandı!
                  </div>
                  <div className="truncate font-mono text-[10px] text-white/50" title={resultPath}>
                    {resultPath}
                  </div>
                </div>
                <button
                  data-testid="reveal-export-btn"
                  onClick={() => onReveal(resultPath)}
                  className="shrink-0 rounded-full bg-tungsten px-3.5 py-1.5 text-[10px] font-bold text-black hover:brightness-110"
                >
                  Dosya Konumunu Aç
                </button>
              </div>
            )}

            {error && !exporting && (
              <div className="text-[11px] text-crimson">Hata: {error}</div>
            )}
          </div>
        )}

        {/* Alt Butonlar */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {exporting ? (
            <button
              onClick={onCancel}
              className="rounded-full border border-crimson/60 bg-crimson/15 px-5 py-2 text-[11px] font-semibold text-crimson hover:bg-crimson/25"
            >
              İptal Et
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-full border border-white/15 px-4 py-2 text-[11px] text-white/70 hover:text-white"
              >
                Kapat
              </button>
              <button
                data-testid="start-export-btn"
                onClick={onStart}
                className="rounded-md bg-[var(--accent)] px-6 py-2 text-[11px] font-bold tracking-wider text-[var(--accent-fg)] ring-1 ring-[var(--accent-hover)] shadow-[0_0_18px_var(--accent-glow)] transition hover:bg-[var(--accent-hover)]"
              >
                Dışa Aktarmayı Başlat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
