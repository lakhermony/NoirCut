import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import noircutLogo from '../assets/noircut-logo.png'
import { EXPORT_RESOLUTION_DIM, type ExportSettings } from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'
import { THEME_OPTIONS, type Tab, type ThemeId } from '../types'

const MAIN_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'CUT', label: 'EDIT' },
  { id: 'GRADE', label: 'COLOR' },
  { id: 'AUDIO', label: 'AUDIO' },
  { id: 'SUBTITLES', label: 'SUBTITLES' },
  { id: 'EXPORT', label: 'EXPORT' }
]

function TabIcon({ id, active }: { id: Tab; active: boolean }) {
  const cls = `h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
    active ? 'scale-110' : 'opacity-75 group-hover:scale-105 group-hover:opacity-100'
  }`
  switch (id) {
    case 'CUT':
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <circle cx="4.5" cy="4.5" r="1.75" />
          <circle cx="4.5" cy="11.5" r="1.75" />
          <path d="M6 5.6 13.5 11.5M6 10.4 13.5 4.5" />
        </svg>
      )
    case 'GRADE':
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <circle cx="8" cy="5.5" r="3" />
          <circle cx="5.5" cy="10" r="3" />
          <circle cx="10.5" cy="10" r="3" />
        </svg>
      )
    case 'AUDIO':
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={cls}>
          <path d="M3 6.5v3M6 4v8M9 2.5v11M12 5v6M14.5 7v2" />
        </svg>
      )
    case 'SUBTITLES':
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M4.5 8.5h3M9.5 8.5h2M4.5 11h5" />
        </svg>
      )
    case 'EXPORT':
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="M8 10.5V2.5M5 5.5 8 2.5l3 3M3 11.5v1.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5" />
        </svg>
      )
    default:
      return null
  }
}

