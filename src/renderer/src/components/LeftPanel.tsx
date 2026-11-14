import { useState } from 'react'
import { CREDIT_TEMPLATES, type CreditTemplateId } from '../../../shared/credits'
import { BUILTIN_LUTS, type Lut3D } from '../../../shared/lut'
import type { MediaItem } from '../../../shared/types'
import { fmtDuration } from '../lib/format'
import type { Tab } from '../types'

export const MEDIA_DRAG_TYPE = 'application/x-noircut-media'

export default function LeftPanel({
  tab,
  media,
  activeMediaId,
  busy,
  errors,
  onImport,
  onSelectMedia,
  onDismissErrors,
  activeLutId,
  lutIntensity,
  customLuts,
  onSelectLut,
  onLutIntensity,
  onImportLut,
  activeCreditTemplate,
  onSelectCreditTemplate
}: {
  tab: Tab
  media: MediaItem[]
  activeMediaId: string | null
  busy: boolean
  errors: string[]
  onImport: () => void
  onSelectMedia: (id: string) => void
  onDismissErrors: () => void
  activeLutId: string | null
  lutIntensity: number
  customLuts: Lut3D[]
  onSelectLut: (id: string | null) => void
  onLutIntensity: (v: number) => void
  onImportLut: () => void
  activeCreditTemplate: CreditTemplateId
  onSelectCreditTemplate: (id: CreditTemplateId) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const allLuts = [...BUILTIN_LUTS, ...customLuts]

  if (collapsed) {
    return (
      <aside className="glass flex h-full w-9 shrink-0 flex-col items-center py-3">
        <button
          data-testid="left-panel-expand"
          onClick={() => setCollapsed(false)}
          title="Sol Paneli Aç"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-app)] text-xs text-[var(--text-muted)] transition hover:border-white/40 hover:text-white"
        >
          »
        </button>
        <span className="mt-4 font-mono text-[9px] font-semibold tracking-[0.25em] text-[#71717A] [writing-mode:vertical-rl]">
          MEDYA & KÜTÜPHANE
        </span>
      </aside>
    )
  }

  return (
    <aside className="glass flex h-full w-[280px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <button
            data-testid="left-panel-collapse"
            onClick={() => setCollapsed(true)}
            title="Sol Paneli Gizle"
            className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--border-subtle)] bg-[var(--bg-app)] text-[11px] text-[var(--text-muted)] transition hover:border-white/40 hover:text-white"
          >
            «
          </button>
          <span className="panel-title">Medya</span>
        </div>
        <button className="chip" data-testid="import-btn" onClick={onImport} disabled={busy}>
          {busy ? 'Okunuyor…' : '+ İçe Aktar'}
        </button>
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

      <div className="max-h-[240px] min-h-[96px] overflow-y-auto px-3 pb-3">
        {media.length === 0 ? (
          <button
            onClick={onImport}
            className="flex h-[84px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-[11px] text-white/40 transition hover:border-tungsten/60 hover:text-white/70"
          >
            <span className="text-lg leading-none">+</span>
            MP4 · MOV · MKV seç
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {media.map((m) => {
              const isActive = m.id === activeMediaId
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
                  title={`${m.name}\n${m.width}×${m.height} · ${m.codec} · ${m.fps.toFixed(2)} fps`}
                  className={`cursor-pointer overflow-hidden rounded-lg border bg-black/30 transition ${
                    isActive
                      ? 'border-tungsten shadow-[0_0_14px_rgba(245,166,35,0.25)]'
                      : 'border-white/[0.07] hover:border-white/30'
                  }`}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-white/10 to-black">
                    {m.thumbnail && (
                      <img src={m.thumbnail} alt="" draggable={false} className="h-full w-full object-cover" />
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white/80">
                      {fmtDuration(m.duration)}
                    </span>
                  </div>
                  <div className="truncate px-2 py-1 text-[10px] text-white/60">{m.name}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mx-4 lens-divider">
        <span className="lens-divider-icon">▶</span>
      </div>
      {tab === 'CREDITS' ? (
        <>
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <span className="panel-title !text-tungsten/80">Jenerik Şablonları</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {CREDIT_TEMPLATES.map((tpl) => {
              const selected = activeCreditTemplate === tpl.id
              return (
                <button
                  key={tpl.id}
                  data-testid={`credit-tpl-${tpl.id}`}
                  onClick={() => onSelectCreditTemplate(tpl.id)}
                  className={`flex flex-col gap-1 rounded-lg border bg-black/35 p-2.5 text-left transition ${
                    selected
                      ? 'border-tungsten shadow-[0_0_14px_rgba(245,166,35,0.25)]'
                      : 'border-white/[0.07] hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-white/90">{tpl.name}</span>
                    <span className="shrink-0 rounded bg-tungsten/15 px-1.5 py-0.5 font-mono text-[8px] font-bold text-tungsten">
                      {tpl.badge}
                    </span>
                  </div>
                  <p className="text-[10px] leading-snug text-white/45">{tpl.description}</p>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <span className="panel-title">LUT Kütüphanesi</span>
            <button
              data-testid="import-lut-btn"
              className="chip"
              onClick={onImportLut}
              title="Bilgisayardan .cube 3D LUT içe aktar"
            >
              + .cube
            </button>
          </div>

          <div className="px-4 pb-2.5">
            <div className="mb-1 flex justify-between text-[10px] text-white/50">
              <span>LUT Yoğunluğu</span>
              <span className="font-mono text-tungsten">{Math.round(lutIntensity)}%</span>
            </div>
            <input
              data-testid="lut-intensity-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!activeLutId}
              value={lutIntensity}
              onChange={(e) => onLutIntensity(parseFloat(e.target.value))}
              className="w-full disabled:opacity-35"
            />
          </div>

          <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto px-3 pb-3">
            <button
              onClick={() => onSelectLut(null)}
              className={`overflow-hidden rounded-lg border text-left transition ${
                activeLutId === null
                  ? 'border-tungsten shadow-[0_0_14px_rgba(245,166,35,0.25)]'
                  : 'border-white/[0.07] hover:border-white/30'
              }`}
            >
              <div className="flex h-9 items-center justify-center bg-black/50 text-[10px] text-white/40">
                Ham (LUT Yok)
              </div>
              <div className="truncate bg-black/30 px-2 py-1 text-[10px] text-white/60">Orijinal</div>
            </button>

            {allLuts.map((l) => {
              const [cA, cB] = l.previewColors ?? ['#2c303a', '#f5a623']
              return (
                <button
                  key={l.id}
                  data-testid={`lut-card-${l.id}`}
                  onClick={() => onSelectLut(l.id)}
                  title={l.name}
                  className={`relative overflow-hidden rounded-lg border text-left transition ${
                    activeLutId === l.id
                      ? 'border-tungsten shadow-[0_0_14px_rgba(245,166,35,0.25)]'
                      : 'border-white/[0.07] hover:border-white/30'
                  }`}
                >
                  <div className="h-9" style={{ background: `linear-gradient(90deg, ${cA}, ${cB})` }} />
                  {!l.isBuiltIn && (
                    <span className="absolute right-1 top-1 rounded bg-black/75 px-1 font-mono text-[8px] text-tungsten">
                      .cube
                    </span>
                  )}
                  <div className="truncate bg-black/30 px-2 py-1 text-[10px] text-white/75">{l.name}</div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}
