import {
  EXPORT_PLATFORM_PRESETS,
  EXPORT_RESOLUTION_DIM,
  type ExportEncoder,
  type ExportFormat,
  type ExportFps,
  type ExportQuality,
  type ExportResolution,
  type ExportSettings
} from '../../../shared/timeline'
import type { EngineInfo } from '../../../shared/types'
import { fmtDuration } from '../lib/format'

export interface ExportQueueJob {
  id: string
  label: string
  outputPath: string
  settings: ExportSettings
  rangeStart?: number | null
  rangeEnd?: number | null
  status: 'pending' | 'running' | 'done' | 'error' | 'canceled'
  progress: number
  error?: string
}

const ENCODER_LABELS: Record<ExportEncoder, string> = {
  auto: 'Otomatik (GPU Öncelikli)',
  libx264: 'CPU (libx264)',
  h264_nvenc: 'NVIDIA NVENC',
  h264_vaapi: 'Linux VAAPI',
  h264_qsv: 'Intel QuickSync',
  h264_amf: 'AMD AMF'
}

const RESOLUTIONS: ExportResolution[] = ['1080p', '4k', 'vertical']
const FPS_OPTIONS: Array<{ value: ExportFps; label: string }> = [
  { value: 24, label: '24 fps (Sinema)' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' }
]
const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'mov', label: 'MOV (QuickTime)' }
]
const QUALITIES: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'low', label: 'Düşük', hint: 'Hızlı / Küçük Dosya' },
  { value: 'medium', label: 'Orta', hint: 'Dengeli' },
  { value: 'high', label: 'Yüksek', hint: 'Maksimum Netlik' }
]

