import { useState } from 'react'
import { bakeColorGradeToCube, cloneColorGrade, type ColorGrade } from '../../../../shared/color'
import { parseCubeLut, type Lut3D } from '../../../../shared/lut'
import {
  NOIR_LOOK_CATEGORIES,
  parseNoirLookFile,
  serializeNoirLookFile,
  type NoirLookCategory,
  type NoirLookPreset
} from '../../../../shared/noirfilm'
import LookThumbnailCanvas from './LookThumbnailCanvas'

export default function LookPresetManager({
  currentGrade,
  customLuts,
  presets,
  videoEl,
  onSaveNew,
  onUpdateExisting,
  onDuplicate,
  onRename,
  onDelete,
  onToggleFavorite,
  onApplyPreset,
  onApplyToTimeline,
  onImportCubeLut
}: {
  currentGrade: ColorGrade
  customLuts: Lut3D[]
  presets: NoirLookPreset[]
  videoEl?: HTMLVideoElement | null
  onSaveNew: (preset: NoirLookPreset) => void
  onUpdateExisting: (id: string, nextGrade: ColorGrade) => void
  onDuplicate: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onToggleFavorite: (id: string) => void
  onApplyPreset: (preset: NoirLookPreset) => void
  onApplyToTimeline?: (grade: ColorGrade) => void
  onImportCubeLut: (lut: Lut3D) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<NoirLookCategory>('Custom Looks')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(null), 2600)
  }

  const handleSaveNew = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim() || `Noir Look ${presets.length + 1}`
    const now = new Date().toISOString()
    const preset: NoirLookPreset = {
      id: `my-look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: cleanName,
      category,
      description:
        description.trim() ||
        'Color Wheels, Curves, LUT, Film Emulation, Texture ve Işık efektlerini içeren özel Noir Look.',
      createdAt: now,
      updatedAt: now,
      favorite: false,
      swatches: ['#1B1E24', '#4B5563', '#B7E36A'],
      grade: cloneColorGrade(currentGrade)
    }
    onSaveNew(preset)
    setName('')
    setDescription('')
    showToast(`"${cleanName}" My Looks kütüphanesine kaydedildi.`)
  }

  const exportTextDownload = async (
    filename: string,
    content: string,
    filterName: string,
    ext: string
  ) => {
    if (window.noircut?.saveTextFile) {
      const res = await window.noircut.saveTextFile(filename, content, filterName, ext)
      if (res.ok) showToast(`Dışa aktarıldı: ${filename}`)
      else if (!res.canceled && res.error) showToast(`Hata: ${res.error}`)
      return
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    showToast(`İndirildi: ${filename}`)
  }

  const handleExportNoirLook = (p: NoirLookPreset) => {
    const safeName = p.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'NoirLook'
    exportTextDownload(
      `${safeName}.noirlook`,
      serializeNoirLookFile(p),
      'NoirCut Noir Look (.noirlook)',
      'noirlook'
    )
  }

  const handleExportCube = (p: NoirLookPreset) => {
    const customMap: Record<string, Lut3D> = {}
    for (const l of customLuts) customMap[l.id] = l
    const cube = bakeColorGradeToCube(p.grade, customMap, 33)
    const safeName = p.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'NoirLook'
    exportTextDownload(`${safeName}.cube`, cube, '3D LUT (.cube)', 'cube')
  }

  const handleImportLook = async () => {
    if (!window.noircut?.openLookFile) return
    const res = await window.noircut.openLookFile()
    if (res.canceled || !res.content) {
      if (res.error) showToast(`Hata: ${res.error}`)
      return
    }
    try {
      if (res.ext === 'cube') {
        const lutId = `custom-${Date.now().toString(36)}`
        const lut = parseCubeLut(res.content, lutId, res.name || 'Imported LUT')
        onImportCubeLut(lut)
        const now = new Date().toISOString()
        const gradeWithLut = cloneColorGrade(currentGrade)
        gradeWithLut.lutId = lut.id
        gradeWithLut.lutIntensity = 100
        onSaveNew({
          id: `my-look-${Date.now().toString(36)}`,
          name: lut.name,
          category: 'Custom Looks',
          description: '.cube LUT dosyasından içe aktarılan görünüm.',
          createdAt: now,
          updatedAt: now,
          favorite: false,
          swatches: ['#1F242D', '#5E6AD2', '#B7E36A'],
          grade: gradeWithLut
        })
        showToast(`.cube LUT "${lut.name}" içe aktarıldı.`)
      } else {
        const imported = parseNoirLookFile(res.content)
        onSaveNew(imported)
        showToast(`"${imported.name}" .noirlook içe aktarıldı.`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div data-testid="noirfilm-mylooks-panel" className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* Yeni Look Kaydetme Formu */}
      <form
        onSubmit={handleSaveNew}
        className="inner-card flex flex-wrap items-center gap-2 p-2.5"
      >
        <input
          data-testid="mylook-name-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Yeni Noir Look adı..."
          className="h-7 min-w-[160px] flex-1 rounded-full border border-[#343943] bg-[#1B1E24] px-3 text-[10.5px] text-[#F1F2EE] placeholder-[#9298A3] outline-none focus:border-[var(--accent)]"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Kısa açıklama (opsiyonel)"
          className="h-7 min-w-[160px] flex-1 rounded-full border border-[#343943] bg-[#1B1E24] px-3 text-[10.5px] text-[#F1F2EE] placeholder-[#9298A3] outline-none focus:border-[var(--accent)]"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as NoirLookCategory)}
          className="h-7 rounded-full border border-[#343943] bg-[#1B1E24] px-2.5 text-[10px] text-[#F1F2EE] outline-none"
        >
          {NOIR_LOOK_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-[#1B1E24]">
              {c}
            </option>
          ))}
        </select>
        <button
          type="submit"
          data-testid="mylook-save-btn"
          className="h-7 rounded-full bg-[var(--accent)] px-3.5 text-[10px] font-semibold text-[var(--accent-fg)] transition-transform hover:scale-[1.02] active:scale-95"
        >
          + Yeni Look Kaydet
        </button>
        <button
          type="button"
          data-testid="mylook-import-btn"
          onClick={handleImportLook}
          className="h-7 rounded-full bg-[#242830] px-3 text-[10px] font-medium text-[#F1F2EE] transition-colors hover:bg-[#292E36]"
        >
          İçe Aktar (.noirlook / .cube)
        </button>
      </form>

      {statusMsg && (
        <div className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[10px] font-medium text-[var(--accent)]">
          {statusMsg}
        </div>
      )}

      {/* Kayıtlı My Looks Listesi */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5 overflow-y-auto pr-1">
        {presets.map((p) => (
          <div
            key={p.id}
            data-testid={`mylook-card-${p.id}`}
            className="inner-card flex gap-2.5 p-2.5"
          >
            <div className="h-[68px] w-[108px] shrink-0 overflow-hidden rounded-[10px] bg-[#101114]">
              <LookThumbnailCanvas grade={p.grade} customLuts={customLuts} videoEl={videoEl} />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
              <div className="flex items-start justify-between gap-1">
                {editingId === p.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      type="text"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      autoFocus
                      className="h-6 flex-1 rounded-full border border-[var(--accent)] bg-[#1B1E24] px-2 text-[10px] text-[#F1F2EE] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (renameText.trim()) onRename(p.id, renameText.trim())
                        setEditingId(null)
                      }}
                      className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[9px] font-semibold text-[var(--accent-fg)]"
                    >
                      Kaydet
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[10.5px] font-semibold text-[#F1F2EE]">
                        {p.name}
                      </span>
                      <span className="rounded-full bg-[#242830] px-1.5 py-0.5 text-[8px] text-[#9298A3]">
                        {p.category}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[9px] text-[#9298A3]">{p.description}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onToggleFavorite(p.id)}
                  className={`text-[11px] ${p.favorite ? 'text-[var(--accent)]' : 'text-[#9298A3]'}`}
                  title="Favori"
                >
                  {p.favorite ? '★' : '☆'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApplyPreset(p)}
                  className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[9px] font-semibold text-[var(--accent-fg)]"
                >
                  Uygula
                </button>
                {onApplyToTimeline && (
                  <button
                    type="button"
                    onClick={() => onApplyToTimeline(p.grade)}
                    className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#F1F2EE] hover:bg-[#292E36]"
                  >
                    Tümü
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onUpdateExisting(p.id, cloneColorGrade(currentGrade))
                    showToast(`"${p.name}" mevcut ayarlarla güncellendi.`)
                  }}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
                >
                  Güncelle
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(p.id)}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
                >
                  Çoğalt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(p.id)
                    setRenameText(p.name)
                  }}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
                >
                  Adlandır
                </button>
                <button
                  type="button"
                  onClick={() => handleExportNoirLook(p)}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[var(--accent)]"
                >
                  .noirlook
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCube(p)}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[var(--accent)]"
                >
                  .cube
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="rounded-full bg-[#242830] px-2 py-0.5 text-[9px] text-rose-400/80 hover:bg-rose-500/20"
                >
                  Sil
                </button>
              </div>
            </div>
          </div>
        ))}

        {presets.length === 0 && (
          <div className="col-span-2 flex h-28 flex-col items-center justify-center gap-1 rounded-[13px] border border-dashed border-[#343943] text-[10.5px] text-[#9298A3]">
            <span>Henüz kayıtlı özel Noir Look bulunmuyor.</span>
            <span className="text-[9.5px] text-[#9298A3]/75">
              Yukarıdaki formdan aktif Color Wheels, Curves, Film Emülasyonu ve Işık Efektlerinizi kaydedebilirsiniz.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
