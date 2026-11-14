import { useEffect, useRef, useState } from 'react'
import { EXPORT_RESOLUTION_DIM, type ExportSettings } from '../../../shared/timeline'
import { THEME_OPTIONS, type Tab, type ThemeId } from '../types'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'CUT', label: 'EDIT' },
  { id: 'GRADE', label: 'GRADE' },
  { id: 'CREDITS', label: 'CREDITS' }
]

export default function CommandIsland({
  tab,
  onTab,
  theme,
  onThemeChange,
  onSaveProject,
  onLoadProject,
  onExport,
  exportSettings
}: {
  tab: Tab
  onTab: (t: Tab) => void
  theme: ThemeId
  onThemeChange: (t: ThemeId) => void
  onSaveProject: () => void
  onLoadProject: () => void
  onExport: () => void
  exportSettings: ExportSettings
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ind, setInd] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const el = refs.current[tab]
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
  }, [tab])

  const resLabel =
    exportSettings.resolution === '4k'
      ? '4K'
      : exportSettings.resolution === 'vertical'
        ? '1080×1920'
        : '1080p'

  return (
    <header className="glass flex shrink-0 items-center justify-between gap-3 px-3 py-1.5">
      {/* Sol Köşe: Marka, Proje İşlemleri ve Sekmeler */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 pr-1">
          <span className="h-2 w-2 rounded-full bg-[#71717A]" />
          <span className="text-[11px] font-bold tracking-[0.34em] text-[#E4E4E7]">NOIRCUT</span>
        </div>

        <div className="flex items-center gap-1.5 border-l border-r border-[color:var(--border-subtle)] px-2.5">
          <button
            data-testid="load-project-btn"
            onClick={onLoadProject}
            title="Proje Aç (Ctrl+O)"
            className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[var(--text-muted)] transition hover:border-white/40 hover:text-white"
          >
            Proje Aç
          </button>
          <button
            data-testid="save-project-btn"
            onClick={onSaveProject}
            title="Projeyi Kaydet (Ctrl+S)"
            className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[var(--text-muted)] transition hover:border-white/40 hover:text-white"
          >
            Kaydet
          </button>
        </div>

        <nav className="relative flex items-center rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-app)] p-0.5 shadow-inner">
          <span
            className="absolute top-0.5 h-[calc(100%-4px)] rounded bg-[var(--accent)]/20 ring-1 ring-[var(--accent)] shadow-[0_0_16px_var(--accent-glow)] transition-all duration-300"
            style={{ left: ind.left, width: ind.width }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              onClick={() => onTab(t.id)}
              className={`relative z-10 rounded px-4 py-1 text-[11px] font-semibold tracking-[0.2em] transition-colors ${
                tab === t.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={onExport}
            className="relative z-10 rounded px-4 py-1 text-[11px] font-semibold tracking-[0.2em] text-[var(--text-muted)] transition-colors hover:text-white"
          >
            EXPORT
          </button>
        </nav>
      </div>

      {/* Sağ Köşe: Çözünürlük/FPS, Tema Seçici ve Hızlı Export */}
      <div className="flex items-center gap-2.5">
        <div
          className="hidden items-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] sm:flex"
          title={EXPORT_RESOLUTION_DIM[exportSettings.resolution].label}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
          <span>{resLabel}</span>
          <span className="text-white/25">·</span>
          <span>{exportSettings.fps} fps</span>
        </div>

        {/* Minimalist Tema Seçici */}
        <div
          data-testid="theme-switcher"
          className="flex items-center gap-1.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1"
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
                className={`h-3 w-3 rounded-full transition-transform ${
                  active
                    ? 'scale-125 ring-2 ring-white/85 ring-offset-1 ring-offset-[var(--bg-app)]'
                    : 'opacity-65 hover:scale-110 hover:opacity-100'
                }`}
                style={{ backgroundColor: t.swatch }}
              />
            )
          })}
        </div>

        <button
          data-testid="export-open-btn"
          onClick={onExport}
          className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] text-[var(--accent-fg)] shadow-[0_0_16px_var(--accent-glow)] ring-1 ring-[var(--accent-hover)] transition hover:bg-[var(--accent-hover)] active:scale-95"
        >
          EXPORT
        </button>
      </div>
    </header>
  )
}
