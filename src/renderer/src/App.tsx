import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cloneColorGrade,
  defaultColorGrade,
  type ColorGrade
} from '../../shared/color'
import {
  cloneCreditConfig,
  defaultCreditConfig,
  type CreditConfig,
  type CreditTemplateId
} from '../../shared/credits'
import { BUILTIN_LUTS, type Lut3D } from '../../shared/lut'
import {
  EXPORT_RESOLUTION_DIM,
  clipAt,
  clipEnd,
  defaultExportSettings,
  defaultLanes,
  isLaneAudible,
  projectEnd,
  type CreditExportOverlay,
  type ExportSettings,
  type LaneId,
  type LaneMap,
  type TimelineClip
} from '../../shared/timeline'
import type { NoirCutProject } from '../../shared/project'
import type { EngineInfo, MediaItem } from '../../shared/types'
import CommandIsland from './components/CommandIsland'
import ExportModal from './components/ExportModal'
import LeftPanel from './components/LeftPanel'
import Monitor from './components/Monitor'
import RightPanel from './components/RightPanel'
import Timeline from './components/Timeline'
import { useMediaLibrary } from './hooks/useMediaLibrary'
import { usePlayer } from './hooks/usePlayer'
import { renderCreditToPng } from './lib/credit-export'
import { THEME_OPTIONS, type Tab, type ThemeId } from './types'

const THEME_STORAGE_KEY = 'noircut-theme'

function getInitialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && THEME_OPTIONS.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // ignore storage errors
  }
  return 'noir-green'
}

