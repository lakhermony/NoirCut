import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cloneColorGrade,
  computeAutoWhiteBalance,
  computeWhiteBalanceFromRgb,
  defaultColorGrade,
  evaluateColorGrade,
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
  NOIR_SOUNDSCAPE_PRESETS,
  clipAt,
  clipEnd,
  clipEndExact,
  cloneKeyframes,
  defaultClipTransform,
  defaultExportSettings,
  defaultLanes,
  defaultSubtitleStyle,
  getOrderedAudioLanes,
  getOrderedVideoLanesAsc,
  isAudioLane,
  isCreditClip,
  isLaneAudible,
  isVideoLane,
  laneNumber,
  nextAudioLaneId,
  nextVideoLaneId,
  normalizeLanesMap,
  projectEnd,
  rippleCloseGap,
  round3,
  type CaseMarker,
  type CaseMarkerColor,
  type CreditExportOverlay,
  type ExportSettings,
  type GradeStill,
  type LaneId,
  type LaneMap,
  type NoirSoundscapeId,
  type SubtitleSegment,
  type SubtitleStyleConfig,
  type TimelineClip
} from '../../shared/timeline'
import type { NoirCutProject } from '../../shared/project'
import type {
  AutosaveStatus,
  EngineInfo,
  MediaItem,
  RecentProjectEntry,
  SilenceRegion
} from '../../shared/types'
import AudioWorkspace from './components/AudioWorkspace'
import CommandIsland from './components/CommandIsland'
import ExportModal from './components/ExportModal'
import ExportWorkspace, { type ExportQueueJob } from './components/ExportWorkspace'
import GradeWorkspace from './components/GradeWorkspace'
import LeftPanel from './components/LeftPanel'
import Monitor from './components/Monitor'
import NoirLauncher from './components/NoirLauncher'
import RightPanel from './components/RightPanel'
import SubtitlesWorkspace from './components/SubtitlesWorkspace'
import Timeline from './components/Timeline'
import { useMediaLibrary } from './hooks/useMediaLibrary'
import { usePlayer } from './hooks/usePlayer'
import { renderCreditToPng, renderSubtitlesToPngOverlays } from './lib/credit-export'
import { ensureCreditFontsReady } from './lib/custom-fonts'
import {
  THEME_OPTIONS,
  type ProxyPlaybackMode,
  type ProxyResolutionScale,
  type Tab,
  type ThemeId
} from './types'

const THEME_STORAGE_KEY = 'noircut-theme'
const TIMELINE_HEIGHT_KEY = 'noircut-timeline-height'
const DEFAULT_TIMELINE_HEIGHT = 284
const MIN_TIMELINE_HEIGHT = 176
const MAX_TIMELINE_HEIGHT = 520

function getInitialTimelineHeight(): number {
  try {
    const raw = window.localStorage.getItem(TIMELINE_HEIGHT_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= MIN_TIMELINE_HEIGHT && n <= MAX_TIMELINE_HEIGHT) {
      return Math.round(n)
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_TIMELINE_HEIGHT
}

function getInitialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && THEME_OPTIONS.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // ignore storage errors
  }
  return 'noir-green'
}

interface HistoryEntry {
  clips: TimelineClip[]
  fallbackGrade: ColorGrade
  lanes: LaneMap
  markers: CaseMarker[]
  autoDucking: boolean
  selectedClipId: string | null
  selectedClipIds: string[]
  inPoint: number | null
  outPoint: number | null
  label: string
}

function cloneMarkerList(ms: CaseMarker[]): CaseMarker[] {
  return ms.map((m) => ({ ...m }))
}

function cloneClipItem(c: TimelineClip): TimelineClip {
  return {
    ...c,
    grade: c.grade ? cloneColorGrade(c.grade) : undefined,
    credit: c.credit ? cloneCreditConfig(c.credit) : undefined,
    transform: c.transform ? { ...c.transform } : undefined,
    keyframes: cloneKeyframes(c.keyframes)
  }
}

function cloneClipList(cs: TimelineClip[]): TimelineClip[] {
  return cs.map(cloneClipItem)
}