export default function ExportWorkspace({
  settings,
  onSettings,
  exporting,
  progress,
  resultPath,
  error,
  clipCount,
  totalDuration,
  onStart,
  onCancel,
  onReveal,
  engine,
  inPoint = null,
  outPoint = null,
  exportQueue = [],
  queueRunning = false,
  onAddToQueue,
  onStartQueue,
  onRemoveQueueJob,
  onClearFinishedQueue
}: {
  settings: ExportSettings
  onSettings: (s: ExportSettings) => void
  exporting: boolean
  progress: number
  resultPath: string | null
  error: string | null
  clipCount: number
  totalDuration: number
  onStart: () => void
  onCancel: () => void
  onReveal: (path: string) => void
  engine?: EngineInfo | null
  inPoint?: number | null
  outPoint?: number | null
  exportQueue?: ExportQueueJob[]
  queueRunning?: boolean
  onAddToQueue?: () => void
  onStartQueue?: () => void
  onRemoveQueueJob?: (id: string) => void
  onClearFinishedQueue?: () => void
}) {
  const dim = EXPORT_RESOLUTION_DIM[settings.resolution]
  const hasRange = inPoint !== null || outPoint !== null
  const rangeStartSec = inPoint ?? 0
  const rangeEndSec = outPoint !== null ? outPoint : totalDuration
  const effectiveDur =
    settings.useInOutRange && hasRange && rangeEndSec > rangeStartSec
      ? rangeEndSec - rangeStartSec
      : totalDuration
  const availableEncoders = engine?.availableEncoders ?? ['libx264']
  const encoderChoices: ExportEncoder[] = ['auto', ...availableEncoders]

  return (
    <section
      data-testid="export-workspace"
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Üst Başlık */}
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="panel-title">Dışa Aktarma ve Render Stüdyosu (FFmpeg Export)</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-muted)]">
          <span>
            Çıkış: <strong className="text-white">{dim.width}×{dim.height}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            Süre: <strong className="text-[var(--accent)]">{fmtDuration(totalDuration)}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            Klip: <strong className="text-white">{clipCount}</strong>
          </span>
        </div>
      </div>

      {/* Ana Render Ayarları Izgarası */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-3">
        {/* Sol: Video & Format Ayarları */}
        <div className="soft-card space-y-4 p-4 lg:col-span-2">
          {/* Platform Hazır Profilleri */}
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Platform Ön Ayarları
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {EXPORT_PLATFORM_PRESETS.map((p) => {
                const active = settings.presetId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`export-preset-${p.id}`}
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, ...p.patch })}
                    className={`rounded-2xl border px-3 py-2 text-left transition duration-150 active:scale-[0.98] disabled:opacity-45 ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_10px_rgba(183,227,106,0.16)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/75 hover:border-white/25'
                    }`}
                  >
                    <div className="truncate text-[10.5px] font-semibold">{p.label}</div>
                    <div className="mt-0.5 truncate font-mono text-[8.5px] text-[var(--text-muted)]">
                      {p.hint}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Çözünürlük
            </div>
            <div className="grid grid-cols-3 gap-2">
              {RESOLUTIONS.map((res) => {
                const rdim = EXPORT_RESOLUTION_DIM[res]
                const active = settings.resolution === res
                return (
                  <button
                    key={res}
                    type="button"
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, resolution: res })}
                    className={`rounded-2xl border px-3.5 py-2.5 text-left transition duration-150 active:scale-[0.98] disabled:opacity-45 ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_12px_rgba(183,227,106,0.16)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    <div className="text-xs font-semibold">{rdim.label}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      {rdim.width}×{rdim.height}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Kare Hızı (FPS)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {FPS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, fps: opt.value })}
                    className={`rounded-full border py-2 text-[11px] transition duration-150 active:scale-[0.97] disabled:opacity-45 ${
                      settings.fps === opt.value
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Konteyner & Codec
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {FORMATS.map((fmt) => (
                  <button
                    key={fmt.value}
                    type="button"
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, format: fmt.value })}
                    className={`rounded-full border py-2 text-[11px] transition duration-150 active:scale-[0.97] disabled:opacity-45 ${
                      settings.format === fmt.value
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Kalite / Bitrate Profili
            </div>
            <div className="grid grid-cols-3 gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  disabled={exporting}
                  onClick={() => onSettings({ ...settings, presetId: 'custom', quality: q.value })}
                  className={`rounded-2xl border px-3.5 py-2.5 text-left transition duration-150 active:scale-[0.98] disabled:opacity-45 ${
                    settings.quality === q.value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_12px_rgba(183,227,106,0.16)]'
                      : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                  }`}
                >
                  <div className="text-[11px] font-semibold">{q.label}</div>
                  <div className="mt-0.5 text-[9.5px] text-[var(--text-muted)]">{q.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Donanım Kodlayıcı (GPU / CPU) ve In-Out Aralığı */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <span>Video Kodlayıcı (GPU / CPU)</span>
                <span className="font-mono text-[8.5px] normal-case text-white/45">
                  {availableEncoders.length > 1 ? 'GPU Hazır' : 'Yalnızca CPU (libx264)'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {encoderChoices.map((enc) => (
                  <button
                    key={enc}
                    type="button"
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, encoder: enc })}
                    className={`rounded-full border px-3 py-1.5 text-[10px] transition active:scale-[0.97] disabled:opacity-45 ${
                      (settings.encoder ?? 'auto') === enc
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {ENCODER_LABELS[enc]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Çıkış Aralığı (Timeline / In-Out)
              </div>
              <button
                type="button"
                data-testid="export-inout-toggle"
                disabled={exporting || !hasRange}
                onClick={() =>
                  onSettings({ ...settings, useInOutRange: !settings.useInOutRange })
                }
                className={`flex w-full items-center justify-between rounded-2xl border px-3.5 py-2.5 text-left text-[11px] transition disabled:opacity-40 ${
                  settings.useInOutRange && hasRange
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                    : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                }`}
              >
                <div>
                  <div className="font-semibold">
                    {hasRange
                      ? `In – Out Aralığı (${rangeStartSec.toFixed(1)}s → ${rangeEndSec.toFixed(1)}s)`
                      : 'Tüm Zaman Çizelgesi'}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">
                    {hasRange
                      ? settings.useInOutRange
                        ? 'Yalnızca işaretli aralık dışa aktarılacak'
                        : 'Açmak için tıklayın (şu an tümü)'
                      : 'Aralık seçmek için timeline üzerinde I / O koyun'}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-[var(--accent)]">
                  {settings.useInOutRange && hasRange ? 'AÇIK' : 'TÜMÜ'}
                </span>
              </button>
            </div>
          </div>

          {/* Arka Plan Render Kuyruğu */}
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Render Kuyruğu ({exportQueue.length})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {exportQueue.some((j) => j.status === 'done' || j.status === 'error' || j.status === 'canceled') &&
                  onClearFinishedQueue && (
                    <button
                      type="button"
                      onClick={onClearFinishedQueue}
                      className="chip !py-0.5 !text-[9px]"
                    >
                      Bitenleri Temizle
                    </button>
                  )}
                {onAddToQueue && (
                  <button
                    type="button"
                    data-testid="add-to-queue-btn"
                    onClick={onAddToQueue}
                    className="rounded-full border border-[var(--accent)]/45 bg-[var(--accent)]/12 px-3 py-1 text-[10px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/22"
                  >
                    + Kuyruğa Ekle
                  </button>
                )}
                {exportQueue.some((j) => j.status === 'pending') && onStartQueue && !queueRunning && (
                  <button
                    type="button"
                    data-testid="start-queue-btn"
                    disabled={exporting}
                    onClick={onStartQueue}
                    className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-[var(--accent-fg)] disabled:opacity-45"
                  >
                    Kuyruğu Başlat
                  </button>
                )}
              </div>
            </div>

            {exportQueue.length === 0 ? (
              <div className="py-2 text-center text-[10px] text-[var(--text-muted)]">
                Birden fazla çözünürlük/format (örn. 16:9 + 9:16) çıktısını peş peşe üretmek için kuyruğa ekleyin.
              </div>
            ) : (
              <div className="max-h-28 space-y-1.5 overflow-y-auto pr-1">
                {exportQueue.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[10px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">{job.label}</div>
                      <div className="truncate font-mono text-[8.5px] text-white/45" title={job.outputPath}>
                        {job.outputPath}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono text-[9.5px]">
                      {job.status === 'running' && (
                        <span className="text-[var(--accent)]">%{job.progress}</span>
                      )}
                      {job.status === 'pending' && <span className="text-white/55">Bekliyor</span>}
                      {job.status === 'done' && (
                        <button
                          type="button"
                          onClick={() => onReveal(job.outputPath)}
                          className="text-[var(--accent)] hover:underline"
                        >
                          Tamamlandı ↗
                        </button>
                      )}
                      {job.status === 'error' && (
                        <span className="text-crimson" title={job.error}>
                          Hata
                        </span>
                      )}
                      {job.status !== 'running' && onRemoveQueueJob && (
                        <button
                          type="button"
                          onClick={() => onRemoveQueueJob(job.id)}
                          className="text-white/35 hover:text-white"
                          title="Kuyruktan çıkar"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sağ: Render Özeti, İlerleme ve Başlatma */}
        <div className="soft-card flex flex-col justify-between gap-4 p-4">
          <div className="space-y-3">
            <div className="border-b border-[color:var(--border-subtle)] pb-2">
              <span className="panel-title">Render Özeti</span>
            </div>

            <div className="space-y-2 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 font-mono text-[10.5px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Çözünürlük</span>
                <span className="text-white">{dim.width}×{dim.height}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kare Hızı</span>
                <span className="text-white">{settings.fps} fps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Format</span>
                <span className="uppercase text-white">{settings.format}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kalite</span>
                <span className="uppercase text-[var(--accent)]">{settings.quality}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kodlayıcı</span>
                <span className="text-white">{ENCODER_LABELS[settings.encoder ?? 'auto']}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Tahmini Süre</span>
                <span className="text-white">{fmtDuration(effectiveDur)}</span>
              </div>
            </div>

            {(exporting || resultPath || error) && (
              <div className="space-y-2 rounded border border-[color:var(--border-subtle)] bg-black/45 p-3">
                {exporting && (
                  <>
                    <div className="flex justify-between font-mono text-[11px] text-[var(--accent)]">
                      <span>FFmpeg İşleniyor…</span>
                      <span>%{progress}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-white/10">
                      <div
                        className="h-full bg-[var(--accent)] transition-all duration-200"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </>
                )}

                {resultPath && !exporting && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-[var(--accent)]">
                      Dışa aktarma tamamlandı!
                    </div>
                    <div className="truncate font-mono text-[10px] text-white/55" title={resultPath}>
                      {resultPath}
                    </div>
                    <button
                      type="button"
                      onClick={() => onReveal(resultPath)}
                      className="w-full rounded-full bg-[var(--accent)] px-3 py-1.5 text-[10px] font-bold text-[var(--accent-fg)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98]"
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
          </div>

          <div className="pt-2">
            {exporting ? (
              <button
                type="button"
                onClick={onCancel}
                className="w-full rounded-full border border-crimson/60 bg-crimson/15 py-2.5 text-[11px] font-bold tracking-wider text-crimson transition duration-150 hover:bg-crimson/25 active:scale-[0.98]"
              >
                İptal Et
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                className="w-full rounded-full bg-[var(--accent)] py-2.5 text-[11px] font-bold tracking-[0.16em] text-[var(--accent-fg)] shadow-[0_2px_14px_rgba(183,227,106,0.24)] transition duration-150 hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_20px_rgba(183,227,106,0.36)] active:scale-[0.98]"
              >
                DIŞA AKTARMAYI BAŞLAT
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