export default function App() {
  const [tab, setTab] = useState<Tab>('GRADE')
  const [theme, setTheme] = useState<ThemeId>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // ignore storage errors
    }
  }, [theme])
  const [fallbackGrade, setFallbackGrade] = useState<ColorGrade>(defaultColorGrade)
  const [customLuts, setCustomLuts] = useState<Record<string, Lut3D>>({})
  const [draftCredit, setDraftCredit] = useState<CreditConfig>(() =>
    defaultCreditConfig('noir-opening')
  )
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [clips, setClips] = useState<TimelineClip[]>([])
  const [lanes, setLanes] = useState<LaneMap>(defaultLanes)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportResultPath, setExportResultPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [statusToast, setStatusToast] = useState<string | null>(null)
  const nextId = useRef(100)
  const skipNextAutoPlaceRef = useRef(false)

  const lib = useMediaLibrary()
  const mediaMap = useMemo(() => new Map(lib.items.map((m) => [m.id, m])), [lib.items])
  const player = usePlayer(clips, lanes, lib.items)

  const makeClip = useCallback(
    (m: MediaItem, lane: LaneId, start: number): TimelineClip => ({
      id: `clip-${nextId.current++}`,
      mediaId: m.id,
      lane,
      name: m.name,
      start,
      in: 0,
      duration: m.duration,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      audioDetached: false,
      grade: lane === 'V1' ? defaultColorGrade() : undefined
    }),
    []
  )

  useEffect(() => {
    window.noircut?.getEngineInfo().then(setEngine)
  }, [])

  // Pencere dışından dosya sürükle-bırak yapıldığında tarayıcı gezinmesini engelle
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      e.preventDefault()
    }
    window.addEventListener('dragover', preventNav)
    window.addEventListener('drop', preventNav)
    return () => {
      window.removeEventListener('dragover', preventNav)
      window.removeEventListener('drop', preventNav)
    }
  }, [])

  useEffect(() => {
    if (!window.noircut?.onExportProgress) return
    return window.noircut.onExportProgress(setExportProgress)
  }, [])

  // Aktif medya değişince timeline'a tek klip olarak yerleştir (proje yükleme hariç)
  useEffect(() => {
    if (skipNextAutoPlaceRef.current) {
      skipNextAutoPlaceRef.current = false
      return
    }
    const m = lib.active
    setSelectedClipId(null)
    setClips(m ? [makeClip(m, 'V1', 0)] : [])
  }, [lib.active, makeClip])

  const total = useMemo(() => {
    const end = projectEnd(clips)
    return end > 0 ? end : (lib.active?.duration ?? 0)
  }, [clips, lib.active])

  // Renk düzenleme hedef klibi: seçili V1 klibi -> playhead'deki V1 klibi -> ilk V1 klibi
  const targetGradeClip = useMemo(() => {
    if (selectedClipId) {
      const sel = clips.find((c) => c.id === selectedClipId && c.lane === 'V1')
      if (sel) return sel
    }
    return clipAt(clips, 'V1', player.time) ?? clips.find((c) => c.lane === 'V1') ?? null
  }, [clips, selectedClipId, player.time])

  const activeGrade: ColorGrade = useMemo(
    () => targetGradeClip?.grade ?? fallbackGrade,
    [targetGradeClip, fallbackGrade]
  )

  const updateActiveGrade = useCallback(
    (next: ColorGrade) => {
      if (!targetGradeClip) {
        setFallbackGrade(next)
        return
      }
      const targetId = targetGradeClip.id
      setClips((cs) => cs.map((c) => (c.id === targetId ? { ...c, grade: cloneColorGrade(next) } : c)))
    },
    [targetGradeClip]
  )

  const activeLut: Lut3D | null = useMemo(() => {
    if (!activeGrade.lutId) return null
    return (
      customLuts[activeGrade.lutId] ??
      BUILTIN_LUTS.find((l) => l.id === activeGrade.lutId) ??
      null
    )
  }, [activeGrade.lutId, customLuts])

  const handleImportLut = useCallback(async () => {
    if (!window.noircut?.importLut) return
    const res = await window.noircut.importLut()
    if (res.canceled) return
    if (res.error) {
      alert(`LUT içe aktarılamadı: ${res.error}`)
      return
    }
    if (res.lut) {
      const imported = res.lut
      setCustomLuts((prev) => ({ ...prev, [imported.id]: imported }))
      updateActiveGrade({ ...activeGrade, lutId: imported.id })
    }
  }, [activeGrade, updateActiveGrade])

  // Playhead konumundan klip bölme (Razor / C)
  const cut = useCallback(() => {
    const t = player.time
    setClips((cs) => {
      const canSplit = (c: TimelineClip) => t > c.start + 0.05 && t < clipEnd(c) - 0.05
      const selected = selectedClipId ? cs.find((c) => c.id === selectedClipId && canSplit(c)) : undefined
      const targets = selected ? [selected] : cs.filter(canSplit)
      if (targets.length === 0) return cs

      const targetIds = new Set(targets.map((c) => c.id))
      return cs.flatMap((c) => {
        if (!targetIds.has(c.id)) return [c]
        const leftDur = t - c.start
        const rightDur = clipEnd(c) - t
        const left: TimelineClip = {
          ...c,
          duration: leftDur,
          fadeIn: Math.min(c.fadeIn, leftDur),
          fadeOut: 0,
          grade: c.grade ? cloneColorGrade(c.grade) : undefined
        }
        const right: TimelineClip = {
          ...c,
          id: `clip-${nextId.current++}`,
          start: t,
          in: c.in + leftDur,
          duration: rightDur,
          fadeIn: 0,
          fadeOut: Math.min(c.fadeOut, rightDur),
          grade: c.grade ? cloneColorGrade(c.grade) : undefined
        }
        return [left, right]
      })
    })
  }, [player.time, selectedClipId])

  // Seçili klibi silme (Delete / Backspace)
  const deleteSelected = useCallback(() => {
    if (!selectedClipId) return
    setClips((cs) => cs.filter((c) => c.id !== selectedClipId))
    setSelectedClipId(null)
  }, [selectedClipId])

  const detachSelected = useCallback(() => {
    if (!selectedClipId) return
    setClips((cs) => {
      const target = cs.find((c) => c.id === selectedClipId)
      if (!target || target.lane !== 'V1' || target.audioDetached) return cs
      const audioClip: TimelineClip = {
        ...target,
        id: `clip-${nextId.current++}`,
        lane: 'A1',
        audioDetached: false,
        grade: undefined
      }
      return cs.map((c) => (c.id === target.id ? { ...c, audioDetached: true } : c)).concat(audioClip)
    })
  }, [selectedClipId])

  const updateClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const toggleMute = useCallback((lane: LaneId) => {
    setLanes((ls) => ({ ...ls, [lane]: { ...ls[lane], muted: !ls[lane].muted } }))
  }, [])

  const toggleSolo = useCallback((lane: LaneId) => {
    setLanes((ls) => ({ ...ls, [lane]: { ...ls[lane], solo: !ls[lane].solo } }))
  }, [])

  const dropMediaToLane = useCallback(
    (mediaId: string, lane: LaneId) => {
      const m = mediaMap.get(mediaId)
      if (!m) return
      setClips((cs) => {
        const laneEnd = cs.filter((c) => c.lane === lane).reduce((max, c) => Math.max(max, clipEnd(c)), 0)
        return [...cs, makeClip(m, lane, laneEnd)]
      })
    },
    [mediaMap, makeClip]
  )

  const selectedV2Clip = useMemo(
    () => (selectedClipId ? clips.find((c) => c.id === selectedClipId && c.lane === 'V2') ?? null : null),
    [clips, selectedClipId]
  )

  const activeCredit = selectedV2Clip?.credit ?? draftCredit

  const handleSelectCreditTemplate = useCallback(
    (templateId: CreditTemplateId) => {
      const fresh = defaultCreditConfig(templateId)
      if (selectedV2Clip) {
        setClips((cs) =>
          cs.map((c) =>
            c.id === selectedV2Clip.id
              ? { ...c, name: fresh.title || templateId, duration: fresh.duration, credit: fresh }
              : c
          )
        )
      } else {
        setDraftCredit(fresh)
      }
    },
    [selectedV2Clip]
  )

  const handleUpdateCredit = useCallback(
    (next: CreditConfig) => {
      if (selectedV2Clip) {
        setClips((cs) =>
          cs.map((c) =>
            c.id === selectedV2Clip.id
              ? {
                  ...c,
                  name: next.title || next.templateId,
                  duration: next.duration,
                  credit: cloneCreditConfig(next)
                }
              : c
          )
        )
      } else {
        setDraftCredit(next)
      }
    },
    [selectedV2Clip]
  )

  const handleAddCreditToTimeline = useCallback(() => {
    const cfg = cloneCreditConfig(activeCredit)
    const id = `clip-${nextId.current++}`
    setClips((cs) => {
      const v2Clips = cs.filter((c) => c.lane === 'V2')
      const startAtPlayhead = player.time
      const overlaps = v2Clips.some(
        (c) => startAtPlayhead < clipEnd(c) && startAtPlayhead + cfg.duration > c.start
      )
      const start = overlaps
        ? v2Clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
        : startAtPlayhead

      const newClip: TimelineClip = {
        id,
        mediaId: '__credit__',
        lane: 'V2',
        name: cfg.title.trim() || cfg.templateId,
        start,
        in: 0,
        duration: cfg.duration,
        gainDb: 0,
        fadeIn: 0,
        fadeOut: 0,
        audioDetached: false,
        credit: cfg
      }
      return [...cs, newClip]
    })
    setSelectedClipId(id)
  }, [activeCredit, player.time])

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg)
    window.setTimeout(() => {
      setStatusToast((cur) => (cur === msg ? null : cur))
    }, 3000)
  }, [])

  const handleSaveProject = useCallback(async () => {
    if (!window.noircut?.saveProject) return
    const project: NoirCutProject = {
      version: 1,
      savedAt: new Date().toISOString(),
      activeMediaId: lib.activeId,
      mediaRefs: lib.items.map((m) => ({ id: m.id, path: m.path })),
      clips,
      lanes,
      customLuts,
      draftCredit,
      fallbackGrade,
      exportSettings
    }
    const res = await window.noircut.saveProject(project)
    if (res.canceled) return
    if (res.ok) {
      showToast(`Proje kaydedildi: ${res.path?.split(/[\\/]/).pop() ?? ''}`)
    } else {
      alert(`Proje kaydedilemedi:\n${res.error ?? 'Bilinmeyen hata'}`)
    }
  }, [
    clips,
    customLuts,
    draftCredit,
    exportSettings,
    fallbackGrade,
    lanes,
    lib.activeId,
    lib.items,
    showToast
  ])

  const handleLoadProject = useCallback(async () => {
    if (!window.noircut?.loadProject) return
    const res = await window.noircut.loadProject()
    if (res.canceled) return
    if (!res.ok || !res.project) {
      alert(`Proje açılamadı:\n${res.error ?? 'Bilinmeyen hata'}`)
      return
    }
    const proj = res.project
    skipNextAutoPlaceRef.current = true
    lib.replaceAll(res.mediaItems ?? [], proj.activeMediaId ?? null)
    setClips(proj.clips ?? [])
    setLanes(proj.lanes ?? defaultLanes())
    setCustomLuts(proj.customLuts ?? {})
    setDraftCredit(proj.draftCredit ?? defaultCreditConfig('noir-opening'))
    setFallbackGrade(proj.fallbackGrade ?? defaultColorGrade())
    if (proj.exportSettings) setExportSettings(proj.exportSettings)
    setSelectedClipId(null)
    player.seek(0)

    if (res.mediaErrors && res.mediaErrors.length > 0) {
      alert(`Bazı medya dosyaları bulunamadı:\n${res.mediaErrors.join('\n')}`)
    }
    showToast(`Proje yüklendi: ${res.path?.split(/[\\/]/).pop() ?? ''}`)
  }, [lib, player, showToast])

  const handleStartExport = useCallback(async () => {
    if (exporting || !window.noircut?.exportProject) return
    setExporting(true)
    setExportProgress(0)
    setExportResultPath(null)
    setExportError(null)
    try {
      const { width, height } = EXPORT_RESOLUTION_DIM[exportSettings.resolution]
      const creditOverlays: Record<string, CreditExportOverlay> = {}
      for (const c of clips) {
        if (c.lane === 'V2' && c.credit) {
          creditOverlays[c.id] = renderCreditToPng(c.credit, width, height)
        }
      }
      const res = await window.noircut.exportProject({
        clips,
        lanes,
        customLuts,
        creditOverlays,
        settings: exportSettings
      })
      if (res.canceled) return
      if (res.ok && res.path) {
        setExportResultPath(res.path)
      } else {
        setExportError(res.error ?? 'Bilinmeyen hata')
      }
    } finally {
      setExporting(false)
    }
  }, [clips, customLuts, exportSettings, exporting, lanes])

  // Klavye: Space = oynat/durdur, C = kes, Delete/Backspace = seçili klibi sil
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
      if (el.tagName === 'INPUT') {
        const type = (el as HTMLInputElement).type
        return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button'
      }
      return false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveProject()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleLoadProject()
        return
      }
      if (isTyping(e.target) || e.repeat) return
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        cut()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [cut, deleteSelected, handleLoadProject, handleSaveProject, player.toggle])

  const engineLabel = !engine
    ? 'Motor kontrol ediliyor…'
    : engine.source === 'missing'
      ? 'FFmpeg bulunamadı'
      : `FFmpeg ${engine.version} · ${engine.source === 'embedded' ? 'gömülü' : 'sistem'} · ${engine.platform}`

  const monitorMedia = player.currentMedia ?? lib.active

  const activeV2Clip = useMemo(
    () => (isLaneAudible(lanes, 'V2') ? clipAt(clips, 'V2', player.time) : undefined),
    [clips, lanes, player.time]
  )

  const monitorCreditOverlay = useMemo(() => {
    if (activeV2Clip?.credit) {
      return {
        credit: activeV2Clip.credit,
        localTime: player.time - activeV2Clip.start,
        duration: activeV2Clip.duration,
        isPreview: false
      }
    }
    if (tab === 'CREDITS') {
      const dur = Math.max(0.5, activeCredit.duration)
      return {
        credit: activeCredit,
        localTime: player.time % dur,
        duration: dur,
        isPreview: true
      }
    }
    return null
  }, [activeV2Clip, activeCredit, player.time, tab])

  return (
    <div className="relative flex h-full flex-col gap-3 p-3">
      <CommandIsland
        tab={tab}
        onTab={setTab}
        theme={theme}
        onThemeChange={setTheme}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        exportSettings={exportSettings}
        onExport={() => {
          setExportResultPath(null)
          setExportError(null)
          setExportOpen(true)
        }}
      />

      {statusToast && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full border border-tungsten/50 bg-black/85 px-4 py-1.5 font-mono text-[11px] text-tungsten shadow-lg">
          {statusToast}
        </div>
      )}

      <ExportModal
        open={exportOpen}
        settings={exportSettings}
        onSettings={setExportSettings}
        exporting={exporting}
        progress={exportProgress}
        resultPath={exportResultPath}
        error={exportError}
        onStart={handleStartExport}
        onCancel={() => window.noircut?.cancelExport()}
        onClose={() => setExportOpen(false)}
        onReveal={(p) => window.noircut?.revealInFolder(p)}
      />

      <audio ref={player.audioA1Ref} className="hidden" preload="auto" />
      <audio ref={player.audioA2Ref} className="hidden" preload="auto" />

      <div className="flex min-h-0 flex-1 gap-3">
        <LeftPanel
          tab={tab}
          media={lib.items}
          activeMediaId={lib.activeId}
          busy={lib.busy}
          errors={lib.errors}
          onImport={lib.importMedia}
          onSelectMedia={lib.setActiveId}
          onDismissErrors={lib.clearErrors}
          activeLutId={activeGrade.lutId}
          lutIntensity={activeGrade.lutIntensity}
          customLuts={Object.values(customLuts)}
          onSelectLut={(lutId) => updateActiveGrade({ ...activeGrade, lutId })}
          onLutIntensity={(lutIntensity) => updateActiveGrade({ ...activeGrade, lutIntensity })}
          onImportLut={handleImportLut}
          activeCreditTemplate={activeCredit.templateId}
          onSelectCreditTemplate={handleSelectCreditTemplate}
        />
        <Monitor
          media={monitorMedia}
          videoProps={player.videoProps}
          videoRef={player.videoRef}
          error={player.error}
          playing={player.playing}
          time={player.time}
          duration={player.duration || total}
          onToggle={player.toggle}
          onSeek={player.seek}
          onScrubStart={player.beginScrub}
          onScrubEnd={player.endScrub}
          onDropMedia={lib.setActiveId}
          grade={activeGrade}
          activeLut={activeLut}
          creditOverlay={monitorCreditOverlay}
        />
        <RightPanel
          tab={tab}
          grade={activeGrade}
          activeClipName={targetGradeClip?.name ?? null}
          onGrade={updateActiveGrade}
          credit={activeCredit}
          onCredit={handleUpdateCredit}
          onAddCreditToTimeline={handleAddCreditToTimeline}
        />
      </div>

      <Timeline
        clips={clips}
        mediaMap={mediaMap}
        peaksMap={lib.peaksMap}
        lanes={lanes}
        selectedClipId={selectedClipId}
        total={total}
        time={player.time}
        fps={monitorMedia?.fps || 25}
        playing={player.playing}
        canPlay={clips.length > 0 || !!lib.active}
        onSeek={player.seek}
        onScrubStart={player.beginScrub}
        onScrubEnd={player.endScrub}
        onPlay={player.toggle}
        onCut={cut}
        onDeleteSelected={deleteSelected}
        onDetachSelected={detachSelected}
        onSelectClip={setSelectedClipId}
        onUpdateClip={updateClip}
        onToggleMute={toggleMute}
        onToggleSolo={toggleSolo}
        onDropMediaToLane={dropMediaToLane}
      />

      <div className="pointer-events-none absolute bottom-[3px] right-5 flex items-center gap-1.5 font-mono text-[9px] text-white/30">
        <span className={`h-1.5 w-1.5 rounded-full ${engine?.source === 'missing' ? 'bg-crimson' : 'bg-tungsten'}`} />
        {engineLabel}
      </div>
    </div>
  )
}