function cloneLaneMap(ls: LaneMap): LaneMap {
  return {
    V2: { ...ls.V2 },
    V1: { ...ls.V1 },
    A1: { ...ls.A1 },
    A2: { ...ls.A2 }
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('CUT')
  const [theme, setTheme] = useState<ThemeId>(getInitialTheme)
  const [timelineHeight, setTimelineHeight] = useState<number>(getInitialTimelineHeight)

  useEffect(() => {
    try {
      window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight))
    } catch {
      // ignore storage errors
    }
  }, [timelineHeight])

  const [leftWidth, setLeftWidth] = useState<number>(276)
  const [rightWidth, setRightWidth] = useState<number>(316)

  const startLeftResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = leftWidth
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(220, Math.min(380, Math.round(startW + (ev.clientX - startX))))
        setLeftWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [leftWidth]
  )

  const startRightResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = rightWidth
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(260, Math.min(420, Math.round(startW + (startX - ev.clientX))))
        setRightWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [rightWidth]
  )

  const startTimelineResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = timelineHeight
      const onMove = (ev: PointerEvent) => {
        const dy = startY - ev.clientY
        const next = Math.max(
          MIN_TIMELINE_HEIGHT,
          Math.min(MAX_TIMELINE_HEIGHT, Math.round(startH + dy))
        )
        setTimelineHeight(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [timelineHeight]
  )

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
  const [markers, setMarkers] = useState<CaseMarker[]>([])
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)
  const [stills, setStills] = useState<GradeStill[]>([])
  const [copiedGrade, setCopiedGrade] = useState<ColorGrade | null>(null)
  const [autoDucking, setAutoDucking] = useState<boolean>(false)
  const [masterGainDb, setMasterGainDb] = useState<number>(0)
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([])
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleConfig>(defaultSubtitleStyle)
  const [proxyPlaybackMode, setProxyPlaybackMode] = useState<ProxyPlaybackMode>('auto')
  const [proxyScale, setProxyScale] = useState<ProxyResolutionScale>('1/2')
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const selectedClipId = selectedClipIds[0] ?? null

  const setSelectedClipId = useCallback((id: string | null) => {
    setSelectedClipIds(id ? [id] : [])
  }, [])

  const handleSelectClip = useCallback(
    (id: string | null, opts?: { toggle?: boolean }) => {
      if (id === null) {
        setSelectedClipIds([])
        return
      }
      if (opts?.toggle) {
        setSelectedClipIds((prev) =>
          prev.includes(id) ? prev.filter((item) => item !== id) : [id, ...prev]
        )
        return
      }
      setSelectedClipIds([id])
    },
    []
  )

  const handleSelectClips = useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids))
    setSelectedClipIds(unique)
  }, [])

  const [inPoint, setInPoint] = useState<number | null>(null)
  const [outPoint, setOutPoint] = useState<number | null>(null)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const lastHistoryMetaRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportResultPath, setExportResultPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportQueue, setExportQueue] = useState<ExportQueueJob[]>([])
  const [queueRunning, setQueueRunning] = useState(false)
  const [queuePaused, setQueuePaused] = useState(false)
  const [renderLogs, setRenderLogs] = useState<string[]>([])
  const activeQueueJobIdRef = useRef<string | null>(null)
  const activeJobStartWallRef = useRef<number>(0)
  const [rippleMode, setRippleMode] = useState(false)
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus | null>(null)
  const [statusToast, setStatusToast] = useState<string | null>(null)
  const [wbPickerActive, setWbPickerActive] = useState(false)
  const [showLauncher, setShowLauncher] = useState(true)
  const [appVersion, setAppVersion] = useState('1.0.3')
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem('noircut.recentProjects.v1')
      return raw ? (JSON.parse(raw) as RecentProjectEntry[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    window.noircut?.getAppVersion?.().then((v) => {
      if (v) setAppVersion(v)
    })
    window.noircut?.getAutosaveStatus?.().then((st) => {
      if (st) setAutosaveStatus(st)
    })
  }, [])

  useEffect(() => {
    if (!showLauncher) return
    window.noircut?.getAutosaveStatus?.().then((st) => {
      if (st) setAutosaveStatus(st)
    })
  }, [showLauncher])

  const recordRecentProject = useCallback((filePath?: string) => {
    if (!filePath) return
    const name = filePath.split(/[\\/]/).pop()?.replace(/\.noircut$/i, '') || 'NoirCut Projesi'
    setRecentProjects((prev) => {
      const next = [
        { name, path: filePath, openedAt: new Date().toISOString() },
        ...prev.filter((p) => p.path !== filePath)
      ].slice(0, 8)
      try {
        window.localStorage.setItem('noircut.recentProjects.v1', JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])
  const nextId = useRef(100)
  const skipNextAutoPlaceRef = useRef(false)

  const lib = useMediaLibrary()
  const mediaMap = useMemo(() => new Map(lib.items.map((m) => [m.id, m])), [lib.items])
  const player = usePlayer(clips, lanes, lib.items, autoDucking, proxyPlaybackMode, masterGainDb)

  const handleProxyPlaybackModeChange = useCallback(
    (mode: ProxyPlaybackMode) => {
      setProxyPlaybackMode(mode)
      void window.noircut?.setProxyConfig?.({ playbackMode: mode })
    },
    []
  )

  const handleProxyScaleChange = useCallback(
    (scale: ProxyResolutionScale) => {
      setProxyScale(scale)
      void window.noircut?.setProxyConfig?.({ resolutionScale: scale })
    },
    []
  )

  const handleBatchProxyGenerate = useCallback(async () => {
    const res = await window.noircut?.generateBatchProxies?.(undefined, proxyScale)
    if (res && res.started > 0) {
      setStatusToast(`${res.started} medya için toplu proxy üretimi başlatıldı (${proxyScale})`)
    } else {
      setStatusToast('Proxy üretilecek video bulunamadı')
    }
  }, [proxyScale])

  const makeClip = useCallback(
    (m: MediaItem, lane: LaneId, start: number): TimelineClip => ({
      id: `clip-${nextId.current++}`,
      mediaId: m.id,
      lane,
      name: m.name,
      start: round3(start),
      in: 0,
      duration: round3(m.duration),
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      audioDetached: false,
      grade: isVideoLane(lane) ? defaultColorGrade() : undefined,
      transform: isVideoLane(lane) ? defaultClipTransform() : undefined,
      speed: 100,
      reverse: false,
      transitionType: 'none',
      transitionDuration: 0.8,
      pan: 0,
      audioPreset: 'none'
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
    return window.noircut.onExportProgress((pct) => {
      setExportProgress(pct)
      const qid = activeQueueJobIdRef.current
      if (qid) {
        const elapsedSec = Math.max(0.1, (performance.now() - activeJobStartWallRef.current) / 1000)
        const etaSec = pct >= 4 && pct < 100 ? ((100 - pct) / pct) * elapsedSec : null
        setExportQueue((prev) =>
          prev.map((j) => (j.id === qid ? { ...j, progress: pct, etaSec } : j))
        )
      }
    })
  }, [])

  // Aktif medya değişince timeline'a tek klip olarak yerleştir (proje yükleme hariç)
  useEffect(() => {
    if (skipNextAutoPlaceRef.current) {
      skipNextAutoPlaceRef.current = false
      return
    }
    const m = lib.active
    setSelectedClipId(null)
    setClips(m ? [makeClip(m, m.mediaKind === 'audio' ? 'A1' : 'V1', 0)] : [])
  }, [lib.active, makeClip])

  const total = useMemo(() => {
    const end = projectEnd(clips)
    return end > 0 ? end : (lib.active?.duration ?? 0)
  }, [clips, lib.active])

  // Renk düzenleme hedef klibi: seçili video/görsel klibi -> playhead'deki aktif video klibi -> ilk video klibi
  const targetGradeClip = useMemo(() => {
    if (selectedClipId) {
      const sel = clips.find((c) => c.id === selectedClipId && isVideoLane(c.lane) && !isCreditClip(c))
      if (sel) return sel
    }
    return (
      player.activePrimaryClip ??
      clips.find((c) => isVideoLane(c.lane) && !isCreditClip(c)) ??
      null
    )
  }, [clips, selectedClipId, player.activePrimaryClip])

  // Kurgu (EDIT) hedef klibi: seçili herhangi bir klip -> playhead'deki aktif video klibi -> ilk klip
  const targetEditClip = useMemo(() => {
    if (selectedClipId) {
      const sel = clips.find((c) => c.id === selectedClipId)
      if (sel) return sel
    }
    return player.activePrimaryClip ?? clips[0] ?? null
  }, [clips, selectedClipId, player.activePrimaryClip])

  const v1Clips = useMemo(
    () =>
      clips
        .filter((c) => isVideoLane(c.lane) && !isCreditClip(c))
        .sort((a, b) => a.start - b.start || laneNumber(a.lane) - laneNumber(b.lane)),
    [clips]
  )

  const activeGrade: ColorGrade = useMemo(
    () => targetGradeClip?.grade ?? fallbackGrade,
    [targetGradeClip, fallbackGrade]
  )

  const stateSnapshotRef = useRef({
    clips,
    fallbackGrade,
    lanes,
    markers,
    autoDucking,
    selectedClipId,
    selectedClipIds,
    inPoint,
    outPoint
  })
  stateSnapshotRef.current = {
    clips,
    fallbackGrade,
    lanes,
    markers,
    autoDucking,
    selectedClipId,
    selectedClipIds,
    inPoint,
    outPoint
  }

  const recordHistory = useCallback((label: string, coalesceKey?: string) => {
    const now = performance.now()
    if (
      coalesceKey &&
      lastHistoryMetaRef.current.key === coalesceKey &&
      now - lastHistoryMetaRef.current.at < 1200
    ) {
      lastHistoryMetaRef.current.at = now
      return
    }
    lastHistoryMetaRef.current = { key: coalesceKey ?? '', at: now }
    const snap = stateSnapshotRef.current
    const entry: HistoryEntry = {
      clips: cloneClipList(snap.clips),
      fallbackGrade: cloneColorGrade(snap.fallbackGrade),
      lanes: cloneLaneMap(snap.lanes),
      markers: cloneMarkerList(snap.markers),
      autoDucking: snap.autoDucking,
      selectedClipId: snap.selectedClipId,
      selectedClipIds: [...snap.selectedClipIds],
      inPoint: snap.inPoint,
      outPoint: snap.outPoint,
      label
    }
    setUndoStack((prev) => [...prev.slice(-49), entry])
    setRedoStack([])
  }, [])

  const updateActiveGrade = useCallback(
    (next: ColorGrade) => {
      recordHistory('Renk Düzenleme', `grade-${targetGradeClip?.id ?? 'fallback'}`)
      if (!targetGradeClip) {
        setFallbackGrade(next)
        return
      }
      const targetId = targetGradeClip.id
      setClips((cs) => cs.map((c) => (c.id === targetId ? { ...c, grade: cloneColorGrade(next) } : c)))
    },
    [recordHistory, targetGradeClip]
  )

  const applyGradeToAllV1 = useCallback(
    (next: ColorGrade) => {
      recordHistory('Tüm Kliplere Noir Look Uygula')
      setClips((cs) =>
        cs.map((c) =>
          isVideoLane(c.lane) && !isCreditClip(c) ? { ...c, grade: cloneColorGrade(next) } : c
        )
      )
    },
    [recordHistory]
  )

  const registerImportedLut = useCallback((lut: Lut3D) => {
    setCustomLuts((prev) => ({ ...prev, [lut.id]: lut }))
  }, [])

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
    const t = round3(player.timeRef.current)
    const cs = stateSnapshotRef.current.clips
    const canSplit = (c: TimelineClip) => t > c.start + 0.05 && t < clipEndExact(c) - 0.05
    const selected = selectedClipId ? cs.find((c) => c.id === selectedClipId && canSplit(c)) : undefined
    const targets = selected ? [selected] : cs.filter(canSplit)
    if (targets.length === 0) return

    recordHistory('Klip Kesme')
    const targetIds = new Set(targets.map((c) => c.id))
    setClips((prev) =>
      prev.flatMap((c) => {
        if (!targetIds.has(c.id)) return [c]
        const leftDur = round3(t - c.start)
        const rightDur = round3(clipEndExact(c) - t)
        const spd = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
        const leftKfs = c.keyframes
          ? c.keyframes.filter((k) => k.time <= leftDur).map((k) => ({ ...k }))
          : undefined
        const rightKfs = c.keyframes
          ? c.keyframes
              .filter((k) => k.time > leftDur)
              .map((k) => ({ ...k, time: round3(k.time - leftDur) }))
          : undefined
        const left: TimelineClip = {
          ...c,
          duration: leftDur,
          fadeIn: Math.min(c.fadeIn, leftDur),
          fadeOut: 0,
          grade: c.grade ? cloneColorGrade(c.grade) : undefined,
          transform: c.transform ? { ...c.transform } : undefined,
          keyframes: leftKfs
        }
        const right: TimelineClip = {
          ...c,
          id: `clip-${nextId.current++}`,
          start: t,
          in: round3(c.in + leftDur * spd),
          duration: rightDur,
          fadeIn: 0,
          fadeOut: Math.min(c.fadeOut, rightDur),
          grade: c.grade ? cloneColorGrade(c.grade) : undefined,
          transform: c.transform ? { ...c.transform } : undefined,
          keyframes: rightKfs
        }
        return [left, right]
      })
    )
  }, [player.timeRef, recordHistory, selectedClipId])

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg)
    window.setTimeout(() => {
      setStatusToast((cur) => (cur === msg ? null : cur))
    }, 3000)
  }, [])

  // Seçili klipleri silme (Delete / Backspace — tekli veya çoklu seçim)
  const deleteSelected = useCallback(() => {
    const ids = stateSnapshotRef.current.selectedClipIds
    if (ids.length === 0) return
    const idSet = new Set(ids)
    recordHistory(ids.length > 1 ? `Toplu Klip Silme (${ids.length})` : 'Klip Silme')
    setClips((cs) => cs.filter((c) => !idSet.has(c.id)))
    setSelectedClipIds([])
    if (ids.length > 1) {
      showToast(`${ids.length} seçili klip silindi`)
    }
  }, [recordHistory, showToast])

  // Ripple Silme: seçili klip(ler)i sil ve aynı kanaldaki sonraki klipleri boşluksuz geri kaydır
  const rippleDeleteSelected = useCallback(() => {
    const ids = stateSnapshotRef.current.selectedClipIds
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const removed = stateSnapshotRef.current.clips.filter((c) => idSet.has(c.id))
    if (removed.length === 0) return
    recordHistory(removed.length > 1 ? `Toplu Ripple Silme (${removed.length})` : 'Ripple Klip Silme')
    setClips((cs) => {
      const remaining = cs.filter((c) => !idSet.has(c.id))
      return remaining.map((c) => {
        const shift = removed
          .filter((r) => r.lane === c.lane && clipEndExact(r) <= c.start + 0.02)
          .reduce((sum, r) => sum + r.duration, 0)
        if (shift <= 0) return c
        return { ...c, start: Math.max(0, round3(c.start - shift)) }
      })
    })
    setSelectedClipIds([])
    showToast(
      removed.length > 1
        ? `Ripple Silme: ${removed.length} klip silindi`
        : `Ripple Silme: ${removed[0].name}`
    )
  }, [recordHistory, showToast])

  // Seçili kanaldaki (veya seçili klipler arasındaki) boşlukları kapat
  const closeGaps = useCallback(
    (lane?: LaneId) => {
      const snap = stateSnapshotRef.current
      const selIds = new Set(snap.selectedClipIds)
      const selClips = snap.clips.filter((c) => selIds.has(c.id))

      // Eğer birden fazla klip seçiliyse ve belirli bir kanal zorlanmadıysa, seçili kliplerin bulunduğu kanallardaki aralıkları kapat
      if (!lane && selClips.length >= 2) {
        const affectedLanes = Array.from(new Set(selClips.map((c) => c.lane)))
        recordHistory('Seçili Klipler Arası Boşlukları Kapat')
        setClips((cs) => {
          const repositioned = new Map<string, number>()
          for (const ln of affectedLanes) {
            const laneClips = cs
              .filter((c) => c.lane === ln)
              .slice()
              .sort((a, b) => a.start - b.start)
            const laneSel = laneClips.filter((c) => selIds.has(c.id))
            if (laneSel.length >= 2) {
              const firstSelIdx = laneClips.findIndex((c) => c.id === laneSel[0].id)
              let cursor = round3(laneClips[firstSelIdx].start)
              for (let i = firstSelIdx; i < laneClips.length; i++) {
                const c = laneClips[i]
                repositioned.set(c.id, round3(cursor))
                cursor = round3(cursor + c.duration)
              }
            } else {
              let cursor = 0
              for (const c of laneClips) {
                repositioned.set(c.id, round3(cursor))
                cursor = round3(cursor + c.duration)
              }
            }
          }
          return cs.map((c) => (repositioned.has(c.id) ? { ...c, start: repositioned.get(c.id)! } : c))
        })
        showToast('Seçili klipler arasındaki boşluklar kapatıldı')
        return
      }

      const targetLane: LaneId = lane ?? selClips[0]?.lane ?? 'V1'
      recordHistory('Boşlukları Kapat')
      setClips((cs) => {
        const laneClips = cs
          .filter((c) => c.lane === targetLane)
          .slice()
          .sort((a, b) => a.start - b.start)
        let cursor = 0
        const repositioned = new Map<string, number>()
        for (const c of laneClips) {
          repositioned.set(c.id, round3(cursor))
          cursor = round3(cursor + c.duration)
        }
        return cs.map((c) => (repositioned.has(c.id) ? { ...c, start: repositioned.get(c.id)! } : c))
      })
      showToast(`${targetLane} kanalındaki boşluklar kapatıldı`)
    },
    [recordHistory, showToast]
  )

  // İki klip arasındaki boşluğa sağ tıklanıp "Boşluğu Kapat (Ripple Delete Gap)" seçildiğinde sağdaki klipleri boşluksuz sola yapıştır
  const handleRippleCloseGap = useCallback(
    (lane: LaneId, gapStart: number, gapEnd: number) => {
      const gapDur = round3(gapEnd - gapStart)
      if (gapDur <= 0.001) return
      recordHistory('Boşluğu Kapat (Ripple Delete Gap)')
      setClips((cs) => rippleCloseGap(cs, lane, gapStart, gapEnd).clips)
      showToast(`Boşluk kapatıldı (${lane} · ${gapDur.toFixed(2)}s)`)
    },
    [recordHistory, showToast]
  )

  const detachSelected = useCallback(() => {
    if (!selectedClipId) return
    const target = stateSnapshotRef.current.clips.find((c) => c.id === selectedClipId)
    if (!target || !isVideoLane(target.lane) || isCreditClip(target) || target.audioDetached) return
    recordHistory('Sesi Ayırma')
    setClips((cs) => {
      const curTarget = cs.find((c) => c.id === selectedClipId)
      if (!curTarget || !isVideoLane(curTarget.lane) || isCreditClip(curTarget) || curTarget.audioDetached) {
        return cs
      }
      const newAudioId = `clip-${nextId.current++}`
      const audioClip: TimelineClip = {
        ...curTarget,
        id: newAudioId,
        lane: 'A1',
        audioDetached: false,
        grade: undefined,
        linkedClipId: curTarget.id
      }
      return cs
        .map((c) =>
          c.id === curTarget.id ? { ...c, audioDetached: true, linkedClipId: newAudioId } : c
        )
        .concat(audioClip)
    })
  }, [recordHistory, selectedClipId])

  // Belirli bir klibi (ve bağlı A/V veya grup eşlerini) verilen saniyeden böl (Razor Aracı)
  const cutClipAt = useCallback(
    (clipId: string, splitTime: number) => {
      const t = round3(splitTime)
      const cs = stateSnapshotRef.current.clips
      const primary = cs.find((c) => c.id === clipId)
      if (!primary) return
      const canSplit = (c: TimelineClip) =>
        !stateSnapshotRef.current.lanes[c.lane]?.locked &&
        t > c.start + 0.05 &&
        t < clipEndExact(c) - 0.05
      const targets = cs.filter(
        (c) =>
          canSplit(c) &&
          (c.id === primary.id ||
            (primary.linkedClipId && c.id === primary.linkedClipId) ||
            c.linkedClipId === primary.id ||
            (primary.groupId && c.groupId === primary.groupId))
      )
      if (targets.length === 0) return

      recordHistory('Klip Kesme (Jilet)')
      const targetIds = new Set(targets.map((c) => c.id))
      setClips((prev) =>
        prev.flatMap((c) => {
          if (!targetIds.has(c.id)) return [c]
          const leftDur = round3(t - c.start)
          const rightDur = round3(clipEndExact(c) - t)
          const spd = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
          const leftKfs = c.keyframes
            ? c.keyframes.filter((k) => k.time <= leftDur).map((k) => ({ ...k }))
            : undefined
          const rightKfs = c.keyframes
            ? c.keyframes
                .filter((k) => k.time > leftDur)
                .map((k) => ({ ...k, time: round3(k.time - leftDur) }))
            : undefined
          const left: TimelineClip = {
            ...c,
            duration: leftDur,
            fadeIn: Math.min(c.fadeIn, leftDur),
            fadeOut: 0,
            grade: c.grade ? cloneColorGrade(c.grade) : undefined,
            transform: c.transform ? { ...c.transform } : undefined,
            keyframes: leftKfs
          }
          const right: TimelineClip = {
            ...c,
            id: `clip-${nextId.current++}`,
            start: t,
            in: round3(c.in + leftDur * spd),
            duration: rightDur,
            fadeIn: 0,
            fadeOut: Math.min(c.fadeOut, rightDur),
            grade: c.grade ? cloneColorGrade(c.grade) : undefined,
            transform: c.transform ? { ...c.transform } : undefined,
            keyframes: rightKfs,
            linkedClipId: null
          }
          return [left, right]
        })
      )
    },
    [recordHistory]
  )

  const handleGroupSelected = useCallback(() => {
    const ids = stateSnapshotRef.current.selectedClipIds
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const selClips = stateSnapshotRef.current.clips.filter((c) => idSet.has(c.id))
    const allAlreadyGrouped =
      selClips.length > 0 &&
      Boolean(selClips[0].groupId) &&
      selClips.every((c) => c.groupId === selClips[0].groupId)

    if (allAlreadyGrouped) {
      const targetGroup = selClips[0].groupId
      recordHistory('Klip Grubunu Çöz')
      setClips((cs) =>
        cs.map((c) => (c.groupId === targetGroup ? { ...c, groupId: null } : c))
      )
      showToast('Klip grubu çözüldü')
    } else if (selClips.length >= 2) {
      const newGroupId = `grp-${Date.now()}`
      recordHistory(`Klipleri Grupla (${selClips.length})`)
      setClips((cs) =>
        cs.map((c) => (idSet.has(c.id) ? { ...c, groupId: newGroupId } : c))
      )
      showToast(`${selClips.length} klip gruplandı`)
    }
  }, [recordHistory, showToast])

  const handleLinkSelected = useCallback(() => {
    const ids = stateSnapshotRef.current.selectedClipIds
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const selClips = stateSnapshotRef.current.clips.filter((c) => idSet.has(c.id))
    const hasLinked = selClips.some((c) => Boolean(c.linkedClipId))
    if (hasLinked) {
      const linkedTargets = new Set<string>()
      for (const c of selClips) {
        linkedTargets.add(c.id)
        if (c.linkedClipId) linkedTargets.add(c.linkedClipId)
      }
      recordHistory('Video & Ses Bağını Çöz')
      setClips((cs) =>
        cs.map((c) =>
          linkedTargets.has(c.id) || (c.linkedClipId && linkedTargets.has(c.linkedClipId))
            ? { ...c, linkedClipId: null }
            : c
        )
      )
      showToast('Video ve ses bağı çözüldü')
      return
    }
    if (selClips.length >= 2) {
      const vClip = selClips.find((c) => isVideoLane(c.lane)) ?? selClips[0]
      const aClip = selClips.find((c) => c.id !== vClip.id && isAudioLane(c.lane)) ?? selClips[1]
      recordHistory('Video & Ses Bağla (A/V Link)')
      setClips((cs) =>
        cs.map((c) => {
          if (c.id === vClip.id) return { ...c, linkedClipId: aClip.id }
          if (c.id === aClip.id) return { ...c, linkedClipId: vClip.id }
          return c
        })
      )
      showToast(`${vClip.name} ve ${aClip.name} A/V olarak bağlandı`)
    }
  }, [recordHistory, showToast])

  const handleNestSelected = useCallback(() => {
    const ids = stateSnapshotRef.current.selectedClipIds
    if (ids.length < 2) return
    const idSet = new Set(ids)
    const selClips = stateSnapshotRef.current.clips
      .filter((c) => idSet.has(c.id))
      .sort((a, b) => a.start - b.start)
    if (selClips.length < 2) return

    const primary = selClips.find((c) => isVideoLane(c.lane) && !isCreditClip(c)) ?? selClips[0]
    const minStart = round3(Math.min(...selClips.map((c) => c.start)))
    const maxEnd = round3(Math.max(...selClips.map((c) => clipEndExact(c))))
    const totalDur = Math.max(0.2, round3(maxEnd - minStart))
    const nestedId = `clip-${nextId.current++}`
    const nestedClip: TimelineClip = {
      ...cloneClipItem(primary),
      id: nestedId,
      name: `İç İçe Sekans (${selClips.length} Klip)`,
      start: minStart,
      duration: totalDur,
      groupId: null,
      linkedClipId: null,
      nestedClips: selClips.map(cloneClipItem)
    }
    recordHistory(`İç İçe Sekans Oluştur (${selClips.length} klip)`)
    setClips((cs) => cs.filter((c) => !idSet.has(c.id)).concat(nestedClip))
    setSelectedClipIds([nestedId])
    showToast(`İç İçe Sekans oluşturuldu (${totalDur.toFixed(2)}s)`)
  }, [recordHistory, showToast])

  const updateClip = useCallback(
    (id: string, patch: Partial<TimelineClip>) => {
      const isKeyframeToggle =
        patch.keyframes !== undefined && patch.transform === undefined
      recordHistory(
        isKeyframeToggle ? 'Keyframe Güncelleme' : 'Klip Ayarı',
        isKeyframeToggle ? undefined : `clip-${id}`
      )
      setClips((cs) =>
        cs.map((c) => {
          if (c.id !== id) return c
          const next = { ...c, ...patch }
          if (patch.lane && isVideoLane(patch.lane) && !isCreditClip(next)) {
            if (!next.grade) next.grade = defaultColorGrade()
            if (!next.transform) next.transform = defaultClipTransform()
          }
          return next
        })
      )
    },
    [recordHistory]
  )

  const batchUpdateClips = useCallback(
    (updates: Array<{ id: string; patch: Partial<TimelineClip> }>) => {
      if (updates.length === 0) return
      recordHistory(
        updates.length > 1 ? `Çoklu Klip Taşıma (${updates.length})` : 'Klip Ayarı',
        'batch-clip-move'
      )
      const patchMap = new Map(updates.map((u) => [u.id, u.patch]))
      setClips((cs) =>
        cs.map((c) => {
          const patch = patchMap.get(c.id)
          if (!patch) return c
          const next = { ...c, ...patch }
          if (patch.lane && isVideoLane(patch.lane) && !isCreditClip(next)) {
            if (!next.grade) next.grade = defaultColorGrade()
            if (!next.transform) next.transform = defaultClipTransform()
          }
          return next
        })
      )
    },
    [recordHistory]
  )

  const handleSelectAllClips = useCallback(() => {
    const allIds = stateSnapshotRef.current.clips.map((c) => c.id)
    if (allIds.length === 0) return
    setSelectedClipIds(allIds)
    showToast(`Tüm klipler seçildi (${allIds.length} klip)`)
  }, [showToast])

  const handleClearSelection = useCallback(() => {
    setSelectedClipIds([])
    setActiveMarkerId(null)
  }, [])

  const toggleMute = useCallback(
    (lane: LaneId) => {
      recordHistory(`${lane} Mute`)
      setLanes((ls) => {
        const cur = ls[lane] ?? { muted: false, solo: false }
        return { ...ls, [lane]: { ...cur, muted: !cur.muted } }
      })
    },
    [recordHistory]
  )

  const toggleSolo = useCallback(
    (lane: LaneId) => {
      recordHistory(`${lane} Solo`)
      setLanes((ls) => {
        const cur = ls[lane] ?? { muted: false, solo: false }
        return { ...ls, [lane]: { ...cur, solo: !cur.solo } }
      })
    },
    [recordHistory]
  )

  const toggleLockLane = useCallback(
    (lane: LaneId) => {
      recordHistory(`${lane} Kilitle/Aç`)
      setLanes((ls) => {
        const cur = ls[lane] ?? { muted: false, solo: false }
        return { ...ls, [lane]: { ...cur, locked: !cur.locked } }
      })
    },
    [recordHistory]
  )

  const toggleHideLane = useCallback(
    (lane: LaneId) => {
      recordHistory(`${lane} Gizle/Göster`)
      setLanes((ls) => {
        const cur = ls[lane] ?? { muted: false, solo: false }
        return { ...ls, [lane]: { ...cur, hidden: !cur.hidden } }
      })
    },
    [recordHistory]
  )

  const duplicateLane = useCallback(
    (lane: LaneId) => {
      const isVid = isVideoLane(lane)
      const newLane = isVid
        ? nextVideoLaneId(stateSnapshotRef.current.lanes)
        : nextAudioLaneId(stateSnapshotRef.current.lanes)
      recordHistory(`Kanalı Çoğalt (${lane} → ${newLane})`)
      setLanes((ls) => ({
        ...ls,
        [newLane]: { ...(ls[lane] ?? { muted: false, solo: false }) }
      }))
      setClips((cs) => {
        const sourceClips = cs.filter((c) => c.lane === lane)
        const copies = sourceClips.map((c) => ({
          ...cloneClipItem(c),
          id: `clip-${nextId.current++}`,
          lane: newLane,
          linkedClipId: null,
          groupId: null
        }))
        return [...cs, ...copies]
      })
      showToast(`${lane} kanalı ${newLane} olarak çoğaltıldı`)
    },
    [recordHistory, showToast]
  )

  const reorderLane = useCallback(
    (lane: LaneId, dir: -1 | 1) => {
      const isVid = isVideoLane(lane)
      const curLanes = stateSnapshotRef.current.lanes
      const group = Object.keys(curLanes)
        .filter((k) => (isVid ? isVideoLane(k) : isAudioLane(k)))
        .sort((a, b) => {
          const oa = curLanes[a]?.order
          const ob = curLanes[b]?.order
          if (typeof oa === 'number' && typeof ob === 'number' && oa !== ob) return oa - ob
          return isVid ? laneNumber(b) - laneNumber(a) : laneNumber(a) - laneNumber(b)
        })
      const idx = group.indexOf(lane)
      const targetIdx = idx + dir
      if (idx < 0 || targetIdx < 0 || targetIdx >= group.length) return
      const swapped = [...group]
      const tmp = swapped[idx]
      swapped[idx] = swapped[targetIdx]
      swapped[targetIdx] = tmp
      recordHistory(`Kanal Sırası Değiştir (${lane})`)
      setLanes((ls) => {
        const next = { ...ls }
        swapped.forEach((lid, i) => {
          next[lid] = { ...(next[lid] ?? { muted: false, solo: false }), order: i }
        })
        return next
      })
    },
    [recordHistory]
  )

  const addVideoLane = useCallback(() => {
    const newLane = nextVideoLaneId(stateSnapshotRef.current.lanes)
    recordHistory(`Video Kanalı Ekle (${newLane})`)
    setLanes((ls) => ({
      ...ls,
      [newLane]: { muted: false, solo: false }
    }))
    showToast(`${newLane} video kanalı eklendi`)
  }, [recordHistory, showToast])

  const addAudioLane = useCallback(() => {
    const newLane = nextAudioLaneId(stateSnapshotRef.current.lanes)
    recordHistory(`Ses Kanalı Ekle (${newLane})`)
    setLanes((ls) => ({
      ...ls,
      [newLane]: { muted: false, solo: false }
    }))
    showToast(`${newLane} ses kanalı eklendi`)
  }, [recordHistory, showToast])

  const removeLane = useCallback(
    (lane: LaneId) => {
      if (laneNumber(lane) <= 2) return
      if (stateSnapshotRef.current.clips.some((c) => c.lane === lane)) return
      recordHistory(`Kanal Kaldır (${lane})`)
      setLanes((ls) => {
        const next = { ...ls }
        delete next[lane]
        return next
      })
      showToast(`${lane} kanalı kaldırıldı`)
    },
    [recordHistory, showToast]
  )

  const dropMediaToLane = useCallback(
    (mediaId: string, lane: LaneId) => {
      const m = mediaMap.get(mediaId)
      if (!m) return
      const targetLane: LaneId =
        m.mediaKind === 'audio'
          ? isAudioLane(lane)
            ? lane
            : 'A1'
          : isVideoLane(lane)
            ? lane
            : 'V1'
      recordHistory('Klip Ekleme')
      setClips((cs) => {
        const laneEnd = cs
          .filter((c) => c.lane === targetLane)
          .reduce((max, c) => Math.max(max, clipEndExact(c)), 0)
        return [...cs, makeClip(m, targetLane, round3(laneEnd))]
      })
    },
    [mediaMap, makeClip, recordHistory]
  )

  const selectedV2Clip = useMemo(
    () => (selectedClipId ? clips.find((c) => c.id === selectedClipId && isCreditClip(c)) ?? null : null),
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
      const startAtPlayhead = player.timeRef.current
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
  }, [activeCredit, player.timeRef])

  // Geri Al (Undo - Ctrl+Z)
  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      const snap = stateSnapshotRef.current
      const currentEntry: HistoryEntry = {
        clips: cloneClipList(snap.clips),
        fallbackGrade: cloneColorGrade(snap.fallbackGrade),
        lanes: cloneLaneMap(snap.lanes),
        markers: cloneMarkerList(snap.markers),
        autoDucking: snap.autoDucking,
        selectedClipId: snap.selectedClipId,
        selectedClipIds: [...snap.selectedClipIds],
        inPoint: snap.inPoint,
        outPoint: snap.outPoint,
        label: last.label
      }
      setRedoStack((r) => [...r, currentEntry])
      setClips(cloneClipList(last.clips))
      setFallbackGrade(cloneColorGrade(last.fallbackGrade))
      setLanes(cloneLaneMap(last.lanes))
      setMarkers(cloneMarkerList(last.markers))
      setAutoDucking(last.autoDucking)
      setSelectedClipIds(
        last.selectedClipIds ?? (last.selectedClipId ? [last.selectedClipId] : [])
      )
      setInPoint(last.inPoint)
      setOutPoint(last.outPoint)
      lastHistoryMetaRef.current = { key: '', at: 0 }
      showToast(`↶ Geri Alındı: ${last.label}`)
      return prev.slice(0, -1)
    })
  }, [showToast])

  // Yinele (Redo - Ctrl+Shift+Z / Ctrl+Y)
  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const next = prev[prev.length - 1]
      const snap = stateSnapshotRef.current
      const currentEntry: HistoryEntry = {
        clips: cloneClipList(snap.clips),
        fallbackGrade: cloneColorGrade(snap.fallbackGrade),
        lanes: cloneLaneMap(snap.lanes),
        markers: cloneMarkerList(snap.markers),
        autoDucking: snap.autoDucking,
        selectedClipId: snap.selectedClipId,
        selectedClipIds: [...snap.selectedClipIds],
        inPoint: snap.inPoint,
        outPoint: snap.outPoint,
        label: next.label
      }
      setUndoStack((u) => [...u, currentEntry])
      setClips(cloneClipList(next.clips))
      setFallbackGrade(cloneColorGrade(next.fallbackGrade))
      setLanes(cloneLaneMap(next.lanes))
      setMarkers(cloneMarkerList(next.markers))
      setAutoDucking(next.autoDucking)
      setSelectedClipIds(
        next.selectedClipIds ?? (next.selectedClipId ? [next.selectedClipId] : [])
      )
      setInPoint(next.inPoint)
      setOutPoint(next.outPoint)
      lastHistoryMetaRef.current = { key: '', at: 0 }
      showToast(`↷ Yinelendi: ${next.label}`)
      return prev.slice(0, -1)
    })
  }, [showToast])

  // NLE Giriş (I) ve Çıkış (O) Noktası İşaretleme
  const handleMarkIn = useCallback(() => {
    const t = Number(player.timeRef.current.toFixed(3))
    recordHistory('Giriş (In) İşareti')
    setInPoint(t)
    if (outPoint !== null && outPoint <= t) {
      setOutPoint(null)
    }
    if (targetEditClip && t >= targetEditClip.start && t <= clipEnd(targetEditClip)) {
      const local = Number((t - targetEditClip.start).toFixed(3))
      setClips((cs) =>
        cs.map((c) => (c.id === targetEditClip.id ? { ...c, markIn: local } : c))
      )
    }
    showToast(`[ I · Giriş (In) Noktası: ${t.toFixed(2)}s`)
  }, [outPoint, player.timeRef, recordHistory, showToast, targetEditClip])

  const handleMarkOut = useCallback(() => {
    const t = Number(player.timeRef.current.toFixed(3))
    recordHistory('Çıkış (Out) İşareti')
    setOutPoint(t)
    if (inPoint !== null && inPoint >= t) {
      setInPoint(null)
    }
    if (targetEditClip && t >= targetEditClip.start && t <= clipEnd(targetEditClip)) {
      const local = Number((t - targetEditClip.start).toFixed(3))
      setClips((cs) =>
        cs.map((c) => (c.id === targetEditClip.id ? { ...c, markOut: local } : c))
      )
    }
    showToast(`O ] · Çıkış (Out) Noktası: ${t.toFixed(2)}s`)
  }, [inPoint, player.timeRef, recordHistory, showToast, targetEditClip])

  const handleClearInOut = useCallback(() => {
    recordHistory('In/Out Temizle')
    setInPoint(null)
    setOutPoint(null)
    setClips((cs) => cs.map((c) => ({ ...c, markIn: null, markOut: null })))
    showToast('In / Out işaretleri temizlendi')
  }, [recordHistory, showToast])

  // 1) Sahne İşaretçileri ve Yönetmen Notları (Case Markers)
  const handleAddMarkerAtPlayhead = useCallback(() => {
    const t = Number(player.timeRef.current.toFixed(3))
    const cur = stateSnapshotRef.current.markers
    const existing = cur.find((m) => Math.abs(m.time - t) < 0.08)
    if (existing) {
      setActiveMarkerId(existing.id)
      showToast(`◆ Sahne İşaretçisi açıldı: ${existing.title}`)
      return
    }
    const palette: CaseMarkerColor[] = ['amber', 'crimson', 'emerald', 'cyan', 'violet']
    const color = palette[cur.length % palette.length]
    const newMarker: CaseMarker = {
      id: `marker-${nextId.current++}`,
      time: t,
      title: `Sahne #${cur.length + 1}`,
      note: '',
      color
    }
    recordHistory('Sahne İşaretçisi Ekle')
    setMarkers((ms) => [...ms, newMarker].sort((a, b) => a.time - b.time))
    setActiveMarkerId(newMarker.id)
    showToast(`◆ Sahne İşaretçisi eklendi (${t.toFixed(2)}s)`)
  }, [player.timeRef, recordHistory, showToast])

  const handleUpdateMarker = useCallback(
    (id: string, patch: Partial<CaseMarker>) => {
      recordHistory('Yönetmen Notu Güncelle', `marker-${id}`)
      setMarkers((ms) =>
        ms.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.time - b.time)
      )
    },
    [recordHistory]
  )

  const handleDeleteMarker = useCallback(
    (id: string) => {
      recordHistory('Sahne İşaretçisi Sil')
      setMarkers((ms) => ms.filter((m) => m.id !== id))
      setActiveMarkerId((cur) => (cur === id ? null : cur))
      showToast('Sahne işaretçisi silindi')
    },
    [recordHistory, showToast]
  )

  const handleStepMarker = useCallback(
    (dir: -1 | 1) => {
      const sorted = [...stateSnapshotRef.current.markers].sort((a, b) => a.time - b.time)
      if (sorted.length === 0) return
      const curT = player.timeRef.current
      let target: CaseMarker | undefined
      if (dir > 0) {
        target = sorted.find((m) => m.time > curT + 0.04) ?? sorted[0]
      } else {
        for (let i = sorted.length - 1; i >= 0; i--) {
          if (sorted[i].time < curT - 0.04) {
            target = sorted[i]
            break
          }
        }
        if (!target) target = sorted[sorted.length - 1]
      }
      if (target) {
        player.seek(target.time)
        setActiveMarkerId(target.id)
        showToast(`◆ ${target.title} (${target.time.toFixed(2)}s)`)
      }
    },
    [player, showToast]
  )

  // 2) Anlık Kare Yakalama (Grab Still) & Renk Kopyala / Yapıştır
  const handleGrabStill = useCallback(() => {
    const w = 320
    const h = 180
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = w
    thumbCanvas.height = h
    const ctx = thumbCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let capturedFromWebGL = false
    const glCanvas = document.querySelector(
      'canvas[data-testid="video-graded-canvas"]'
    ) as HTMLCanvasElement | null
    if (glCanvas && glCanvas.width > 0 && glCanvas.height > 0 && glCanvas.dataset.falseColor !== '1') {
      try {
        ctx.drawImage(glCanvas, 0, 0, w, h)
        capturedFromWebGL = true
      } catch {
        capturedFromWebGL = false
      }
    }

    if (!capturedFromWebGL) {
      const video = player.videoRef.current
      if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          ctx.drawImage(video, 0, 0, w, h)
        } catch {
          // fallback below
        }
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, '#5d7a96')
        grad.addColorStop(0.55, '#c9b79a')
        grad.addColorStop(1, '#d9a76a')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      }
      const imgData = ctx.getImageData(0, 0, w, h)
      const d = imgData.data
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = evaluateColorGrade(
          d[i] / 255,
          d[i + 1] / 255,
          d[i + 2] / 255,
          activeGrade,
          activeLut
        )
        d[i] = Math.round(r * 255)
        d[i + 1] = Math.round(g * 255)
        d[i + 2] = Math.round(b * 255)
      }
      ctx.putImageData(imgData, 0, 0)
    }

    const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.86)
    const sec = Math.max(0, player.timeRef.current)
    const mm = String(Math.floor(sec / 60)).padStart(2, '0')
    const ss = String(Math.floor(sec % 60)).padStart(2, '0')
    const ff = String(Math.floor((sec % 1) * 24)).padStart(2, '0')
    const newStill: GradeStill = {
      id: `still-${nextId.current++}`,
      name: `${targetGradeClip?.name ?? 'Sahne'} · #${stills.length + 1}`,
      timecode: `${mm}:${ss}:${ff}`,
      createdAt: new Date().toISOString(),
      thumbnailDataUrl,
      grade: cloneColorGrade(activeGrade)
    }
    setStills((prev) => [newStill, ...prev])
    setCopiedGrade(cloneColorGrade(activeGrade))
    showToast(`Kare Yakalandı ve Renk Kopyalandı: ${newStill.name}`)
  }, [activeGrade, activeLut, player.timeRef, player.videoRef, showToast, stills.length, targetGradeClip])

  const handleCopyGrade = useCallback(() => {
    setCopiedGrade(cloneColorGrade(activeGrade))
    showToast(`Renk kopyalandı (${targetGradeClip?.name ?? 'Aktif Sahne'})`)
  }, [activeGrade, showToast, targetGradeClip])

  const handlePasteGrade = useCallback(() => {
    if (!copiedGrade) return
    updateActiveGrade(cloneColorGrade(copiedGrade))
    showToast(`Renk yapıştırıldı → ${targetGradeClip?.name ?? 'Aktif Sahne'}`)
  }, [copiedGrade, showToast, targetGradeClip, updateActiveGrade])

  const handleApplyStill = useCallback(
    (still: GradeStill) => {
      updateActiveGrade(cloneColorGrade(still.grade))
      setCopiedGrade(cloneColorGrade(still.grade))
      showToast(`Referans kare rengi uygulandı: ${still.name}`)
    },
    [showToast, updateActiveGrade]
  )

  const handleDeleteStill = useCallback(
    (stillId: string) => {
      setStills((prev) => prev.filter((s) => s.id !== stillId))
      showToast('Referans kare silindi')
    },
    [showToast]
  )

  // 3) Sinematik Ses Tasarımı & Auto-Ducking (Noir Soundscape)
  const handleToggleAutoDucking = useCallback(() => {
    recordHistory('Auto-Ducking Değiştir')
    setAutoDucking((prev) => {
      const next = !prev
      showToast(
        next
          ? 'Auto-Ducking Aktif: Diyalog yükseldiğinde A2 müziği otomatik kısılır (-11dB)'
          : 'Auto-Ducking Kapatıldı'
      )
      return next
    })
  }, [recordHistory, showToast])

  const handleAddSoundscapeClip = useCallback(
    async (presetId: NoirSoundscapeId) => {
      if (!window.noircut?.generateSoundscape) return
      const item = await window.noircut.generateSoundscape(presetId)
      if (!item) {
        showToast('Ses efekti sentezlenemedi')
        return
      }
      lib.registerVirtualMedia(item)
      const preset = NOIR_SOUNDSCAPE_PRESETS.find((p) => p.id === presetId)
      recordHistory(`SFX Ekle: ${preset?.label ?? item.name}`)

      const id = `clip-${nextId.current++}`
      const playhead = Number(player.timeRef.current.toFixed(2))
      setClips((cs) => {
        const overlapsOnLane = (lane: LaneId, s: number, dur: number) =>
          cs.some((c) => c.lane === lane && s < clipEnd(c) && s + dur > c.start)

        let targetLane: LaneId = 'A2'
        let start = playhead
        if (overlapsOnLane('A2', playhead, item.duration)) {
          if (!overlapsOnLane('A1', playhead, item.duration)) {
            targetLane = 'A1'
          } else {
            start = cs
              .filter((c) => c.lane === 'A2')
              .reduce((max, c) => Math.max(max, clipEnd(c)), playhead)
          }
        }
        const sfxClip: TimelineClip = {
          id,
          mediaId: item.id,
          lane: targetLane,
          name: item.name,
          start,
          in: 0,
          duration: item.duration,
          gainDb: presetId === 'night-rain' ? -4 : 0,
          fadeIn: presetId === 'night-rain' ? 0.6 : 0.15,
          fadeOut: presetId === 'night-rain' ? 0.8 : 0.35,
          audioDetached: false,
          speed: 100,
          reverse: false,
          transitionType: 'none',
          transitionDuration: 0.8,
          pan: 0,
          audioPreset: presetId === 'sub-drop' ? 'bass-boost' : 'none'
        }
        return [...cs, sfxClip]
      })
      setSelectedClipId(id)
      showToast(`${item.name} timeline'a eklendi (${playhead.toFixed(2)}s)`)
    },
    [lib, player.timeRef, recordHistory, showToast]
  )

  // Otomatik Beyaz Dengesi (Auto WB): Aktif video karesini örnekleyip Gray-World / Highlight-Neutral analizi yapar
  const handleAutoWhiteBalance = useCallback(() => {
    const video = player.videoRef.current
    const canvas = document.createElement('canvas')
    const w = 96
    const h = 54
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        ctx.drawImage(video, 0, 0, w, h)
      } catch {
        // fallback to scene gradient below
      }
    } else {
      // Video seçili değilse yer tutucu günbatımı sahnesini örnekle
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#5d7a96')
      grad.addColorStop(0.55, '#c9b79a')
      grad.addColorStop(1, '#d9a76a')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    const imgData = ctx.getImageData(0, 0, w, h)
    const { temperature, tint } = computeAutoWhiteBalance(imgData.data, activeGrade.exposure)
    updateActiveGrade({
      ...activeGrade,
      temperature,
      tint
    })
    setWbPickerActive(false)
    const tStr = temperature > 0 ? `+${temperature}` : `${temperature}`
    const tnStr = tint > 0 ? `+${tint}` : `${tint}`
    showToast(`Auto WB uygulandı · Sıcaklık: ${tStr}, Ton: ${tnStr}`)
  }, [activeGrade, player.videoRef, showToast, updateActiveGrade])

  // Damlalık Seçici (Eyedropper WB Picker): Tıklanan pikselin RGB değerine göre beyaz dengesini kalibre eder
  const handlePickWbRgb = useCallback(
    (r01: number, g01: number, b01: number) => {
      const { temperature, tint } = computeWhiteBalanceFromRgb(
        r01,
        g01,
        b01,
        activeGrade.exposure
      )
      updateActiveGrade({
        ...activeGrade,
        temperature,
        tint
      })
      setWbPickerActive(false)
      const tStr = temperature > 0 ? `+${temperature}` : `${temperature}`
      const tnStr = tint > 0 ? `+${tint}` : `${tint}`
      showToast(`Damlalık WB kalibre edildi · Sıcaklık: ${tStr}, Ton: ${tnStr}`)
    },
    [activeGrade, showToast, updateActiveGrade]
  )

  // Sessizlik Algılama (Silence Detection) Aksiyonları (Kullanıcı Onaylı)
  const handleAddMarkersFromSilence = useCallback(
    (regions: SilenceRegion[]) => {
      if (regions.length === 0) return
      recordHistory(`Sessizlik İşaretçileri (${regions.length})`)
      setMarkers((ms) => {
        const added: CaseMarker[] = regions.map((r, idx) => ({
          id: `marker-${nextId.current++}`,
          time: round3(r.start),
          title: `Sessiz #${idx + 1} (${r.duration.toFixed(2)}s)`,
          note: `${r.avgDb} dB · ${r.start.toFixed(2)}s – ${r.end.toFixed(2)}s`,
          color: 'cyan'
        }))
        return [...ms, ...added].sort((a, b) => a.time - b.time)
      })
      showToast(`${regions.length} sessiz bölge için timeline işaretçisi eklendi`)
    },
    [recordHistory, showToast]
  )

  const handleSplitClipsAtSilence = useCallback(
    (regions: SilenceRegion[], syncLinked: boolean) => {
      if (regions.length === 0) return
      recordHistory('Sessizlik Sınırlarından Klipleri Böl')
      const cutTimes = Array.from(
        new Set(regions.flatMap((r) => [round3(r.start), round3(r.end)]))
      ).sort((a, b) => a - b)

      setClips((prev) => {
        let current = prev
        for (const t of cutTimes) {
          current = current.flatMap((c) => {
            if (stateSnapshotRef.current.lanes[c.lane]?.locked) return [c]
            if (!syncLinked && isVideoLane(c.lane) && c.audioDetached) return [c]
            if (t <= c.start + 0.06 || t >= clipEndExact(c) - 0.06) return [c]
            const leftDur = round3(t - c.start)
            const rightDur = round3(clipEndExact(c) - t)
            const spd = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
            const left: TimelineClip = {
              ...c,
              duration: leftDur,
              fadeIn: Math.min(c.fadeIn, leftDur),
              fadeOut: 0
            }
            const right: TimelineClip = {
              ...c,
              id: `clip-${nextId.current++}`,
              start: t,
              in: round3(c.in + leftDur * spd),
              duration: rightDur,
              fadeIn: 0,
              fadeOut: Math.min(c.fadeOut, rightDur),
              linkedClipId: null
            }
            return [left, right]
          })
        }
        return current
      })
      showToast(`${regions.length} sessiz bölge sınırından klipler bölündü`)
    },
    [recordHistory, showToast]
  )

  const handleRemoveDetectedSilence = useCallback(
    (regions: SilenceRegion[], syncLinked: boolean) => {
      if (regions.length === 0) return
      recordHistory('Sessiz Bölgeleri Çıkar & Boşlukları Kapat')
      const sortedRegs = [...regions].sort((a, b) => a.start - b.start)

      setClips((prev) => {
        let current = prev
        for (const reg of sortedRegs) {
          current = current.flatMap((c) => {
            if (stateSnapshotRef.current.lanes[c.lane]?.locked) return [c]
            if (!syncLinked && isVideoLane(c.lane) && c.audioDetached) return [c]
            const cEnd = clipEndExact(c)
            if (reg.end <= c.start + 0.04 || reg.start >= cEnd - 0.04) return [c]
            const spd = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))
            const pieces: TimelineClip[] = []
            if (reg.start > c.start + 0.08) {
              const leftDur = round3(reg.start - c.start)
              pieces.push({
                ...c,
                duration: leftDur,
                fadeIn: Math.min(c.fadeIn, leftDur),
                fadeOut: 0
              })
            }
            if (reg.end < cEnd - 0.08) {
              const offset = round3(reg.end - c.start)
              const rightDur = round3(cEnd - reg.end)
              pieces.push({
                ...c,
                id: pieces.length === 0 ? c.id : `clip-${nextId.current++}`,
                start: round3(reg.end),
                in: round3(c.in + offset * spd),
                duration: rightDur,
                fadeIn: 0,
                fadeOut: Math.min(c.fadeOut, rightDur),
                linkedClipId: null
              })
            }
            return pieces
          })
        }
        // Her kanalda oluşan boşlukları sırayla kapat
        const byLane = new Map<LaneId, TimelineClip[]>()
        for (const c of current) {
          const arr = byLane.get(c.lane) ?? []
          arr.push(c)
          byLane.set(c.lane, arr)
        }
        const repositioned = new Map<string, number>()
        for (const [, laneList] of byLane.entries()) {
          laneList.sort((a, b) => a.start - b.start)
          let cursor = 0
          for (const c of laneList) {
            repositioned.set(c.id, round3(cursor))
            cursor = round3(cursor + c.duration)
          }
        }
        return current.map((c) =>
          repositioned.has(c.id) ? { ...c, start: repositioned.get(c.id)! } : c
        )
      })
      showToast(`${regions.length} sessiz bölge çıkarıldı ve senkron korundu`)
    },
    [recordHistory, showToast]
  )

  const buildCurrentProject = useCallback(
    (): NoirCutProject => ({
      version: 1,
      savedAt: new Date().toISOString(),
      activeMediaId: lib.activeId,
      mediaRefs: lib.items.map((m) => ({ id: m.id, path: m.path })),
      clips,
      lanes,
      markers,
      stills,
      subtitles,
      subtitleStyle,
      masterGainDb,
      autoDucking,
      customLuts,
      draftCredit,
      fallbackGrade,
      exportSettings
    }),
    [
      autoDucking,
      clips,
      customLuts,
      draftCredit,
      exportSettings,
      fallbackGrade,
      lanes,
      lib.activeId,
      lib.items,
      markers,
      masterGainDb,
      stills,
      subtitleStyle,
      subtitles
    ]
  )

  // Arka plan otomatik kayıt (8 saniye debounce)
  useEffect(() => {
    if (clips.length === 0 && markers.length === 0) return
    if (!window.noircut?.writeAutosave) return
    const timer = window.setTimeout(() => {
      void window.noircut?.writeAutosave?.(buildCurrentProject(), 'Otomatik Yedek')
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [buildCurrentProject, clips.length, markers.length])

  const handleSaveProject = useCallback(async () => {
    if (!window.noircut?.saveProject) return
    const project = buildCurrentProject()
    const res = await window.noircut.saveProject(project)
    if (res.canceled) return
    if (res.ok) {
      recordRecentProject(res.path)
      void window.noircut?.dismissAutosave?.()
      showToast(`Proje kaydedildi: ${res.path?.split(/[\\/]/).pop() ?? ''}`)
    } else {
      alert(`Proje kaydedilemedi:\n${res.error ?? 'Bilinmeyen hata'}`)
    }
  }, [buildCurrentProject, recordRecentProject, showToast])

  const applyLoadedProjectResult = useCallback(
    (res: Awaited<ReturnType<NonNullable<typeof window.noircut>['loadProject']>>) => {
      if (!res.ok || !res.project) {
        alert(`Proje açılamadı:\n${res.error ?? 'Bilinmeyen hata'}`)
        return false
      }
      const proj = res.project
      skipNextAutoPlaceRef.current = true
      lib.replaceAll(res.mediaItems ?? [], proj.activeMediaId ?? null)
      setClips(proj.clips ?? [])
      setLanes(normalizeLanesMap(proj.lanes, proj.clips))
      setMarkers(proj.markers ?? [])
      setActiveMarkerId(null)
      setStills(proj.stills ?? [])
      setSubtitles(proj.subtitles ?? [])
      setSubtitleStyle(proj.subtitleStyle ?? defaultSubtitleStyle())
      setMasterGainDb(typeof proj.masterGainDb === 'number' ? proj.masterGainDb : 0)
      setAutoDucking(Boolean(proj.autoDucking))
      setCustomLuts(proj.customLuts ?? {})
      setDraftCredit(proj.draftCredit ?? defaultCreditConfig('noir-opening'))
      setFallbackGrade(proj.fallbackGrade ?? defaultColorGrade())
      if (proj.exportSettings) setExportSettings(proj.exportSettings)
      setSelectedClipId(null)
      player.seek(0)
      if (res.path) recordRecentProject(res.path)
      setShowLauncher(false)

      if (res.mediaErrors && res.mediaErrors.length > 0) {
        alert(`Bazı medya dosyaları bulunamadı:\n${res.mediaErrors.join('\n')}`)
      }
      showToast(
        res.path
          ? `Proje yüklendi: ${res.path.split(/[\\/]/).pop() ?? ''}`
          : 'Otomatik yedekten oturum kurtarıldı'
      )
      return true
    },
    [lib, player, recordRecentProject, showToast]
  )

  const handleRestoreAutosave = useCallback(
    async (snapshotId: string) => {
      if (!window.noircut?.restoreAutosave) return
      const res = await window.noircut.restoreAutosave(snapshotId)
      if (applyLoadedProjectResult(res)) {
        const st = await window.noircut.getAutosaveStatus?.()
        if (st) setAutosaveStatus(st)
      }
    },
    [applyLoadedProjectResult]
  )

  const handleDismissAutosave = useCallback(async () => {
    await window.noircut?.dismissAutosave?.()
    setAutosaveStatus((prev) => (prev ? { ...prev, hasUncleanExit: false } : prev))
  }, [])

  const handleLoadProject = useCallback(async () => {
    if (!window.noircut?.loadProject) return
    const res = await window.noircut.loadProject()
    if (res.canceled) return
    applyLoadedProjectResult(res)
  }, [applyLoadedProjectResult])

  const handleOpenRecentProject = useCallback(
    async (filePath: string) => {
      if (!window.noircut?.loadProjectByPath) return
      const res = await window.noircut.loadProjectByPath(filePath)
      applyLoadedProjectResult(res)
    },
    [applyLoadedProjectResult]
  )

  const handleStartFreshStudio = useCallback(() => {
    setClips([])
    setLanes(defaultLanes())
    setMarkers([])
    setActiveMarkerId(null)
    setStills([])
    setSelectedClipId(null)
    setFallbackGrade(defaultColorGrade())
    setUndoStack([])
    setRedoStack([])
    lib.replaceAll([], null)
    player.seek(0)
    setShowLauncher(false)
    showToast('Yeni stüdyo kurgusu başlatıldı')
  }, [lib, player, showToast])

  const buildCreditOverlays = useCallback(
    async (resKey: ExportSettings['resolution']) => {
      const creditList = clips
        .filter((c) => isCreditClip(c) && c.credit)
        .map((c) => c.credit!)
      if (creditList.length > 0) {
        await ensureCreditFontsReady(creditList)
      }
      const { width, height } = EXPORT_RESOLUTION_DIM[resKey]
      const creditOverlays: Record<string, CreditExportOverlay> = {}
      for (const c of clips) {
        if (isCreditClip(c) && c.credit) {
          creditOverlays[c.id] = renderCreditToPng(c.credit, width, height)
        }
      }
      return creditOverlays
    },
    [clips]
  )

  const buildSubtitleOverlays = useCallback(
    (settings: ExportSettings) => {
      if (settings.burnInSubtitles === false || subtitles.length === 0) return []
      const { width, height } = EXPORT_RESOLUTION_DIM[settings.resolution]
      return renderSubtitlesToPngOverlays(subtitles, subtitleStyle, width, height)
    },
    [subtitleStyle, subtitles]
  )

  const handleStartExport = useCallback(async () => {
    if (exporting || !window.noircut?.exportProject) return
    setExporting(true)
    setExportProgress(0)
    setExportResultPath(null)
    setExportError(null)
    try {
      const creditOverlays = await buildCreditOverlays(exportSettings.resolution)
      const subtitleOverlays = buildSubtitleOverlays(exportSettings)
      const useRange = Boolean(exportSettings.useInOutRange && (inPoint !== null || outPoint !== null))
      const res = await window.noircut.exportProject({
        clips,
        lanes,
        customLuts,
        creditOverlays,
        subtitleOverlays,
        subtitles,
        subtitleStyle,
        masterGainDb,
        settings: exportSettings,
        autoDucking,
        rangeStart: useRange ? (inPoint ?? 0) : null,
        rangeEnd: useRange ? (outPoint ?? projectEnd(clips)) : null
      })
      if (res.canceled) return
      if (res.ok && res.path) {
        setExportResultPath(res.path)
        setRenderLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] TAMAMLANDI: ${res.path}`
        ])
      } else {
        setExportError(res.error ?? 'Bilinmeyen hata')
        setRenderLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] HATA: ${res.error ?? 'Bilinmeyen hata'}`
        ])
      }
    } finally {
      setExporting(false)
    }
  }, [
    autoDucking,
    buildCreditOverlays,
    buildSubtitleOverlays,
    clips,
    customLuts,
    exportSettings,
    exporting,
    inPoint,
    lanes,
    masterGainDb,
    outPoint,
    subtitleStyle,
    subtitles
  ])

  const handleAddToQueue = useCallback(async () => {
    if (!window.noircut?.selectExportPath) return
    if (clips.length === 0) {
      showToast('Kuyruğa eklenecek klip bulunmuyor')
      return
    }
    const ext = exportSettings.format === 'mov' ? 'mov' : 'mp4'
    const defaultName = `NoirCut-${exportSettings.resolution}-${exportSettings.fps}fps.${ext}`
    const targetPath = await window.noircut.selectExportPath(exportSettings.format, defaultName)
    if (!targetPath) return
    const useRange = Boolean(exportSettings.useInOutRange && (inPoint !== null || outPoint !== null))
    const job: ExportQueueJob = {
      id: `qjob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `${EXPORT_RESOLUTION_DIM[exportSettings.resolution].label} · ${exportSettings.fps}fps · ${(exportSettings.codec ?? 'h264').toUpperCase()} · ${exportSettings.format.toUpperCase()}`,
      outputPath: targetPath,
      settings: { ...exportSettings },
      rangeStart: useRange ? (inPoint ?? 0) : null,
      rangeEnd: useRange ? (outPoint ?? projectEnd(clips)) : null,
      status: 'pending',
      progress: 0
    }
    setExportQueue((prev) => [...prev, job])
    showToast('Render kuyruğuna eklendi')
  }, [clips, exportSettings, inPoint, outPoint, showToast])

  const handlePauseResumeQueue = useCallback(async () => {
    if (!queueRunning) return
    if (!queuePaused) {
      await window.noircut?.pauseExport?.()
      setQueuePaused(true)
      const qid = activeQueueJobIdRef.current
      if (qid) {
        setExportQueue((prev) =>
          prev.map((j) => (j.id === qid ? { ...j, status: 'paused' } : j))
        )
      }
      showToast('Render duraklatıldı')
    } else {
      await window.noircut?.resumeExport?.()
      setQueuePaused(false)
      const qid = activeQueueJobIdRef.current
      if (qid) {
        setExportQueue((prev) =>
          prev.map((j) => (j.id === qid ? { ...j, status: 'running' } : j))
        )
      }
      showToast('Render devam ediyor')
    }
  }, [queuePaused, queueRunning, showToast])

  const handleRetryQueueJob = useCallback((jobId: string) => {
    setExportQueue((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: 'pending', progress: 0, error: undefined, etaSec: null } : j
      )
    )
  }, [])

  const handleCancelQueueJob = useCallback(async (jobId: string) => {
    if (activeQueueJobIdRef.current === jobId) {
      await window.noircut?.cancelExport?.()
    } else {
      setExportQueue((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'canceled' } : j))
      )
    }
  }, [])

  const handleStartQueue = useCallback(async () => {
    if (queueRunning || exporting || !window.noircut?.exportProject) return
    const pendingJobs = exportQueue.filter((j) => j.status === 'pending')
    if (pendingJobs.length === 0) return
    setQueueRunning(true)
    setQueuePaused(false)
    setExporting(true)
    try {
      for (const job of pendingJobs) {
        activeQueueJobIdRef.current = job.id
        activeJobStartWallRef.current = performance.now()
        setExportProgress(0)
        setRenderLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] BAŞLATILDI: ${job.label} → ${job.outputPath}`
        ])
        setExportQueue((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: 'running', progress: 0, startedAt: Date.now(), etaSec: null }
              : j
          )
        )
        const creditOverlays = await buildCreditOverlays(job.settings.resolution)
        const subtitleOverlays = buildSubtitleOverlays(job.settings)
        const res = await window.noircut.exportProject({
          clips,
          lanes,
          customLuts,
          creditOverlays,
          subtitleOverlays,
          subtitles,
          subtitleStyle,
          masterGainDb,
          settings: job.settings,
          autoDucking,
          outputPath: job.outputPath,
          rangeStart: job.rangeStart,
          rangeEnd: job.rangeEnd
        })
        setRenderLogs((prev) => [
          ...prev,
          res.ok
            ? `[${new Date().toLocaleTimeString()}] TAMAMLANDI: ${job.outputPath}`
            : `[${new Date().toLocaleTimeString()}] ${res.canceled ? 'İPTAL' : 'HATA'}: ${res.error ?? job.outputPath}`
        ])
        setExportQueue((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: res.canceled ? 'canceled' : res.ok ? 'done' : 'error',
                  progress: res.ok ? 100 : j.progress,
                  etaSec: null,
                  error: res.error
                }
              : j
          )
        )
        if (res.canceled) break
      }
    } finally {
      activeQueueJobIdRef.current = null
      setExporting(false)
      setQueueRunning(false)
      setQueuePaused(false)
    }
  }, [
    autoDucking,
    buildCreditOverlays,
    buildSubtitleOverlays,
    clips,
    customLuts,
    exportQueue,
    exporting,
    lanes,
    masterGainDb,
    queueRunning,
    subtitleStyle,
    subtitles
  ])

  // Profesyonel NLE Klavye Kısayolları:
  // Space = oynat/durdur, J = geri sar (1x/2x), K = durdur, L = ileri oynat (1x/2x/4x),
  // I / O = Giriş/Çıkış işaretle, M = Sahne İşaretçisi (Case Marker), C = kes, Delete/Backspace = sil, Ctrl+Z / Ctrl+Shift+Z = Geri Al / Yinele
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
      const keyLower = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && keyLower === 's') {
        e.preventDefault()
        handleSaveProject()
        return
      }
      if ((e.ctrlKey || e.metaKey) && keyLower === 'o') {
        e.preventDefault()
        handleLoadProject()
        return
      }
      if ((e.ctrlKey || e.metaKey) && keyLower === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && keyLower === 'y') {
        e.preventDefault()
        handleRedo()
        return
      }
      if (isTyping(e.target) || e.repeat) return
      if ((e.ctrlKey || e.metaKey) && keyLower === 'a') {
        e.preventDefault()
        handleSelectAllClips()
        return
      }
      if ((e.ctrlKey || e.metaKey) && keyLower === 'g') {
        e.preventDefault()
        handleGroupSelected()
        return
      }
      if (e.key === 'Escape') {
        if (stateSnapshotRef.current.selectedClipIds.length > 0) {
          e.preventDefault()
          handleClearSelection()
          return
        }
      }
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (keyLower === 'j' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const rate = player.shuttleReverse()
        if (rate < 0) showToast(`◀◀ Geri Sarma ${Math.abs(rate)}x (J)`)
      } else if (keyLower === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        player.shuttlePause()
        showToast('❚❚ Durduruldu (K)')
      } else if (keyLower === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const rate = player.shuttleForward()
        if (rate > 0) showToast(`▶▶ İleri Oynatma ${rate}x (L)`)
      } else if (keyLower === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleMarkIn()
      } else if (keyLower === 'o' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleMarkOut()
      } else if (keyLower === 'm' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleAddMarkerAtPlayhead()
      } else if (keyLower === 'c' && !e.ctrlKey && !e.metaKey) {
        cut()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (e.shiftKey || rippleMode) {
          rippleDeleteSelected()
        } else {
          deleteSelected()
        }
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
  }, [
    cut,
    deleteSelected,
    handleAddMarkerAtPlayhead,
    handleLoadProject,
    handleMarkIn,
    handleMarkOut,
    handleRedo,
    handleSaveProject,
    handleSelectAllClips,
    handleGroupSelected,
    handleClearSelection,
    handleUndo,
    player.shuttleForward,
    player.shuttlePause,
    player.shuttleReverse,
    player.toggle,
    rippleDeleteSelected,
    rippleMode,
    showToast
  ])

  const engineLabel = !engine
    ? 'Motor kontrol ediliyor…'
    : engine.source === 'missing'
      ? 'FFmpeg bulunamadı'
      : `FFmpeg ${engine.version} · ${engine.source === 'embedded' ? 'gömülü' : 'sistem'} · ${engine.platform}`

  const monitorMedia = player.currentMedia ?? lib.active

  const activeV2Clip = useMemo(() => {
    const vLanesTopDown = [...getOrderedVideoLanesAsc(lanes, clips)].reverse()
    for (const laneId of vLanesTopDown) {
      if (!isLaneAudible(lanes, laneId)) continue
      const c = clipAt(clips, laneId, player.time)
      if (c && isCreditClip(c)) return c
    }
    return undefined
  }, [clips, lanes, player.time])

  const hasV2Clips = useMemo(() => clips.some((c) => isCreditClip(c)), [clips])

  const monitorCreditOverlay = useMemo(() => {
    if (activeV2Clip?.credit) {
      return {
        credit: activeV2Clip.credit,
        localTime: player.time - activeV2Clip.start,
        clipStart: activeV2Clip.start,
        duration: activeV2Clip.duration,
        isPreview: false
      }
    }
    // Timeline'da V2 jenerik klibi varken veya oynatma sırasında klip bittikten sonra tekrar etme
    if (tab === 'CREDITS' && !hasV2Clips && !selectedV2Clip) {
      const dur = Math.max(0.5, activeCredit.duration)
      if (player.time > dur) return null
      return {
        credit: activeCredit,
        localTime: player.time,
        clipStart: 0,
        duration: dur,
        isPreview: true
      }
    }
    return null
  }, [activeV2Clip, activeCredit, hasV2Clips, player.time, selectedV2Clip, tab])

  return (
    <div className="relative flex h-full flex-col gap-3 p-3">
      <CommandIsland
        tab={tab}
        onTab={setTab}
        theme={theme}
        onThemeChange={setTheme}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onOpenLauncher={() => setShowLauncher(true)}
        exportSettings={exportSettings}
        mediaItems={lib.items}
        onExport={() => {
          setExportResultPath(null)
          setExportError(null)
          setExportOpen(true)
        }}
      />

      <NoirLauncher
        open={showLauncher}
        engine={engine}
        appVersion={appVersion}
        recentProjects={recentProjects}
        hasActiveWork={clips.length > 0 || lib.items.length > 0}
        onEnterStudio={() => setShowLauncher(false)}
        onStartFreshStudio={handleStartFreshStudio}
        onOpenProjectDialog={handleLoadProject}
        onOpenRecentProject={handleOpenRecentProject}
        autosaveStatus={autosaveStatus}
        onRestoreAutosave={handleRestoreAutosave}
        onDismissAutosave={handleDismissAutosave}
      />

      {statusToast && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full border border-[var(--accent)]/50 bg-[var(--bg-panel)] px-4 py-1.5 font-mono text-[11px] text-[var(--accent)] shadow-lg">
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

      {player.orderedAudioLanes.map((laneId) => (
        <audio
          key={laneId}
          ref={(el) => player.registerAudioEl(laneId, el)}
          className="hidden"
          preload="auto"
        />
      ))}

      {tab === 'GRADE' ? (
        <div key="grade-ws" className="workspace-enter flex min-h-0 flex-1 flex-col">
          <GradeWorkspace
          media={monitorMedia}
          mediaItems={lib.items}
          mediaMap={mediaMap}
          v1Clips={v1Clips}
          activeClip={player.activePrimaryClip ?? targetGradeClip}
          overlayLayers={player.overlayVisualClips}
          registerOverlayVideoEl={player.registerOverlayVideoEl}
          registerVideoBufferEl={player.registerVideoBufferEl}
          selectedClipId={selectedClipId}
          onSelectClip={(clipId, seekTime) => {
            setSelectedClipId(clipId)
            if (seekTime !== undefined) player.seek(seekTime)
          }}
          onImportMedia={lib.importMedia}
          videoProps={player.videoProps}
          videoRef={player.videoRef}
          error={player.error}
          playing={player.playing}
          time={player.time}
          timeRef={player.timeRef}
          subscribeTime={player.subscribeTime}
          duration={player.duration || total}
          onToggle={player.toggle}
          onSeek={player.seek}
          onScrubStart={player.beginScrub}
          onScrubEnd={player.endScrub}
          onDropMedia={lib.setActiveId}
          grade={activeGrade}
          onGrade={updateActiveGrade}
          activeLut={activeLut}
          customLuts={Object.values(customLuts)}
          onImportLut={handleImportLut}
          onAutoWhiteBalance={handleAutoWhiteBalance}
          wbPickerActive={wbPickerActive}
          onToggleWbPicker={() => setWbPickerActive((v) => !v)}
          onPickWbRgb={handlePickWbRgb}
          onCancelWbPicker={() => setWbPickerActive(false)}
          stills={stills}
          hasCopiedGrade={copiedGrade !== null}
          onGrabStill={handleGrabStill}
          onCopyGrade={handleCopyGrade}
          onPasteGrade={handlePasteGrade}
          onApplyStill={handleApplyStill}
          onDeleteStill={handleDeleteStill}
          onApplyGradeToTimeline={applyGradeToAllV1}
          onRegisterImportedLut={registerImportedLut}
        />
        </div>
      ) : tab === 'EXPORT' ? (
        <div key="export-ws" className="workspace-enter flex min-h-0 flex-1 flex-col">
          <ExportWorkspace
          settings={exportSettings}
          onSettings={setExportSettings}
          exporting={exporting}
          progress={exportProgress}
          resultPath={exportResultPath}
          error={exportError}
          clipCount={clips.length}
          totalDuration={total}
          subtitleCount={subtitles.length}
          onStart={handleStartExport}
          onCancel={() => window.noircut?.cancelExport()}
          onReveal={(p) => window.noircut?.revealInFolder(p)}
          engine={engine}
          inPoint={inPoint}
          outPoint={outPoint}
          exportQueue={exportQueue}
          queueRunning={queueRunning}
          queuePaused={queuePaused}
          renderLogs={renderLogs}
          onAddToQueue={handleAddToQueue}
          onStartQueue={handleStartQueue}
          onPauseResumeQueue={handlePauseResumeQueue}
          onRetryQueueJob={handleRetryQueueJob}
          onCancelQueueJob={handleCancelQueueJob}
          onRemoveQueueJob={(id) =>
            setExportQueue((prev) => prev.filter((j) => j.id !== id))
          }
          onClearFinishedQueue={() =>
            setExportQueue((prev) =>
              prev.filter((j) => j.status === 'pending' || j.status === 'running' || j.status === 'paused')
            )
          }
        />
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 gap-3">
            {tab === 'AUDIO' ? (
              <AudioWorkspace
                activeClip={targetEditClip}
                clips={clips}
                lanes={lanes}
                peaksMap={lib.peaksMap}
                playing={player.playing}
                time={player.time}
                subscribeTime={player.subscribeTime}
                masterGainDb={masterGainDb}
                onMasterGainChange={setMasterGainDb}
                onToggleLane={(laneId, key) => {
                  if (key === 'muted') toggleMute(laneId)
                  else toggleSolo(laneId)
                }}
                onUpdateClip={updateClip}
                autoDucking={autoDucking}
                onToggleAutoDucking={handleToggleAutoDucking}
                onAddSoundscapeClip={handleAddSoundscapeClip}
                onSelectClip={setSelectedClipId}
              />
            ) : tab === 'SUBTITLES' ? (
              <SubtitlesWorkspace
                clips={clips}
                mediaMap={mediaMap}
                peaksMap={lib.peaksMap}
                subtitles={subtitles}
                subtitleStyle={subtitleStyle}
                time={player.time}
                fps={monitorMedia?.fps || 25}
                onUpdateSubtitles={(next) => {
                  recordHistory('Altyazı Güncelleme', 'subtitles')
                  setSubtitles(next)
                }}
                onUpdateSubtitleStyle={setSubtitleStyle}
                onSeek={player.seek}
                onAddMarkersFromSilence={handleAddMarkersFromSilence}
                onSplitClipsAtSilence={handleSplitClipsAtSilence}
                onRemoveDetectedSilence={handleRemoveDetectedSilence}
                onShowToast={showToast}
              />
            ) : (
              <>
                <LeftPanel
              tab={tab}
              width={leftWidth}
              media={lib.items}
              activeMediaId={lib.activeId}
              busy={lib.busy}
              errors={lib.errors}
              onImport={lib.importMedia}
              onSelectMedia={lib.setActiveId}
              onDismissErrors={lib.clearErrors}
              activeCreditTemplate={activeCredit.templateId}
              onSelectCreditTemplate={handleSelectCreditTemplate}
            />
            <div
              data-testid="left-panel-resizer"
              onPointerDown={startLeftResize}
              onDoubleClick={() => setLeftWidth(276)}
              title="Sürükle: Sol panel genişliğini ayarla · Çift tıkla: Sıfırla"
              className="group -mx-1.5 flex w-2.5 shrink-0 cursor-col-resize items-center justify-center"
            >
              <div className="h-14 w-[2px] rounded-full bg-white/10 transition-all duration-150 group-hover:h-24 group-hover:bg-[var(--accent)]" />
            </div>
            <Monitor
              media={monitorMedia}
              activeClip={player.activePrimaryClip ?? targetGradeClip}
              overlayLayers={player.overlayVisualClips}
              registerOverlayVideoEl={player.registerOverlayVideoEl}
              registerVideoBufferEl={player.registerVideoBufferEl}
              videoProps={player.videoProps}
              videoRef={player.videoRef}
              error={player.error}
              playing={player.playing}
              shuttleRate={player.shuttleRate}
              time={player.time}
              timeRef={player.timeRef}
              subscribeTime={player.subscribeTime}
              duration={player.duration || total}
              onToggle={player.toggle}
              onShuttleReverse={() => {
                const rate = player.shuttleReverse()
                if (rate < 0) showToast(`◀◀ Geri Sarma ${Math.abs(rate)}x (J)`)
              }}
              onShuttlePause={() => {
                player.shuttlePause()
                showToast('❚❚ Durduruldu (K)')
              }}
              onShuttleForward={() => {
                const rate = player.shuttleForward()
                if (rate > 0) showToast(`▶▶ İleri Oynatma ${rate}x (L)`)
              }}
              onSeek={player.seek}
              onScrubStart={player.beginScrub}
              onScrubEnd={player.endScrub}
              onDropMedia={lib.setActiveId}
              grade={activeGrade}
              activeLut={activeLut}
              creditOverlay={monitorCreditOverlay}
              wbPickerActive={wbPickerActive}
              onPickWbRgb={handlePickWbRgb}
              onCancelWbPicker={() => setWbPickerActive(false)}
              onGrabStill={handleGrabStill}
              onCopyGrade={handleCopyGrade}
              onPasteGrade={handlePasteGrade}
              hasCopiedGrade={copiedGrade !== null}
              proxyPlaybackMode={proxyPlaybackMode}
              onProxyPlaybackModeChange={handleProxyPlaybackModeChange}
              proxyScale={proxyScale}
              onProxyScaleChange={handleProxyScaleChange}
              onBatchProxyGenerate={handleBatchProxyGenerate}
              subtitles={subtitles}
              subtitleStyle={subtitleStyle}
            />
            <div
              data-testid="right-panel-resizer"
              onPointerDown={startRightResize}
              onDoubleClick={() => setRightWidth(316)}
              title="Sürükle: Sağ panel genişliğini ayarla · Çift tıkla: Sıfırla"
              className="group -mx-1.5 flex w-2.5 shrink-0 cursor-col-resize items-center justify-center"
            >
              <div className="h-14 w-[2px] rounded-full bg-white/10 transition-all duration-150 group-hover:h-24 group-hover:bg-[var(--accent)]" />
            </div>
            <RightPanel
              tab={tab}
              width={rightWidth}
              activeClip={targetEditClip}
              time={player.time}
              onSeek={player.seek}
              onUpdateClip={updateClip}
              grade={activeGrade}
              activeClipName={targetGradeClip?.name ?? null}
              onGrade={updateActiveGrade}
              onAutoWhiteBalance={handleAutoWhiteBalance}
              wbPickerActive={wbPickerActive}
              onToggleWbPicker={() => setWbPickerActive((v) => !v)}
              credit={activeCredit}
              onCredit={handleUpdateCredit}
              onAddCreditToTimeline={handleAddCreditToTimeline}
              autoDucking={autoDucking}
              onToggleAutoDucking={handleToggleAutoDucking}
              onAddSoundscapeClip={handleAddSoundscapeClip}
            />
              </>
            )}
          </div>

          {/* Timeline Yükseklik Ayar Tutamacı */}
          <div
            data-testid="timeline-resizer"
            onPointerDown={startTimelineResize}
            onDoubleClick={() => setTimelineHeight(DEFAULT_TIMELINE_HEIGHT)}
            title="Sürükle: Timeline yüksekliğini ayarla · Çift tıkla: Varsayılana sıfırla"
            className="group -my-1.5 flex h-2.5 shrink-0 cursor-row-resize items-center justify-center"
          >
            <div className="h-[2px] w-16 rounded-full bg-white/10 transition-colors group-hover:w-28 group-hover:bg-[var(--accent)]" />
          </div>

          <Timeline
            height={timelineHeight}
            clips={clips}
            mediaMap={mediaMap}
            peaksMap={lib.peaksMap}
            lanes={lanes}
            selectedClipId={selectedClipId}
            selectedClipIds={selectedClipIds}
            total={total}
            time={player.time}
            timeRef={player.timeRef}
            subscribeTime={player.subscribeTime}
            fps={monitorMedia?.fps || 25}
            playing={player.playing}
            shuttleRate={player.shuttleRate}
            canPlay={clips.length > 0 || !!lib.active}
            inPoint={inPoint}
            outPoint={outPoint}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onMarkIn={handleMarkIn}
            onMarkOut={handleMarkOut}
            onClearInOut={handleClearInOut}
            markers={markers}
            activeMarkerId={activeMarkerId}
            onAddMarkerAtPlayhead={handleAddMarkerAtPlayhead}
            onSelectMarker={setActiveMarkerId}
            onUpdateMarker={handleUpdateMarker}
            onDeleteMarker={handleDeleteMarker}
            onStepMarker={handleStepMarker}
            onSeek={player.seek}
            onScrubStart={player.beginScrub}
            onScrubEnd={player.endScrub}
            onPlay={player.toggle}
            onCut={cut}
            onDeleteSelected={deleteSelected}
            onRippleDelete={rippleDeleteSelected}
            onCloseGaps={closeGaps}
            onRippleCloseGap={handleRippleCloseGap}
            rippleMode={rippleMode}
            onToggleRippleMode={() => setRippleMode((v) => !v)}
            onDetachSelected={detachSelected}
            onSelectClip={handleSelectClip}
            onSelectClips={handleSelectClips}
            onUpdateClip={updateClip}
            onBatchUpdateClips={batchUpdateClips}
            onToggleMute={toggleMute}
            onToggleSolo={toggleSolo}
            onToggleLockLane={toggleLockLane}
            onToggleHideLane={toggleHideLane}
            onDuplicateLane={duplicateLane}
            onReorderLane={reorderLane}
            onAddVideoLane={addVideoLane}
            onAddAudioLane={addAudioLane}
            onRemoveLane={removeLane}
            onDropMediaToLane={dropMediaToLane}
            onCutClipAt={cutClipAt}
            onGroupSelected={handleGroupSelected}
            onLinkSelected={handleLinkSelected}
            onNestSelected={handleNestSelected}
          />
        </>
      )}

      <div className="pointer-events-none absolute bottom-[3px] right-5 flex items-center gap-1.5 font-mono text-[9px] text-white/30">
        <span className={`h-1.5 w-1.5 rounded-full ${engine?.source === 'missing' ? 'bg-crimson' : 'bg-[var(--accent)]'}`} />
        {engineLabel}
      </div>
    </div>
  )
}
