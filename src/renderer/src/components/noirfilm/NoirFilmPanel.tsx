import { useEffect, useState } from 'react'
import type { ColorGrade } from '../../../../shared/color'
import type { Lut3D } from '../../../../shared/lut'
import {
  cloneNoirFilmConfig,
  defaultChromaKey,
  defaultNoirFilmConfig,
  type NoirFilmConfig,
  type NoirLookPreset
} from '../../../../shared/noirfilm'
import BloomPanel from './BloomPanel'
import ChromaKeyPanel from './ChromaKeyPanel'
import DiffusionPanel from './DiffusionPanel'
import FilmEmulationPanel from './FilmEmulationPanel'
import FilmGrainPanel from './FilmGrainPanel'
import HalationPanel from './HalationPanel'
import {
  LookComparisonBar,
  type ComparisonMode
} from './LookComparisonViewer'
import LookPresetManager from './LookPresetManager'
import MistPanel from './MistPanel'
import { NoirSlider } from './NoirControls'
import NoirLookLibrary from './NoirLookLibrary'

export type NoirFilmSection =
  | 'looks'
  | 'film'
  | 'texture'
  | 'light'
  | 'chromakey'
  | 'mylooks'

const STORAGE_MY_LOOKS = 'noircut.noirfilm.mylooks.v1'
const STORAGE_FAVORITES = 'noircut.noirfilm.favorites.v1'

const NAV_TABS: Array<{ id: NoirFilmSection; label: string }> = [
  { id: 'looks', label: 'NOIR LOOKS' },
  { id: 'film', label: 'FILM EMULATION' },
  { id: 'texture', label: 'FILM TEXTURE' },
  { id: 'light', label: 'LIGHT EFFECTS' },
  { id: 'chromakey', label: 'CHROMA KEY' },
  { id: 'mylooks', label: 'MY LOOKS' }
]

