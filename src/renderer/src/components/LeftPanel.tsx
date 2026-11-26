import { useEffect, useState } from 'react'
import { CREDIT_TEMPLATES, type CreditTemplateId } from '../../../shared/credits'
import type { MediaItem } from '../../../shared/types'
import { fmtDuration } from '../lib/format'
import type { Tab } from '../types'

export const MEDIA_DRAG_TYPE = 'application/x-noircut-media'

export default function LeftPanel({
  tab,
  width = 276,
  media,
  activeMediaId,
  busy,
  errors,
  onImport,
  onSelectMedia,
  onAddMediaToTimeline,
  onRemoveMedia,
  onDismissErrors,
  activeCreditTemplate,
  onSelectCreditTemplate
}: {
  tab: Tab
  width?: number
  media: MediaItem[]
  activeMediaId: string | null
  busy: boolean
  errors: string[]
  onImport: () => void
  onSelectMedia: (id: string) => void
  onAddMediaToTimeline: (id: string) => void
  onRemoveMedia: (id: string) => void
  onDismissErrors: () => void
  activeCreditTemplate: CreditTemplateId
  onSelectCreditTemplate: (id: CreditTemplateId) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; mediaId: string } | null>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [ctxMenu])
  const rawMedia = media.filter((m) => !m.id.startsWith('sfx-'))
  const videoMedia = rawMedia.filter((m) => {
    if (mediaFilter === 'all') return true
    const ext = (m.path?.split('.').pop() || m.name.split('.').pop() || '').toLowerCase()
    const isAudioOnly =
      m.mediaKind === 'audio' || ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext) || m.width === 0
    const isImageOnly =
      m.mediaKind === 'image' || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
    if (mediaFilter === 'audio') return isAudioOnly
    if (mediaFilter === 'image') return isImageOnly
    return !isAudioOnly && !isImageOnly
  })

  if (collapsed) {
    return (
      <aside className="glass flex h-full w-10 shrink-0 flex-col items-center py-3 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]">
        <button
          data-testid="left-panel-expand"
          onClick={() => setCollapsed(false)}
          title="Sol Paneli Aç"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] transition duration-150 hover:border-white/35 hover:text-white active:scale-95"
        >
          »
        </button>
        <span className="mt-4 font-mono text-[9px] font-semibold tracking-[0.25em] text-[var(--text-muted)] [writing-mode:vertical-rl]">
          MEDYA & KÜTÜPHANE
        </span>
      </aside>
    )
  }

  return (
    <aside
      style={{ width }}
      tabIndex={-1}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (e.key === 'Delete' && activeMediaId) {
          e.preventDefault()
          e.stopPropagation()
          onRemoveMedia(activeMediaId)
        }
      }}
      className="glass flex h-full shrink-0 flex-col overflow-hidden outline-none transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <button
            data-testid="left-panel-collapse"
            onClick={() => setCollapsed(true)}
            title="Sol Paneli Gizle"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[10px] text-[var(--text-muted)] transition duration-150 hover:bg-[var(--bg-elevated,#262b34)] hover:text-white active:scale-95"
          >
            «
          </button>
          <span className="panel-title">Medya</span>
        </div>
        <button
          className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-[var(--accent-fg)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.97]"
          data-testid="import-btn"
          onClick={onImport}
          disabled={busy}
        >
          {busy ? 'Okunuyor…' : '+ İçe Aktar'}
        </button>
      </div>

      {/* Medya Filtre Şeridi */}
      <div className="mx-3 mb-2 flex items-center gap-1 rounded-full bg-[var(--bg-surface)] p-1">
        {(
          [
            ['all', 'Tümü'],
            ['video', 'Video'],
            ['audio', 'Ses'],
            ['image', 'Görsel']
          ] as const
        ).map(([fid, flabel]) => (
          <button
            key={fid}
            type="button"
            onClick={() => setMediaFilter(fid)}
            className={`rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide transition duration-150 ${
              mediaFilter === fid
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {flabel}
          </button>
        ))}
        <span className="ml-auto rounded-full bg-[var(--bg-panel)] px-2 py-0.5 font-mono text-[9px] text-[var(--text-muted)]">
          {rawMedia.length}
        </span>
      </div>

      {errors.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-crimson/40 bg-crimson/10 p-2 text-[10px] text-crimson">
          {errors.map((e) => (
            <div key={e} className="truncate" title={e}>
              {e}
            </div>
          ))}
          <button className="mt-1 underline" onClick={onDismissErrors}>
            Kapat
          </button>
        </div>
      )}

      <div
        className={`${
          tab === 'CREDITS' ? 'max-h-[240px] min-h-[96px]' : 'min-h-0 flex-1'
        } overflow-y-auto px-3 pb-3`}
      >
        {videoMedia.length === 0 ? (
          <button
            onClick={onImport}
            className="flex h-[84px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-[11px] text-white/40 transition hover:border-tungsten/60 hover:text-white/70"
          >
            <span className="text-lg leading-none">+</span>
            Video · Ses · Görsel seç
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {videoMedia.map((m) => {
              const isActive = m.id === activeMediaId
              const ext = (m.path?.split('.').pop() || m.name.split('.').pop() || 'MP4').toUpperCase()
              const sealLabel =
                m.mediaKind === 'image'
                  ? `IMG • ${ext}`
                  : m.mediaKind === 'audio' || m.width === 0
                    ? `SES • ${ext}`
                    : `${Math.round(m.fps || 24)}FPS • ${ext}`
              return (
                <div
                  key={m.id}
                  data-testid="media-card"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onSelectMedia(m.id)}
                  onDoubleClick={() => onAddMediaToTimeline(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onSelectMedia(m.id)
                    setCtxMenu({ x: e.clientX, y: e.clientY, mediaId: m.id })
                  }}
                  title={`${m.name}\n${m.width}×${m.height} · ${m.codec} · ${m.fps.toFixed(2)} fps\nÇift tıkla veya + ile timeline'a ekle`}
                  className={`case-file-card group relative cursor-pointer overflow-hidden rounded-[13px] border bg-[var(--bg-surface)] transition duration-150 ${
                    isActive
                      ? 'border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                      : 'border-[color:var(--border-subtle)] hover:border-white/30'
                  }`}
                >
                  {/* Hover Aksiyonları: + (Timeline'a Ekle) & Sil (Trash) */}
                  <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <button
                      type="button"
                      data-testid="media-card-add"
                      title="Timeline'a Ekle"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddMediaToTimeline(m.id)
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--accent)]/60 bg-black/85 text-xs font-bold leading-none text-[var(--accent)] shadow transition hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      data-testid="media-card-delete"
                      title="Medyadan Kaldır (Delete)"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveMedia(m.id)
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-crimson/55 bg-black/85 text-[10px] text-crimson shadow transition hover:bg-crimson hover:text-white"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-3 w-3"
                      >
                        <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M12 4.5l-.6 8.2a1.2 1.2 0 0 1-1.2 1.1H5.8a1.2 1.2 0 0 1-1.2-1.1L4 4.5" />
                      </svg>
                    </button>
                  </div>

                  <div className="relative aspect-video bg-gradient-to-br from-white/10 to-black">
                    {m.thumbnail ? (
                      <img src={m.thumbnail} alt="" draggable={false} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center gap-1 bg-gradient-to-br from-cyan-950/60 via-[#151921] to-black">
                        {[38, 68, 92, 54, 80, 44, 72].map((h, idx) => (
                          <span
                            key={idx}
                            className="w-1 rounded-full bg-cyan-400/65"
                            style={{ height: `${Math.round(h * 0.48)}%` }}
                          />
                        ))}
                      </div>
                    )}
                    {/* Stüdyo Mührü Damgası (24FPS • RAW/MP4 / IMG / SES) */}
                    <span
                      data-testid="media-card-seal"
                      className="absolute left-1 top-1 rounded border border-white/15 bg-black/80 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[var(--accent)]"
                    >
                      {sealLabel}
                    </span>
                    <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 font-mono text-[9px] text-white/85">
                      {fmtDuration(m.duration)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 bg-black/50 px-2 py-1">
                    <span className="truncate text-[10px] font-medium text-white/75">{m.name}</span>
                    <span className="shrink-0 font-mono text-[8px] text-white/35">
                      {m.mediaKind === 'audio' ? (m.audioCodec?.toUpperCase() ?? 'AUD') : m.height ? `${m.height}P` : 'RAW'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {tab === 'CREDITS' && (
        <>
          <div className="border-t border-[color:var(--border-subtle)]" />
          <div className="flex items-center justify-between px-3.5 pb-2 pt-2.5">
            <span className="panel-title !text-[var(--accent)]">Jenerik Şablonları</span>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
            {CREDIT_TEMPLATES.map((tpl) => {
              const selected = activeCreditTemplate === tpl.id
              return (
                <button
                  key={tpl.id}
                  data-testid={`credit-tpl-${tpl.id}`}
                  onClick={() => onSelectCreditTemplate(tpl.id)}
                  className={`flex flex-col gap-1 rounded-[13px] border bg-[var(--bg-surface)] p-3 text-left transition duration-150 ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_12px_var(--accent-glow)]'
                      : 'border-[color:var(--border-subtle)] hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-white/90">{tpl.name}</span>
                    <span className="shrink-0 rounded bg-[var(--accent)]/15 px-1.5 py-0.5 font-mono text-[8px] font-bold text-[var(--accent)]">
                      {tpl.badge}
                    </span>
                  </div>
                  <p className="text-[10px] leading-snug text-white/45">{tpl.description}</p>
                </button>
              )
            })}
          </div>
        </>
      )}

      {ctxMenu && (
        <div
          data-testid="media-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[168px] rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated,#1b1f27)] p-1 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            onClick={() => {
              onAddMediaToTimeline(ctxMenu.mediaId)
              setCtxMenu(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-white/85 transition hover:bg-[var(--accent)]/20 hover:text-[var(--accent)]"
          >
            <span>+</span>
            <span>Timeline&apos;a Ekle</span>
          </button>
          <button
            type="button"
            data-testid="media-ctx-remove"
            onClick={() => {
              const id = ctxMenu.mediaId
              setCtxMenu(null)
              onRemoveMedia(id)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-crimson transition hover:bg-crimson/15"
          >
            <span>✕</span>
            <span>Medyadan Kaldır</span>
          </button>
        </div>
      )}
    </aside>
  )
}