export default function CommandIsland({
  tab,
  onTab,
  theme,
  onThemeChange,
  projectName = 'Adsız Proje',
  projectSaved = true,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onSaveProject,
  onLoadProject,
  onArchiveProject,
  onOpenAbout,
  onExport,
  onOpenLauncher,
  exportSettings,
  mediaItems = []
}: {
  tab: Tab
  onTab: (t: Tab) => void
  theme: ThemeId
  onThemeChange: (t: ThemeId) => void
  projectName?: string
  projectSaved?: boolean
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onSaveProject: () => void
  onLoadProject: () => void
  onArchiveProject?: () => void
  onOpenAbout?: () => void
  onExport: () => void
  onOpenLauncher?: () => void
  exportSettings: ExportSettings
  mediaItems?: MediaItem[]
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ind, setInd] = useState({ left: 0, width: 0, visible: false })

  useEffect(() => {
    const update = () => {
      const el = refs.current[tab]
      if (el) {
        setInd({ left: el.offsetLeft, width: el.offsetWidth, visible: true })
      } else {
        setInd((prev) => ({ ...prev, visible: false }))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [tab])

  const handleNavKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const idx = MAIN_TABS.findIndex((t) => t.id === tab)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = MAIN_TABS[(idx + 1) % MAIN_TABS.length]
      onTab(next.id)
      refs.current[next.id]?.focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = MAIN_TABS[(idx - 1 + MAIN_TABS.length) % MAIN_TABS.length]
      onTab(prev.id)
      refs.current[prev.id]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      onTab(MAIN_TABS[0].id)
      refs.current[MAIN_TABS[0].id]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      const last = MAIN_TABS[MAIN_TABS.length - 1]
      onTab(last.id)
      refs.current[last.id]?.focus()
    }
  }

  const resLabel =
    exportSettings.resolution === '4k'
      ? '4K'
      : exportSettings.resolution === 'vertical'
        ? '1080×1920'
        : '1080p'

  const buildingProxies = mediaItems.filter((m) => m.proxyState === 'building')
  const readyProxies = mediaItems.filter((m) => m.proxyState === 'ready')
  const avgProxyPct =
    buildingProxies.length > 0
      ? Math.round(
          (buildingProxies.reduce((sum, m) => sum + (m.proxyProgress ?? 0), 0) /
            buildingProxies.length) *
            100
        )
      : 100

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-1">
      {/* Sol Yüzen Kapsül: Ev/Launcher, Logo, Proje ve Hızlı Araçlar */}
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/95 px-2.5 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.28)] backdrop-blur-md">
        {onOpenLauncher && (
          <button
            type="button"
            data-testid="open-launcher-btn"
            onClick={onOpenLauncher}
            title="NoirCut Başlatıcı & Güncellemeler"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated,#292E36)] text-[var(--text-secondary,#9298A3)] transition-all duration-150 hover:scale-105 hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] active:scale-95"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M2.5 7.5 8 3l5.5 4.5" />
              <path d="M4 6.8V13a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V6.8" />
            </svg>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-2 pl-0.5 pr-1">
          <img
            src={noircutLogo}
            alt="NoirCut"
            className="h-7 w-7 shrink-0 rounded-[7px] object-contain shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
          />
          <span className="text-[11px] font-bold tracking-[0.24em] text-[var(--text-primary,#F1F2EE)]">
            NOIRCUT
          </span>
        </div>

        <div className="hidden h-4 w-px bg-[var(--border-subtle)] xl:block" />

        <div className="hidden min-w-0 items-center gap-1.5 rounded-full bg-[var(--bg-surface)] px-2.5 py-0.5 xl:flex">
          <span
            className="max-w-[115px] truncate text-[10px] font-medium text-[var(--text-primary,#F1F2EE)]/85"
            title={projectName}
          >
            {projectName}
          </span>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              projectSaved ? 'bg-[var(--accent)]' : 'bg-amber-400'
            }`}
            title={projectSaved ? 'Kaydedildi' : 'Kaydedilmemiş değişiklikler'}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            data-testid="load-project-btn"
            onClick={onLoadProject}
            title="Proje Aç (Ctrl+O)"
            className="rounded-full bg-[var(--bg-elevated,#292E36)] px-3 py-1 text-[10px] font-medium text-[var(--text-primary,#F1F2EE)]/85 transition duration-150 hover:scale-[1.02] hover:bg-white/[0.12] hover:text-white active:scale-[0.97]"
          >
            Proje Aç
          </button>
          <button
            data-testid="save-project-btn"
            onClick={onSaveProject}
            title="Projeyi Kaydet (Ctrl+S)"
            className="rounded-full bg-[var(--bg-elevated,#292E36)] px-3 py-1 text-[10px] font-medium text-[var(--text-primary,#F1F2EE)]/85 transition duration-150 hover:scale-[1.02] hover:bg-white/[0.12] hover:text-white active:scale-[0.97]"
          >
            Kaydet
          </button>
          {onArchiveProject && (
            <button
              data-testid="archive-project-btn"
              onClick={onArchiveProject}
              title="Projeyi ve Tüm Medyaları Tek Klasörde Paketle (Consolidate / Archive)"
              className="rounded-full bg-[var(--bg-elevated,#292E36)] px-3 py-1 text-[10px] font-medium text-[var(--text-primary,#F1F2EE)]/85 transition duration-150 hover:scale-[1.02] hover:bg-white/[0.12] hover:text-white active:scale-[0.97]"
            >
              Paketle
            </button>
          )}
          <button
            data-testid="nav-tab-credits"
            onClick={() => onTab('CREDITS')}
            title="Jenerik ve Metin Editörü"
            className={`rounded-full px-3 py-1 text-[10px] font-semibold tracking-wide transition duration-150 active:scale-[0.97] ${
              tab === 'CREDITS'
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_14px_var(--accent-glow)]'
                : 'bg-[var(--bg-elevated,#292E36)] text-[var(--text-muted)] hover:scale-[1.02] hover:bg-white/[0.12] hover:text-white'
            }`}
          >
            TEXT / CREDITS
          </button>
        </div>
      </div>

      {/* Orta Yüzen Kapsül: Floating Pill Navigation (EDIT · GRADE · AUDIO · EXPORT) */}
      <nav
        role="tablist"
        aria-label="Çalışma Alanları"
        onKeyDown={handleNavKeyDown}
        className="relative flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/95 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md"
      >
        {ind.visible && (
          <span
            data-testid="tab-underline-indicator"
            className="pointer-events-none absolute top-1 h-[calc(100%-8px)] rounded-full bg-[var(--accent)] shadow-[0_2px_16px_var(--accent-glow)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ left: ind.left, width: ind.width }}
          />
        )}
        {MAIN_TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              data-testid={`nav-tab-${t.id.toLowerCase()}`}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              onClick={() => onTab(t.id)}
              className={`group relative z-10 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[10.5px] font-bold tracking-[0.16em] outline-none transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                active
                  ? 'scale-[1.03] text-[var(--accent-fg)]'
                  : 'text-[var(--text-muted)] hover:scale-[1.02] hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <TabIcon id={t.id} active={active} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Sağ Yüzen Kapsül: Undo/Redo, FPS/Çözünürlük, Tema ve Hızlı Export */}
      <div className="flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/95 px-2.5 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.28)] backdrop-blur-md">
        {(onUndo || onRedo) && (
          <div className="hidden items-center gap-0.5 rounded-full bg-[var(--bg-surface)] p-0.5 lg:flex">
            <button
              type="button"
              data-testid="topbar-undo-btn"
              onClick={onUndo}
              disabled={!canUndo}
              title="Geri Al (Ctrl+Z)"
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-white/75 transition duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-25"
            >
              ↶
            </button>
            <button
              type="button"
              data-testid="topbar-redo-btn"
              onClick={onRedo}
              disabled={!canRedo}
              title="Yinele (Ctrl+Shift+Z)"
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-white/75 transition duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-25"
            >
              ↷
            </button>
          </div>
        )}

        {(buildingProxies.length > 0 || readyProxies.length > 0) && (
          <div
            data-testid="topbar-proxy-badge"
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9.5px] font-semibold sm:flex ${
              buildingProxies.length > 0
                ? 'border-amber-400/45 bg-amber-400/10 text-amber-300'
                : 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
            }`}
            title={
              buildingProxies.length > 0
                ? `Smart Proxy hazırlanıyor (%${avgProxyPct}) — 720p All-Intra akıcı önizleme (Export orijinal dosyayı kullanır)`
                : `Smart Proxy Aktif (${readyProxies.length} klip) — 720p All-Intra 60 FPS önizleme (Export her zaman tam çözünürlüklü orijinal dosyayı kullanır)`
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                buildingProxies.length > 0 ? 'animate-pulse bg-amber-400' : 'bg-[var(--accent)]'
              }`}
            />
            <span>
              {buildingProxies.length > 0 ? `PROXY %${avgProxyPct}` : 'PROXY'}
            </span>
          </div>
        )}

        <div
          className="hidden items-center gap-1.5 rounded-full bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] sm:flex"
          title={EXPORT_RESOLUTION_DIM[exportSettings.resolution].label}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="text-[var(--text-primary,#F1F2EE)]/85">{resLabel}</span>
          <span className="text-white/25">·</span>
          <span>{exportSettings.fps} fps</span>
        </div>

        <div
          data-testid="theme-switcher"
          className="flex items-center gap-1.5 rounded-full bg-[var(--bg-surface)] px-2.5 py-1.5"
          title="Tema Seç"
        >
          {THEME_OPTIONS.map((t) => {
            const active = theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`theme-btn-${t.id}`}
                onClick={() => onThemeChange(t.id)}
                title={t.label}
                aria-label={`Tema: ${t.label}`}
                className={`h-2.5 w-2.5 rounded-full transition-transform duration-150 ${
                  active
                    ? 'scale-125 ring-1 ring-white ring-offset-1 ring-offset-[var(--bg-surface)]'
                    : 'opacity-60 hover:scale-110 hover:opacity-100'
                }`}
                style={{ backgroundColor: t.swatch }}
              />
            )
          })}
        </div>

        {onOpenAbout && (
          <button
            type="button"
            data-testid="about-open-btn"
            onClick={onOpenAbout}
            title="Hakkında & GNU GPL v3 Lisans Bilgileri"
            aria-label="Hakkında ve Lisanslar"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-surface)] font-mono text-[11px] font-bold text-white/75 transition hover:bg-white/[0.12] hover:text-white"
          >
            i
          </button>
        )}

        <button
          data-testid="export-open-btn"
          onClick={onExport}
          className="flex items-center gap-1 rounded-full bg-[var(--accent)] px-3.5 py-1 text-[10px] font-bold tracking-[0.16em] text-[var(--accent-fg)] shadow-[0_2px_12px_var(--accent-glow)] transition duration-150 hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_18px_var(--accent-glow)] active:scale-[0.97]"
        >
          <span>EXPORT</span>
          <span className="text-[11px] leading-none">↗</span>
        </button>
      </div>
    </header>
  )
}
