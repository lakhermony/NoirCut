import { useState } from 'react'
import {
  EXPORT_PLATFORM_PRESETS,
  EXPORT_RESOLUTION_DIM,
  type ExportCodec,
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
  status: 'pending' | 'running' | 'paused' | 'done' | 'error' | 'canceled'
  progress: number
  startedAt?: number
  etaSec?: number | null
  error?: string
  logs?: string[]
}

const ENCODER_LABELS: Record<ExportEncoder, string> = {
  auto: 'Otomatik (GPU Öncelikli)',
  libx264: 'CPU (libx264)',
  libx265: 'CPU HEVC (libx265)',
  h264_nvenc: 'NVIDIA NVENC (H.264)',
  hevc_nvenc: 'NVIDIA NVENC (HEVC)',
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
  { value: 'mp4', label: 'MP4 Konteyner' },
  { value: 'mov', label: 'MOV (QuickTime)' }
]
const CODECS: Array<{ value: ExportCodec; label: string }> = [
  { value: 'h264', label: 'H.264 / AVC' },
  { value: 'h265', label: 'H.265 / HEVC' }
]
const AUDIO_BITRATES: Array<128 | 192 | 320> = [128, 192, 320]
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
  subtitleCount = 0,
  onStart,
  onCancel,
  onReveal,
  engine,
  inPoint = null,
  outPoint = null,
  exportQueue = [],
  queueRunning = false,
  queuePaused = false,
  renderLogs = [],
  onAddToQueue,
  onStartQueue,
  onPauseResumeQueue,
  onRetryQueueJob,
  onCancelQueueJob,
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
  subtitleCount?: number
  onStart: () => void
  onCancel: () => void
  onReveal: (path: string) => void
  engine?: EngineInfo | null
  inPoint?: number | null
  outPoint?: number | null
  exportQueue?: ExportQueueJob[]
  queueRunning?: boolean
  queuePaused?: boolean
  renderLogs?: string[]
  onAddToQueue?: () => void
  onStartQueue?: () => void
  onPauseResumeQueue?: () => void
  onRetryQueueJob?: (id: string) => void
  onCancelQueueJob?: (id: string) => void
  onRemoveQueueJob?: (id: string) => void
  onClearFinishedQueue?: () => void
}) {
  const [showLogs, setShowLogs] = useState(false)
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
  const activeJob = exportQueue.find((j) => j.status === 'running' || j.status === 'paused')

  return (
    <section
      data-testid="export-workspace"
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Üst Başlık */}
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="panel-title">
            Dışa Aktarma ve Profesyonel Render Kuyruğu (FFmpeg Render Queue)
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-muted)]">
          <span>
            Çıkış: <strong className="text-white">{dim.width}×{dim.height}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            Codec:{' '}
            <strong className="uppercase text-[var(--accent)]">
              {settings.codec ?? 'h264'}
            </strong>
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
        {/* Sol: Video, Codec, Bitrate & Render Kuyruğu */}
        <div className="soft-card space-y-4 p-4 lg:col-span-2">
          {/* Platform Hazır Profilleri */}
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Export Presets (YouTube · Social · Master · Custom)
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
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
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white shadow-[0_0_10px_var(--accent-glow)]'
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
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', resolution: res })
                    }
                    className={`rounded-2xl border px-3.5 py-2 text-left transition duration-150 active:scale-[0.98] disabled:opacity-45 ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white shadow-[0_0_12px_var(--accent-glow)]'
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', fps: opt.value })
                    }
                    className={`rounded-full border py-1.5 text-[10.5px] transition duration-150 active:scale-[0.97] disabled:opacity-45 ${
                      settings.fps === opt.value
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {opt.value} fps
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Konteyner
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {FORMATS.map((fmt) => (
                  <button
                    key={fmt.value}
                    type="button"
                    disabled={exporting}
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', format: fmt.value })
                    }
                    className={`rounded-full border py-1.5 text-[10.5px] transition duration-150 active:scale-[0.97] disabled:opacity-45 ${
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

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Video Codec (H.264 / H.265)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {CODECS.map((cd) => (
                  <button
                    key={cd.value}
                    type="button"
                    data-testid={`export-codec-${cd.value}`}
                    disabled={exporting}
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', codec: cd.value })
                    }
                    className={`rounded-full border py-1.5 text-[10.5px] transition duration-150 active:scale-[0.97] disabled:opacity-45 ${
                      (settings.codec ?? 'h264') === cd.value
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {cd.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bitrate, Ses Bitrate ve Kalite */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Kalite Profili
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {QUALITIES.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    disabled={exporting}
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', quality: q.value })
                    }
                    className={`rounded-xl border px-2 py-1.5 text-center transition duration-150 active:scale-[0.98] disabled:opacity-45 ${
                      settings.quality === q.value
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    <div className="text-[10.5px] font-semibold">{q.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <span>Video Bitrate</span>
                <span className="font-mono text-[var(--accent)]">
                  {settings.videoBitrateMbps ?? 16} Mbps
                </span>
              </div>
              <input
                type="range"
                data-testid="export-video-bitrate-slider"
                min={4}
                max={80}
                step={2}
                disabled={exporting}
                value={settings.videoBitrateMbps ?? 16}
                onChange={(e) =>
                  onSettings({
                    ...settings,
                    presetId: 'custom',
                    videoBitrateMbps: Number(e.target.value)
                  })
                }
                style={
                  {
                    '--pct': `${Math.max(0, Math.min(100, (((settings.videoBitrateMbps ?? 16) - 4) / 76) * 100))}%`
                  } as React.CSSProperties
                }
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Ses Bitrate (AAC 48kHz)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {AUDIO_BITRATES.map((ab) => (
                  <button
                    key={ab}
                    type="button"
                    disabled={exporting}
                    onClick={() =>
                      onSettings({ ...settings, presetId: 'custom', audioBitrateKbps: ab })
                    }
                    className={`rounded-full border py-1.5 font-mono text-[10px] transition ${
                      (settings.audioBitrateKbps ?? 192) === ab
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                    }`}
                  >
                    {ab} kbps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Donanım Kodlayıcı (GPU / CPU), In-Out Aralığı ve Altyazı Gömme */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <span>Donanım Hızlandırma (GPU / CPU)</span>
                <span className="font-mono text-[8.5px] normal-case text-white/45">
                  {availableEncoders.length > 1 ? 'GPU Algılandı' : 'CPU Fallback Aktif'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {encoderChoices.map((enc) => (
                  <button
                    key={enc}
                    type="button"
                    disabled={exporting}
                    onClick={() => onSettings({ ...settings, encoder: enc })}
                    className={`rounded-full border px-3 py-1 text-[10px] transition active:scale-[0.97] disabled:opacity-45 ${
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

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="export-inout-toggle"
                disabled={exporting || !hasRange}
                onClick={() =>
                  onSettings({ ...settings, useInOutRange: !settings.useInOutRange })
                }
                className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-left text-[10.5px] transition disabled:opacity-40 ${
                  settings.useInOutRange && hasRange
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                    : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                }`}
              >
                <div>
                  <div className="font-semibold">In – Out Aralığı</div>
                  <div className="text-[8.5px] text-[var(--text-muted)]">
                    {hasRange
                      ? `${rangeStartSec.toFixed(1)}s → ${rangeEndSec.toFixed(1)}s`
                      : 'Tüm Timeline'}
                  </div>
                </div>
                <span className="font-mono text-[9.5px] text-[var(--accent)]">
                  {settings.useInOutRange && hasRange ? 'AÇIK' : 'TÜMÜ'}
                </span>
              </button>

              <button
                type="button"
                data-testid="export-burnin-subtitles-toggle"
                disabled={exporting}
                onClick={() =>
                  onSettings({
                    ...settings,
                    burnInSubtitles: !(settings.burnInSubtitles ?? true)
                  })
                }
                className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-left text-[10.5px] transition ${
                  (settings.burnInSubtitles ?? true)
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                    : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                }`}
              >
                <div>
                  <div className="font-semibold">Altyazıları Göm</div>
                  <div className="text-[8.5px] text-[var(--text-muted)]">
                    {subtitleCount} segment
                  </div>
                </div>
                <span className="font-mono text-[9.5px] text-[var(--accent)]">
                  {(settings.burnInSubtitles ?? true) ? 'AÇIK' : 'KAPALI'}
                </span>
              </button>
            </div>
          </div>

          {/* Profesyonel Render Kuyruğu (Batch Render Queue) */}
          <div
            data-testid="render-queue-panel"
            className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/70 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Render Kuyruğu ({exportQueue.length})
                </span>
                {activeJob && typeof activeJob.etaSec === 'number' && activeJob.etaSec > 0 && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-[var(--accent)]">
                    Kalan Süre: ~{Math.ceil(activeJob.etaSec)}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {renderLogs.length > 0 && (
                  <button
                    type="button"
                    data-testid="toggle-render-logs-btn"
                    onClick={() => setShowLogs((v) => !v)}
                    className="chip !py-0.5 !text-[9px]"
                  >
                    {showLogs ? 'Logları Gizle' : `Render Logları (${renderLogs.length})`}
                  </button>
                )}
                {exportQueue.some(
                  (j) => j.status === 'done' || j.status === 'error' || j.status === 'canceled'
                ) &&
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
                {queueRunning && onPauseResumeQueue && (
                  <button
                    type="button"
                    data-testid="pause-resume-queue-btn"
                    onClick={onPauseResumeQueue}
                    className="rounded-full border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-[10px] font-semibold text-amber-300"
                  >
                    {queuePaused ? '▶ Devam Et' : '❚❚ Duraklat'}
                  </button>
                )}
                {exportQueue.some((j) => j.status === 'pending') &&
                  onStartQueue &&
                  !queueRunning && (
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
                Birden fazla çözünürlük/format (örn. YouTube 4K + Instagram Reels) çıktısını toplu işlemek için kuyruğa ekleyin.
              </div>
            ) : (
              <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {exportQueue.map((job) => (
                  <div
                    key={job.id}
                    data-testid={`queue-job-${job.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[10px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">{job.label}</div>
                      <div
                        className="truncate font-mono text-[8.5px] text-white/45"
                        title={job.outputPath}
                      >
                        {job.outputPath}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono text-[9.5px]">
                      {(job.status === 'running' || job.status === 'paused') && (
                        <>
                          <span className="text-[var(--accent)]">
                            {job.status === 'paused' ? 'Duraklatıldı' : `%${job.progress}`}
                          </span>
                          {onCancelQueueJob && (
                            <button
                              type="button"
                              onClick={() => onCancelQueueJob(job.id)}
                              className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[8.5px] text-rose-300 hover:bg-rose-500/35"
                            >
                              İptal
                            </button>
                          )}
                        </>
                      )}
                      {job.status === 'pending' && <span className="text-white/55">Bekliyor</span>}
                      {job.status === 'canceled' && (
                        <span className="text-amber-300/80">İptal Edildi</span>
                      )}
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
                      {(job.status === 'error' || job.status === 'canceled') &&
                        onRetryQueueJob && (
                          <button
                            type="button"
                            data-testid={`retry-job-${job.id}`}
                            onClick={() => onRetryQueueJob(job.id)}
                            className="rounded bg-white/10 px-1.5 py-0.5 text-[8.5px] text-white hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
                          >
                            Yeniden Dene
                          </button>
                        )}
                      {job.status !== 'running' &&
                        job.status !== 'paused' &&
                        onRemoveQueueJob && (
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

            {showLogs && renderLogs.length > 0 && (
              <div
                data-testid="render-logs-box"
                className="mt-2 max-h-28 overflow-y-auto rounded-xl border border-white/10 bg-black/65 p-2 font-mono text-[9px] text-white/70"
              >
                {renderLogs.map((ln, idx) => (
                  <div key={idx} className="truncate py-0.5">
                    {ln}
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
              <span className="panel-title">Render Çıktı Bilgisi (Orijinal Kaynak)</span>
            </div>

            <div className="space-y-2 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 font-mono text-[10.5px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Çözünürlük</span>
                <span className="text-white">
                  {dim.width}×{dim.height}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kare Hızı</span>
                <span className="text-white">{settings.fps} fps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Format / Codec</span>
                <span className="uppercase text-white">
                  {settings.format} · {settings.codec ?? 'h264'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Video / Ses Bitrate</span>
                <span className="text-[var(--accent)]">
                  {settings.videoBitrateMbps ?? 16} Mbps · {settings.audioBitrateKbps ?? 192}k
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kodlayıcı</span>
                <span className="text-white">{ENCODER_LABELS[settings.encoder ?? 'auto']}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Kaynak Modu</span>
                <span className="text-[var(--accent)]">Orijinal Medya (Tam Kalite)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Çıktı Süresi</span>
                <span className="text-white">{fmtDuration(effectiveDur)}</span>
              </div>
            </div>

            {(exporting || resultPath || error) && (
              <div className="space-y-2 rounded-xl border border-[color:var(--border-subtle)] bg-black/45 p-3">
                {exporting && (
                  <>
                    <div className="flex justify-between font-mono text-[11px] text-[var(--accent)]">
                      <span>{queuePaused ? 'Render Duraklatıldı' : 'FFmpeg İşleniyor…'}</span>
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
                    <div
                      className="truncate font-mono text-[10px] text-white/55"
                      title={resultPath}
                    >
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
                className="w-full rounded-full bg-[var(--accent)] py-2.5 text-[11px] font-bold tracking-[0.16em] text-[var(--accent-fg)] shadow-[0_2px_14px_var(--accent-glow)] transition duration-150 hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_20px_var(--accent-glow)] active:scale-[0.98]"
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
