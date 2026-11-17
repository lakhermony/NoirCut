import { useMemo, useState } from 'react'
import type { ColorGrade } from '../../../../shared/color'
import type { Lut3D } from '../../../../shared/lut'
import {
  applyNoirLookToGrade,
  NOIR_LOOK_CATEGORIES,
  NOIR_LOOKS,
  type NoirLookCategory,
  type NoirLookDefinition,
  type NoirLookPreset
} from '../../../../shared/noirfilm'
import LookThumbnailCanvas from './LookThumbnailCanvas'

export default function NoirLookLibrary({
  grade,
  customLuts,
  customPresets,
  favoriteIds,
  videoEl,
  onToggleFavorite,
  onPreviewLook,
  onApplyLook,
  onApplyLookToTimeline,
  onImportLut
}: {
  grade: ColorGrade
  customLuts: Lut3D[]
  customPresets: NoirLookPreset[]
  favoriteIds: string[]
  videoEl?: HTMLVideoElement | null
  onToggleFavorite: (id: string) => void
  onPreviewLook: (previewGrade: ColorGrade | null) => void
  onApplyLook: (nextGrade: ColorGrade) => void
  onApplyLookToTimeline?: (nextGrade: ColorGrade) => void
  onImportLut: () => void
}) {
  const [selectedCategory, setSelectedCategory] = useState<NoirLookCategory | 'ALL' | 'FAVORITES'>('ALL')
  const [search, setSearch] = useState('')
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  const customAsLooks = useMemo<NoirLookDefinition[]>(
    () =>
      customPresets.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category || 'Custom Looks',
        description: p.description || 'Kullanıcı tarafından oluşturulan Noir Look',
        characteristics: ['Özel Kayıt', p.grade.lutId ? '3D LUT' : 'Grading', p.grade.noirFilm?.filmEmulation?.enabled ? p.grade.noirFilm.filmEmulation.format : 'Renk'],
        swatches: p.swatches,
        gradePatch: p.grade,
        noirFilm: p.grade.noirFilm ?? {}
      })),
    [customPresets]
  )

  const lutAsLooks = useMemo<NoirLookDefinition[]>(
    () =>
      customLuts.map((l) => ({
        id: `lut-look-${l.id}`,
        name: l.name,
        category: 'Custom Looks',
        description: l.desc || 'İçe aktarılan standart .cube 3D LUT görünümü.',
        characteristics: ['.cube 3D LUT', `${l.size}³ Grid`],
        swatches: [l.previewColors?.[0] ?? '#292E36', '#6B7280', l.previewColors?.[1] ?? '#B7E36A'],
        gradePatch: { lutId: l.id, lutIntensity: 85 },
        noirFilm: {}
      })),
    [customLuts]
  )

  const allLooks = useMemo(
    () => [...NOIR_LOOKS, ...customAsLooks, ...lutAsLooks],
    [customAsLooks, lutAsLooks]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allLooks.filter((look) => {
      if (selectedCategory === 'FAVORITES' && !favoriteIds.includes(look.id)) return false
      if (
        selectedCategory !== 'ALL' &&
        selectedCategory !== 'FAVORITES' &&
        look.category !== selectedCategory
      ) {
        return false
      }
      if (!q) return true
      return (
        look.name.toLowerCase().includes(q) ||
        look.category.toLowerCase().includes(q) ||
        look.description.toLowerCase().includes(q) ||
        look.characteristics.some((c) => c.toLowerCase().includes(q))
      )
    })
  }, [allLooks, selectedCategory, search, favoriteIds])

  const buildLookGrade = (look: NoirLookDefinition): ColorGrade => {
    const customMatch = customPresets.find((p) => p.id === look.id)
    if (customMatch) {
      return {
        ...customMatch.grade,
        noirFilm: {
          ...(customMatch.grade.noirFilm ?? {}),
          activeLookId: look.id,
          lookIntensity: grade.noirFilm?.lookIntensity ?? 100
        } as NonNullable<ColorGrade['noirFilm']>
      }
    }
    return applyNoirLookToGrade(grade, look, grade.noirFilm?.lookIntensity ?? 100)
  }

  const activeLookId = grade.noirFilm?.activeLookId ?? null

  return (
    <div data-testid="noirfilm-looks-library" className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* Arama + .cube İçe Aktar + Önizleme Sıfırla */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <input
            data-testid="noirfilm-look-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sinematik görünüm ara (ör. 35mm, Noir, Teal, Vintage...)"
            className="h-7 w-full max-w-[320px] rounded-full border border-[#343943] bg-[#1B1E24] px-3 text-[10.5px] text-[#F1F2EE] placeholder-[#9298A3] outline-none transition-colors focus:border-[#B7E36A]"
          />
          {previewingId && (
            <button
              type="button"
              onClick={() => {
                setPreviewingId(null)
                onPreviewLook(null)
              }}
              className="rounded-full bg-[#242830] px-2.5 py-1 text-[9.5px] font-medium text-[#B7E36A]"
            >
              Önizlemeyi Kapat
            </button>
          )}
        </div>

        <button
          type="button"
          data-testid="noirfilm-import-cube-btn"
          onClick={onImportLut}
          className="rounded-full bg-[#242830] px-3 py-1 text-[10px] font-semibold text-[#F1F2EE] transition-colors hover:bg-[#292E36] hover:text-[#B7E36A]"
        >
          + .cube LUT İçe Aktar
        </button>
      </div>

      {/* 12 Kategori Yüzen Hap Sekmeleri */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSelectedCategory('ALL')}
          className={`shrink-0 rounded-full px-3 py-1 text-[9.5px] font-semibold transition-all ${
            selectedCategory === 'ALL'
              ? 'bg-[#B7E36A] text-[#101114]'
              : 'bg-[#242830] text-[#9298A3] hover:text-[#F1F2EE]'
          }`}
        >
          Tümü ({allLooks.length})
        </button>
        <button
          type="button"
          onClick={() => setSelectedCategory('FAVORITES')}
          className={`shrink-0 rounded-full px-3 py-1 text-[9.5px] font-semibold transition-all ${
            selectedCategory === 'FAVORITES'
              ? 'bg-[#B7E36A] text-[#101114]'
              : 'bg-[#242830] text-[#9298A3] hover:text-[#F1F2EE]'
          }`}
        >
          ★ Favoriler ({favoriteIds.length})
        </button>
        {NOIR_LOOK_CATEGORIES.map((cat) => {
          const active = selectedCategory === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 rounded-full px-3 py-1 text-[9.5px] font-medium transition-all ${
                active
                  ? 'bg-[#B7E36A] text-[#101114] font-semibold'
                  : 'bg-[#242830] text-[#9298A3] hover:bg-[#292E36] hover:text-[#F1F2EE]'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {/* Görünüm Kartları Izgarası */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5 overflow-y-auto pr-1">
        {filtered.map((look) => {
          const isActive = activeLookId === look.id
          const isFav = favoriteIds.includes(look.id)
          const lookGrade = buildLookGrade(look)

          return (
            <div
              key={look.id}
              data-testid={`noir-look-card-${look.id}`}
              onMouseEnter={() => {
                setPreviewingId(look.id)
                onPreviewLook(lookGrade)
              }}
              onMouseLeave={() => {
                setPreviewingId(null)
                onPreviewLook(null)
              }}
              className={`inner-card group flex flex-col justify-between gap-2 p-2.5 transition-all duration-150 ${
                isActive
                  ? 'border border-[#B7E36A] bg-[#292E36] shadow-[0_0_16px_rgba(183,227,106,0.14)]'
                  : 'border border-[#343943]/60 bg-[#1B1E24] hover:border-[#9298A3]/40 hover:bg-[#242830]'
              }`}
            >
              {/* Gerçek Matematiksel Önizleme Küçük Resmi */}
              <div className="relative h-[74px] w-full overflow-hidden rounded-[10px] bg-[#101114]">
                <LookThumbnailCanvas
                  grade={lookGrade}
                  customLuts={customLuts}
                  videoEl={videoEl}
                />
                <div className="absolute inset-x-1.5 top-1.5 flex items-center justify-between">
                  <span className="rounded-full bg-[#101114]/80 px-2 py-0.5 text-[8px] font-medium text-[#F1F2EE] backdrop-blur-sm">
                    {look.category}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleFavorite(look.id)
                    }}
                    title={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                    className={`rounded-full bg-[#101114]/80 px-1.5 py-0.5 text-[10px] transition-transform hover:scale-110 ${
                      isFav ? 'text-[#B7E36A]' : 'text-[#9298A3]'
                    }`}
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
                <div className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-2 w-8 overflow-hidden rounded-full border border-white/20">
                  {look.swatches.map((sw, idx) => (
                    <span key={idx} className="flex-1" style={{ backgroundColor: sw }} />
                  ))}
                </div>
              </div>

              {/* İsim + Açıklama + Karakteristikler */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10.5px] font-semibold text-[#F1F2EE]">
                    {look.name}
                  </span>
                </div>
                <p className="line-clamp-2 text-[9px] leading-snug text-[#9298A3]">
                  {look.description}
                </p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {look.characteristics.slice(0, 3).map((ch) => (
                    <span
                      key={ch}
                      className="rounded-full bg-[#242830] px-1.5 py-0.5 text-[8px] text-[#9298A3]"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              {/* Uygula Butonları */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  data-testid={`apply-look-${look.id}`}
                  onClick={() => {
                    onPreviewLook(null)
                    onApplyLook(lookGrade)
                  }}
                  className={`flex-1 rounded-full py-1 text-[9.5px] font-semibold transition-all ${
                    isActive
                      ? 'bg-[#B7E36A] text-[#101114]'
                      : 'bg-[#292E36] text-[#F1F2EE] hover:bg-[#B7E36A] hover:text-[#101114]'
                  }`}
                >
                  {isActive ? 'Aktif Görünüm' : 'Klibe Uygula'}
                </button>
                {onApplyLookToTimeline && (
                  <button
                    type="button"
                    title="Tüm Timeline Kliplerine Uygula"
                    onClick={() => {
                      onPreviewLook(null)
                      onApplyLookToTimeline(lookGrade)
                    }}
                    className="rounded-full bg-[#242830] px-2.5 py-1 text-[9px] font-medium text-[#9298A3] transition-colors hover:bg-[#292E36] hover:text-[#F1F2EE]"
                  >
                    Tümü
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-3 flex h-32 items-center justify-center rounded-[13px] border border-dashed border-[#343943] text-[11px] text-[#9298A3]">
            Arama veya kategori kriterine uygun Noir Look bulunamadı.
          </div>
        )}
      </div>
    </div>
  )
}