export default function NoirFilmPanel({
  grade,
  customLuts,
  videoEl,
  compareMode,
  wipePercent,
  onGrade,
  onPreviewGrade,
  onApplyToTimeline,
  onImportLut,
  onRegisterImportedLut,
  onCompareMode,
  onWipePercent,
  onOpenFullscreenCompare
}: {
  grade: ColorGrade
  customLuts: Lut3D[]
  videoEl?: HTMLVideoElement | null
  compareMode: ComparisonMode
  wipePercent: number
  onGrade: (next: ColorGrade) => void
  onPreviewGrade: (preview: ColorGrade | null) => void
  onApplyToTimeline?: (targetGrade: ColorGrade) => void
  onImportLut: () => void
  onRegisterImportedLut?: (lut: Lut3D) => void
  onCompareMode: (m: ComparisonMode) => void
  onWipePercent: (n: number) => void
  onOpenFullscreenCompare: () => void
}) {
  const [section, setSection] = useState<NoirFilmSection>('looks')

  const [myLooks, setMyLooks] = useState<NoirLookPreset[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MY_LOOKS)
      return raw ? (JSON.parse(raw) as NoirLookPreset[]) : []
    } catch {
      return []
    }
  })

  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_FAVORITES)
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MY_LOOKS, JSON.stringify(myLooks))
    } catch {
      // Depolama doluysa yoksay
    }
  }, [myLooks])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FAVORITES, JSON.stringify(favoriteIds))
    } catch {
      // Depolama doluysa yoksay
    }
  }, [favoriteIds])

  const nf: NoirFilmConfig = cloneNoirFilmConfig(grade.noirFilm)

  const updateNf = (updater: (cur: NoirFilmConfig) => NoirFilmConfig) => {
    const nextNf = updater(cloneNoirFilmConfig(grade.noirFilm))
    onGrade({ ...grade, noirFilm: nextNf })
  }

  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
    setMyLooks((prev) =>
      prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p))
    )
  }

  const grainPct = nf.texture.enabled ? Math.round(nf.texture.amount) : 0
  const halationPct = nf.lightEffects.halation.enabled
    ? Math.round(nf.lightEffects.halation.intensity)
    : 0
  const bloomPct = nf.lightEffects.bloom.enabled
    ? Math.round(nf.lightEffects.bloom.intensity)
    : 0

  return (
    <div
      data-testid="noirfilm-panel"
      className="glass flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3.5"
    >
      {/* Üst Yüzen Hap Navigasyon + Karşılaştırma ve Uygulama Kontrolleri */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          data-testid="noirfilm-nav-pills"
          className="inline-flex items-center gap-1 rounded-full border border-[#343943]/80 bg-[#101114]/90 p-1 shadow-[0_6px_20px_rgba(0,0,0,0.4)]"
        >
          {NAV_TABS.map((t) => {
            const active = section === t.id
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`noirfilm-tab-${t.id}`}
                onClick={() => {
                  onPreviewGrade(null)
                  setSection(t.id)
                }}
                className={`rounded-full px-3.5 py-1 text-[10px] font-semibold tracking-wider transition-all duration-200 ${
                  active
                    ? 'scale-[1.02] bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_0_14px_var(--accent-glow)]'
                    : 'text-[#9298A3] hover:bg-[#242830] hover:text-[#F1F2EE]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <LookComparisonBar
          mode={compareMode}
          wipePercent={wipePercent}
          onMode={onCompareMode}
          onWipe={onWipePercent}
          onOpenFullscreen={onOpenFullscreenCompare}
        />

        <div className="flex items-center gap-1.5">
          {onApplyToTimeline && (
            <button
              type="button"
              data-testid="noirfilm-apply-all-btn"
              onClick={() => onApplyToTimeline(grade)}
              className="rounded-full bg-[#242830] px-3 py-1 text-[9.5px] font-semibold text-[#F1F2EE] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
              title="Aktif NoirFilm görünümünü timeline'daki tüm kliplere uygular"
            >
              Timeline&apos;a Uygula
            </button>
          )}
          <button
            type="button"
            data-testid="noirfilm-reset-btn"
            onClick={() =>
              onGrade({
                ...grade,
                lutId: null,
                noirFilm: defaultNoirFilmConfig()
              })
            }
            className="rounded-full bg-[#242830] px-3 py-1 text-[9.5px] font-medium text-[#9298A3] transition-colors hover:bg-[#292E36] hover:text-[#F1F2EE]"
          >
            Görünümü Sıfırla
          </button>
        </div>
      </div>

      {/* Look Intensity Ana Sürgü + Gerçek Zamanlı Telemetri Kartları (Referans Konsept) */}
      <div className="grid grid-cols-12 items-center gap-3 rounded-[16px] bg-[#1B1E24] px-3.5 py-2.5">
        <div className="col-span-6">
          <NoirSlider
            label="LOOK INTENSITY"
            testId="noirfilm-look-intensity"
            value={nf.lookIntensity}
            min={0}
            max={100}
            defaultValue={100}
            unit="%"
            onChange={(lookIntensity) =>
              updateNf((cur) => ({ ...cur, lookIntensity }))
            }
          />
        </div>
        <div className="col-span-2 rounded-[13px] bg-[#242830] px-3 py-1.5">
          <div className="text-[8.5px] font-semibold tracking-wider text-[#9298A3]">
            FILM GRAIN
          </div>
          <div className="font-mono text-[13px] font-bold text-[var(--accent)]">{grainPct}%</div>
        </div>
        <div className="col-span-2 rounded-[13px] bg-[#242830] px-3 py-1.5">
          <div className="text-[8.5px] font-semibold tracking-wider text-[#9298A3]">
            HALATION
          </div>
          <div className="font-mono text-[13px] font-bold text-[var(--accent)]">{halationPct}%</div>
        </div>
        <div className="col-span-2 rounded-[13px] bg-[#242830] px-3 py-1.5">
          <div className="text-[8.5px] font-semibold tracking-wider text-[#9298A3]">
            BLOOM
          </div>
          <div className="font-mono text-[13px] font-bold text-[var(--accent)]">{bloomPct}%</div>
        </div>
      </div>

      {/* Seçili Alt Modül İçeriği */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">
        {section === 'looks' && (
          <NoirLookLibrary
            grade={grade}
            customLuts={customLuts}
            customPresets={myLooks}
            favoriteIds={favoriteIds}
            videoEl={videoEl}
            onToggleFavorite={toggleFavorite}
            onPreviewLook={onPreviewGrade}
            onApplyLook={onGrade}
            onApplyLookToTimeline={onApplyToTimeline}
            onImportLut={onImportLut}
          />
        )}

        {section === 'film' && (
          <FilmEmulationPanel
            config={nf.filmEmulation}
            onChange={(filmEmulation) =>
              updateNf((cur) => ({ ...cur, filmEmulation }))
            }
          />
        )}

        {section === 'texture' && (
          <FilmGrainPanel
            config={nf.texture}
            onChange={(texture) => updateNf((cur) => ({ ...cur, texture }))}
          />
        )}

        {section === 'light' && (
          <div
            data-testid="noirfilm-light-effects-panel"
            className="grid grid-cols-2 gap-3"
          >
            <HalationPanel
              config={nf.lightEffects.halation}
              onChange={(halation) =>
                updateNf((cur) => ({
                  ...cur,
                  lightEffects: { ...cur.lightEffects, halation }
                }))
              }
            />
            <BloomPanel
              config={nf.lightEffects.bloom}
              onChange={(bloom) =>
                updateNf((cur) => ({
                  ...cur,
                  lightEffects: { ...cur.lightEffects, bloom }
                }))
              }
            />
            <DiffusionPanel
              config={nf.lightEffects.diffusion}
              onChange={(diffusion) =>
                updateNf((cur) => ({
                  ...cur,
                  lightEffects: { ...cur.lightEffects, diffusion }
                }))
              }
            />
            <MistPanel
              config={nf.lightEffects.mist}
              onChange={(mist) =>
                updateNf((cur) => ({
                  ...cur,
                  lightEffects: { ...cur.lightEffects, mist }
                }))
              }
            />
          </div>
        )}

        {section === 'chromakey' && (
          <ChromaKeyPanel
            config={nf.chromaKey ?? defaultChromaKey()}
            onChange={(chromaKey) =>
              updateNf((cur) => ({ ...cur, chromaKey }))
            }
          />
        )}

        {section === 'mylooks' && (
          <LookPresetManager
            currentGrade={grade}
            customLuts={customLuts}
            presets={myLooks}
            videoEl={videoEl}
            onSaveNew={(preset) => setMyLooks((prev) => [preset, ...prev])}
            onUpdateExisting={(id, nextGrade) =>
              setMyLooks((prev) =>
                prev.map((p) =>
                  p.id === id
                    ? { ...p, grade: nextGrade, updatedAt: new Date().toISOString() }
                    : p
                )
              )
            }
            onDuplicate={(id) =>
              setMyLooks((prev) => {
                const orig = prev.find((p) => p.id === id)
                if (!orig) return prev
                const now = new Date().toISOString()
                return [
                  {
                    ...orig,
                    id: `my-look-${Date.now().toString(36)}`,
                    name: `${orig.name} (Kopya)`,
                    createdAt: now,
                    updatedAt: now
                  },
                  ...prev
                ]
              })
            }
            onRename={(id, newName) =>
              setMyLooks((prev) =>
                prev.map((p) =>
                  p.id === id
                    ? { ...p, name: newName, updatedAt: new Date().toISOString() }
                    : p
                )
              )
            }
            onDelete={(id) => setMyLooks((prev) => prev.filter((p) => p.id !== id))}
            onToggleFavorite={toggleFavorite}
            onApplyPreset={(preset) =>
              onGrade({
                ...preset.grade,
                noirFilm: {
                  ...cloneNoirFilmConfig(preset.grade.noirFilm),
                  activeLookId: preset.id
                }
              })
            }
            onApplyToTimeline={onApplyToTimeline}
            onImportCubeLut={(lut) => onRegisterImportedLut?.(lut)}
          />
        )}
      </div>
    </div>
  )
}
