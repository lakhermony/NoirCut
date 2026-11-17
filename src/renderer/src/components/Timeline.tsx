import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CASE_MARKER_COLOR_META,
  LANES,
  formatDb,
  isLaneAudible,
  type CaseMarker,
  type CaseMarkerColor,
  type LaneId,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem, PeaksResult } from '../../../shared/types'
import { fmt } from '../lib/format'
import { MEDIA_DRAG_TYPE } from './LeftPanel'
import WaveformCanvas from './WaveformCanvas'

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
const MAX_ZOOM = 8

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-md bg-white/[0.09] px-1.5 py-px font-mono text-[8px] font-semibold leading-tight text-white/70 shadow-[inset_0_-1px_0_rgba(0,0,0,0.45)]">
      {children}
    </kbd>
  )
}

const SHORTCUT_GUIDE: { group: string; items: [string, string][] }[] = [
  {
    group: 'Oynatma',
    items: [
      ['Space', 'Oynat / Durdur'],
      ['J', 'Geri sar (1x → 2x)'],
      ['K', 'Durdur'],
      ['L', 'İleri oynat (1x → 2x → 4x)']
    ]
  },
  {
    group: 'Kurgu',
    items: [
      ['C', 'Playhead\'den kes (Razor)'],
      ['Del', 'Seçili klibi sil'],
      ['Shift+Del', 'Ripple sil (boşluğu kapat)'],
      ['Klip Sürükle', 'Zaman ekseninde taşı / Kenar trim'],
      ['M', 'Sahne işaretçisi ekle'],
      ['I / O', 'Giriş / Çıkış noktası'],
      ['Ctrl + Tekerlek', 'Timeline yakınlaştır / uzaklaştır'],
      ['Tekerlek / Alt + Tekerlek', 'Timeline\'ı sağa / sola kaydır']
    ]
  },
  {
    group: 'Proje',
    items: [
      ['Ctrl+Z', 'Geri al'],
      ['Ctrl+Shift+Z', 'Yinele'],
      ['Ctrl+S', 'Projeyi kaydet'],
      ['Ctrl+O', 'Proje aç']
    ]
  }
]

function shuttleLabel(rate: number, playing: boolean): string | null {
  if (!playing || rate === 0) return null
  if (rate < 0) return `<< ${Math.abs(rate)}x`
  return rate === 1 ? '1x' : `${rate}x >>`
}

export default function Timeline({
  clips,
  mediaMap,
  peaksMap,
  lanes,
  selectedClipId,
  total,
  time,
  fps,
  playing,
  shuttleRate = 0,
  canPlay,
  inPoint = null,
  outPoint = null,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onMarkIn,
  onMarkOut,
  onClearInOut,
  markers = [],
  activeMarkerId = null,
  onSelectMarker,
  onAddMarkerAtPlayhead,
  onUpdateMarker,
  onDeleteMarker,
  onStepMarker,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onPlay,
  onCut,
  onDeleteSelected,
  onRippleDelete,
  onCloseGaps,
  rippleMode = false,
  onToggleRippleMode,
  onDetachSelected,
  onSelectClip,
  onUpdateClip,
  onToggleMute,
  onToggleSolo,
  onDropMediaToLane,
  height = 252
}: {
  clips: TimelineClip[]
  mediaMap: Map<string, MediaItem>
  peaksMap: Record<string, PeaksResult>
  lanes: LaneMap
  selectedClipId: string | null
  total: number
  time: number
  fps: number
  playing: boolean
  shuttleRate?: number
  canPlay: boolean
  inPoint?: number | null
  outPoint?: number | null
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onMarkIn?: () => void
  onMarkOut?: () => void
  onClearInOut?: () => void
  markers?: CaseMarker[]
  activeMarkerId?: string | null
  onSelectMarker?: (id: string | null) => void
  onAddMarkerAtPlayhead?: () => void
  onUpdateMarker?: (id: string, patch: Partial<CaseMarker>) => void
  onDeleteMarker?: (id: string) => void
  onStepMarker?: (dir: -1 | 1) => void
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onPlay: () => void
  onCut: () => void
  onDeleteSelected: () => void
  onRippleDelete?: () => void
  onCloseGaps?: (lane?: LaneId) => void
  rippleMode?: boolean
  onToggleRippleMode?: () => void
  onDetachSelected: () => void
  onSelectClip: (id: string | null) => void
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  onToggleMute: (lane: LaneId) => void
  onToggleSolo: (lane: LaneId) => void
  onDropMediaToLane: (mediaId: string, lane: LaneId) => void
  height?: number
}) {
  const area = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const [showGuide, setShowGuide] = useState(false)
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null)
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null)
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null)

  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const usable = Math.max(120, width - 40)
  const pps = (total > 0 ? usable / total : 40) * zoom

  // Ctrl + Tekerlek = Zoom (imleç altındaki an sabit kalır), Alt + Tekerlek = Sağa/Sola kaydır
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const ppsRef = useRef(pps)
  ppsRef.current = pps
  const pendingAnchor = useRef<{ time: number; x: number } | null>(null)

  useLayoutEffect(() => {
    const el = area.current
    const a = pendingAnchor.current
    if (!el || !a) return
    el.scrollLeft = Math.max(0, a.time * ppsRef.current - a.x)
    pendingAnchor.current = null
  }, [zoom])

  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left
        const factor = Math.exp(-e.deltaY * 0.0025)
        const next = Math.max(0.5, Math.min(MAX_ZOOM, zoomRef.current * factor))
        if (next === zoomRef.current) return
        pendingAnchor.current = { time: (x + el.scrollLeft) / ppsRef.current, x }
        setZoom(Number(next.toFixed(3)))
      } else {
        e.preventDefault()
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        el.scrollLeft += delta
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const seekFromClientX = (clientX: number) => {
    if (!canPlay || total <= 0 || !area.current) return
    const r = area.current.getBoundingClientRect()
    const x = clientX - r.left + area.current.scrollLeft
    let t = Math.max(0, Math.min(total, x / pps))
    if (snap) {
      const thresh = 8 / pps
      let best = t
      let bestDist = thresh
      for (const c of clips) {
        for (const edge of [c.start, c.start + c.duration]) {
          const d = Math.abs(t - edge)
          if (d < bestDist) {
            bestDist = d
            best = edge
          }
        }
      }
      t = best
    }
    onSeek(t)
  }

  const step = STEPS.find((s) => s * pps >= 70) ?? STEPS[STEPS.length - 1]
  const ticks =
    total > 0 ? Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step) : []
  const label = (t: number) =>
    t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null
  const activeMarker = markers.find((m) => m.id === activeMarkerId) ?? null
  const canDetach =
    Boolean(selectedClip && selectedClip.lane === 'V1' && !selectedClip.audioDetached) &&
    Boolean(selectedClip && mediaMap.get(selectedClip.mediaId)?.hasAudio)

  // Köşe tutamaçlarından Fade In / Fade Out sürükleme
  const startFadeDrag = (
    e: React.PointerEvent,
    clip: TimelineClip,
    side: 'in' | 'out'
  ) => {
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const initVal = side === 'in' ? clip.fadeIn : clip.fadeOut

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const deltaSec = (side === 'in' ? dx : -dx) / pps
      const maxFade = Math.max(0, clip.duration - (side === 'in' ? clip.fadeOut : clip.fadeIn))
      const next = Math.max(0, Math.min(maxFade, Number((initVal + deltaSec).toFixed(2))))
      onUpdateClip(clip.id, side === 'in' ? { fadeIn: next } : { fadeOut: next })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Klip taşıma ve sol/sağ kenar kırpma (Trim)
  const startClipDrag = (
    e: React.PointerEvent,
    clip: TimelineClip,
    mode: 'move' | 'trim-left' | 'trim-right'
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelectClip(clip.id)

    const target = e.currentTarget as HTMLElement
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // yoksay
    }

    const startX = e.clientX
    const initStart = clip.start
    const initIn = clip.in
    const initDur = clip.duration
    const initEnd = initStart + initDur
    const initKeyframes = clip.keyframes ? clip.keyframes.map((k) => ({ ...k })) : undefined
    const spd = Math.max(0.25, Math.min(4.0, (clip.speed ?? 100) / 100))
    const m = mediaMap.get(clip.mediaId)
    const isUnbounded = clip.lane === 'V2' || m?.mediaKind === 'image'
    const mediaDur = m?.duration ?? initIn + initDur * spd + 120

    const lanePeers = clips
      .filter((o) => o.lane === clip.lane && o.id !== clip.id)
      .slice()
      .sort((a, b) => a.start - b.start)

    const prevNeighbor = [...lanePeers].reverse().find((o) => o.start + o.duration <= initStart + 0.02)
    const nextNeighbor = lanePeers.find((o) => o.start >= initEnd - 0.02)
    const minTrimStart = prevNeighbor ? prevNeighbor.start + prevNeighbor.duration : 0
    const maxTrimEnd = nextNeighbor ? nextNeighbor.start : Infinity

    const snapTargets: number[] = [0, time]
    for (const o of clips) {
      if (o.id === clip.id) continue
      snapTargets.push(o.start, o.start + o.duration)
    }
    for (const mk of markers) snapTargets.push(mk.time)

    const findSnap = (t: number): number | null => {
      if (!snap) return null
      const thresh = 8 / Math.max(1, pps)
      let best: number | null = null
      let bestDist = thresh
      for (const s of snapTargets) {
        const d = Math.abs(t - s)
        if (d < bestDist) {
          bestDist = d
          best = s
        }
      }
      return best
    }

    const clampNonOverlapMove = (candStart: number): number => {
      let s = Math.max(0, candStart)
      for (const o of lanePeers) {
        const oEnd = o.start + o.duration
        if (s < oEnd && s + initDur > o.start) {
          const leftPos = Math.max(0, o.start - initDur)
          const rightPos = oEnd
          const leftFree = !lanePeers.some((p) => p !== o && leftPos < p.start + p.duration && leftPos + initDur > p.start)
          const rightFree = !lanePeers.some((p) => p !== o && rightPos < p.start + p.duration && rightPos + initDur > p.start)
          if (Math.abs(s - leftPos) <= Math.abs(s - rightPos) && leftFree) {
            s = leftPos
          } else if (rightFree) {
            s = rightPos
          } else if (leftFree) {
            s = leftPos
          }
        }
      }
      return s
    }

    let moved = false
    setDraggingClipId(clip.id)

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 3) return
      moved = true
      const deltaSec = dx / Math.max(1, pps)

      if (mode === 'move') {
        let nextStart = Math.max(0, initStart + deltaSec)
        const sStart = findSnap(nextStart)
        const sEnd = findSnap(nextStart + initDur)
        if (sStart !== null) {
          nextStart = sStart
          setSnapGuideTime(sStart)
        } else if (sEnd !== null) {
          nextStart = Math.max(0, sEnd - initDur)
          setSnapGuideTime(sEnd)
        } else {
          setSnapGuideTime(null)
        }
        nextStart = clampNonOverlapMove(nextStart)
        onUpdateClip(clip.id, { start: Number(nextStart.toFixed(3)) })
        return
      }

      if (mode === 'trim-left') {
        const minInBound = isUnbounded ? 0 : Math.max(0, initStart - initIn / spd)
        const lo = Math.max(minTrimStart, minInBound)
        const hi = initEnd - 0.1
        let nextStart = Math.max(lo, Math.min(hi, initStart + deltaSec))
        const snapped = findSnap(nextStart)
        if (snapped !== null && snapped >= lo && snapped <= hi) {
          nextStart = snapped
          setSnapGuideTime(snapped)
        } else {
          setSnapGuideTime(null)
        }
        const newDur = Math.max(0.1, Number((initEnd - nextStart).toFixed(3)))
        const headDelta = nextStart - initStart
        const newIn = isUnbounded ? 0 : Math.max(0, Number((initIn + headDelta * spd).toFixed(3)))
        const nextKfs = initKeyframes
          ? initKeyframes
              .map((k) => ({ ...k, time: Number((k.time - headDelta).toFixed(3)) }))
              .filter((k) => k.time >= -0.001 && k.time <= newDur + 0.001)
              .map((k) => ({ ...k, time: Math.max(0, Math.min(newDur, k.time)) }))
          : undefined
        const nextFadeIn = Math.min(clip.fadeIn, newDur)
        const nextFadeOut = Math.min(clip.fadeOut, Math.max(0, newDur - nextFadeIn))
        onUpdateClip(clip.id, {
          start: Number(nextStart.toFixed(3)),
          in: newIn,
          duration: newDur,
          fadeIn: nextFadeIn,
          fadeOut: nextFadeOut,
          ...(nextKfs ? { keyframes: nextKfs } : {}),
          ...(clip.credit ? { credit: { ...clip.credit, duration: newDur } } : {})
        })
        return
      }

      // trim-right
      const maxMediaEnd = isUnbounded
        ? initStart + 600
        : initStart + Math.max(0.1, (mediaDur - initIn) / spd)
      const hi = Math.min(maxTrimEnd, maxMediaEnd)
      const lo = initStart + 0.1
      let nextEnd = Math.max(lo, Math.min(hi, initEnd + deltaSec))
      const snapped = findSnap(nextEnd)
      if (snapped !== null && snapped >= lo && snapped <= hi) {
        nextEnd = snapped
        setSnapGuideTime(snapped)
      } else {
        setSnapGuideTime(null)
      }
      const newDur = Math.max(0.1, Number((nextEnd - initStart).toFixed(3)))
      const nextKfs = initKeyframes
        ? initKeyframes.filter((k) => k.time <= newDur + 0.001)
        : undefined
      const nextFadeOut = Math.min(clip.fadeOut, Math.max(0, newDur - clip.fadeIn))
      onUpdateClip(clip.id, {
        duration: newDur,
        fadeOut: nextFadeOut,
        ...(nextKfs ? { keyframes: nextKfs } : {}),
        ...(clip.credit ? { credit: { ...clip.credit, duration: newDur } } : {})
      })
    }

    const onUp = () => {
      setDraggingClipId(null)
      setSnapGuideTime(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <footer
      data-testid="timeline-panel"
      className="glass relative flex shrink-0 flex-col overflow-visible"
      style={{ height }}
    >
      {/* Seçili Sahne İşaretçisi ve Yönetmen Notu Baloncuğu (Case Marker Popover) */}
      {activeMarker && (
        <div
          data-testid="case-marker-popover"
          className="absolute bottom-full left-36 z-50 mb-2 w-[320px] rounded-lg border border-white/15 bg-[#0F0F12]/95 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.85)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rotate-45 rounded-[2px]"
                style={{
                  backgroundColor: CASE_MARKER_COLOR_META[activeMarker.color].hex,
                  boxShadow: `0 0 8px ${CASE_MARKER_COLOR_META[activeMarker.color].glow}`
                }}
              />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white/90">
                Sahne Notu · {fmt(activeMarker.time, fps)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {markers.length > 1 && onStepMarker && (
                <>
                  <button
                    type="button"
                    data-testid="popover-prev-marker"
                    onClick={() => onStepMarker(-1)}
                    title="Önceki İşaretçi"
                    className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/70 hover:bg-white/[0.14] hover:text-white"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    data-testid="popover-next-marker"
                    onClick={() => onStepMarker(1)}
                    title="Sonraki İşaretçi"
                    className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/70 hover:bg-white/[0.14] hover:text-white"
                  >
                    ▶
                  </button>
                </>
              )}
              {onDeleteMarker && (
                <button
                  type="button"
                  data-testid="popover-delete-marker"
                  onClick={() => onDeleteMarker(activeMarker.id)}
                  title="İşaretçiyi Sil"
                  className="rounded-full bg-red-500/15 px-2 py-0.5 font-mono text-[9px] text-red-300 hover:bg-red-500/30"
                >
                  Sil
                </button>
              )}
              <button
                type="button"
                data-testid="popover-close-marker"
                onClick={() => onSelectMarker?.(null)}
                className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-white/60 hover:bg-white/[0.14] hover:text-white"
              >
                ×
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[9px] font-medium text-white/50">Sahne Başlığı</div>
              <input
                data-testid="marker-title-input"
                value={activeMarker.title}
                onChange={(e) => onUpdateMarker?.(activeMarker.id, { title: e.target.value })}
                placeholder="Örn: Sahne 1 — Sorgu Odası"
                className="w-full rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs font-medium text-white outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium text-white/50">Yönetmen Notu</div>
              <textarea
                data-testid="marker-note-input"
                rows={2}
                value={activeMarker.note}
                onChange={(e) => onUpdateMarker?.(activeMarker.id, { note: e.target.value })}
                placeholder="Kamera hareketi, ışık veya ses kurgusu için not ekleyin…"
                className="w-full resize-none rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-[11px] text-white/85 outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[9px] text-white/45">Etiket Rengi</span>
              <div className="flex items-center gap-1.5">
                {(Object.keys(CASE_MARKER_COLOR_META) as CaseMarkerColor[]).map((cKey) => {
                  const meta = CASE_MARKER_COLOR_META[cKey]
                  const selected = activeMarker.color === cKey
                  return (
                    <button
                      key={cKey}
                      type="button"
                      data-testid={`marker-color-${cKey}`}
                      onClick={() => onUpdateMarker?.(activeMarker.id, { color: cKey })}
                      title={meta.label}
                      style={{ backgroundColor: meta.hex }}
                      className={`h-4 w-4 rounded-full transition ${
                        selected ? 'scale-125 ring-2 ring-white' : 'opacity-65 hover:opacity-100'
                      }`}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Üst Araç Çubuğu */}
      <div className="flex items-center gap-1.5 border-b border-[color:var(--border-subtle)] px-3 py-1.5">
        <button
          data-testid="timeline-play-btn"
          onClick={onPlay}
          disabled={!canPlay}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_rgba(183,227,106,0.25)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-95 disabled:opacity-30"
          title="Oynat / Durdur (Boşluk) · J/K/L Shuttle"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        {/* J / K / L Canlı Mekik Hız Göstergesi */}
        <div
          data-testid="shuttle-indicator"
          className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px]"
          title="J geri · K durdur · L ileri"
        >
          <span className={shuttleRate < 0 && playing ? 'text-[var(--accent)]' : 'text-white/30'}>J</span>
          <span className={!playing ? 'text-[var(--accent)]' : 'text-white/30'}>K</span>
          <span className={shuttleRate > 0 && playing ? 'text-[var(--accent)]' : 'text-white/30'}>L</span>
          <span
            className="min-w-[44px] text-center font-semibold tracking-wide text-[var(--accent)] transition-all duration-200"
            style={{
                            opacity: shuttleLabel(shuttleRate, playing) ? 1 : 0.4
            }}
          >
            {shuttleLabel(shuttleRate, playing) ?? '❚❚'}
          </span>
        </div>

        {/* Geri Al (Undo) & Yinele (Redo) */}
        {(onUndo || onRedo) && (
          <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
            <button
              type="button"
              data-testid="undo-btn"
              onClick={onUndo}
              disabled={!canUndo}
              title="Geri Al (Ctrl+Z)"
              className="rounded-full px-2 py-0.5 font-mono text-[10px] text-white/75 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
            >
              <span className="flex items-center gap-1.5">↶ Geri Al <Kbd>Ctrl+Z</Kbd></span>
            </button>
            <button
              type="button"
              data-testid="redo-btn"
              onClick={onRedo}
              disabled={!canRedo}
              title="Yinele (Ctrl+Shift+Z)"
              className="rounded-full px-2 py-0.5 font-mono text-[10px] text-white/75 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
            >
              <span className="flex items-center gap-1.5">↷ Yinele <Kbd>Ctrl+⇧+Z</Kbd></span>
            </button>
          </div>
        )}

        <button
          data-testid="cut-btn"
          onClick={onCut}
          disabled={!canPlay}
          className="chip disabled:opacity-30"
          title="Playhead konumundan böl (C)"
        >
          <span className="flex items-center gap-1.5">Kes <Kbd>C</Kbd></span>
        </button>
        <button
          data-testid="delete-btn"
          onClick={rippleMode && onRippleDelete ? onRippleDelete : onDeleteSelected}
          disabled={!selectedClip}
          className="chip disabled:opacity-30"
          title={rippleMode ? 'Ripple Sil — Sonraki klipleri geri kaydır (Del)' : 'Seçili klibi sil (Del)'}
        >
          <span className="flex items-center gap-1.5">
            {rippleMode ? 'Ripple Sil' : 'Sil'} <Kbd>Del</Kbd>
          </span>
        </button>
        {onToggleRippleMode && (
          <button
            type="button"
            data-testid="ripple-mode-btn"
            onClick={onToggleRippleMode}
            title="Ripple Modu: Silme işleminde sonraki klipleri otomatik geri kaydır (Shift+Del)"
            className={`chip ${
              rippleMode
                ? '!border-[var(--accent)] !bg-[var(--accent)]/18 !text-[var(--accent)]'
                : 'text-white/60'
            }`}
          >
            Ripple
          </button>
        )}
        {onCloseGaps && (
          <button
            type="button"
            data-testid="close-gaps-btn"
            onClick={() => onCloseGaps(selectedClip?.lane)}
            disabled={clips.length === 0}
            title="Zaman çizelgesindeki boşlukları kapat (Close Gaps)"
            className="chip disabled:opacity-30"
          >
            Boşluk Kapat
          </button>
        )}
        <button
          data-testid="timeline-detach-btn"
          onClick={onDetachSelected}
          disabled={!canDetach}
          className="chip disabled:opacity-30"
          title="Seçili videonun sesini A1 kanalına bağımsız klip olarak ayır"
        >
          Sesi Ayır
        </button>

        {/* NLE Giriş (I) ve Çıkış (O) Noktası Kontrolleri */}
        {(onMarkIn || onMarkOut) && (
          <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
            <button
              type="button"
              data-testid="mark-in-btn"
              onClick={onMarkIn}
              disabled={!canPlay}
              title="Giriş (In) Noktası İşaretle (I)"
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
                inPoint !== null
                  ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                  : 'text-white/60 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1">
                <Kbd>I</Kbd>
                {inPoint !== null ? `${inPoint.toFixed(1)}s` : 'Giriş'}
              </span>
            </button>
            <button
              type="button"
              data-testid="mark-out-btn"
              onClick={onMarkOut}
              disabled={!canPlay}
              title="Çıkış (Out) Noktası İşaretle (O)"
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
                outPoint !== null
                  ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                  : 'text-white/60 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1">
                {outPoint !== null ? `${outPoint.toFixed(1)}s` : 'Çıkış'}
                <Kbd>O</Kbd>
              </span>
            </button>
            {(inPoint !== null || outPoint !== null) && onClearInOut && (
              <button
                type="button"
                data-testid="clear-inout-btn"
                onClick={onClearInOut}
                title="In / Out İşaretlerini Temizle"
                className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/45 hover:bg-white/[0.1] hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Sahne İşaretçileri ve Yönetmen Notları (Case Markers - M) */}
        {onAddMarkerAtPlayhead && (
          <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
            {markers.length > 0 && onStepMarker && (
              <button
                type="button"
                data-testid="prev-marker-btn"
                onClick={() => onStepMarker(-1)}
                title="Önceki Sahne İşaretçisine Git (Sol Ok)"
                className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/60 transition hover:bg-white/[0.1] hover:text-white"
              >
                ◀
              </button>
            )}
            <button
              type="button"
              data-testid="add-marker-btn"
              onClick={onAddMarkerAtPlayhead}
              disabled={!canPlay}
              title="Playhead Konumuna Sahne İşaretçisi ve Yönetmen Notu Ekle (M)"
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold transition disabled:opacity-30 ${
                activeMarker
                  ? 'bg-amber-500/20 text-amber-300 '
                  : 'text-white/75 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              <span className="text-amber-400">◆</span>
              <span>İşaretçi Ekle</span>
              <Kbd>M</Kbd>
              {markers.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 text-[8px] text-amber-300">
                  {markers.length}
                </span>
              )}
            </button>
            {markers.length > 0 && onStepMarker && (
              <button
                type="button"
                data-testid="next-marker-btn"
                onClick={() => onStepMarker(1)}
                title="Sonraki Sahne İşaretçisine Git (Sağ Ok)"
                className="rounded-full px-1.5 py-0.5 font-mono text-[9px] text-white/60 transition hover:bg-white/[0.1] hover:text-white"
              >
                ▶
              </button>
            )}
          </div>
        )}

        <span
          className="ml-1 rounded border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] tracking-wider text-white/90"
          data-testid="timeline-timecode"
        >
          {fmt(time, fps)}
        </span>
        {selectedClip && (
          <span className="truncate rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/60">
            Seçili: {selectedClip.lane} · {selectedClip.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            data-testid="snap-btn"
            onClick={() => setSnap((v) => !v)}
            className={`chip ${snap ? '!border-[#71717A] !bg-[#71717A]/20 !text-white' : 'text-[#71717A]'}`}
            title="Mıknatıs / Kenar Hizalama (Snap)"
          >
            Mıknatıs
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-[#71717A]" title="Zaman Çizelgesi Yakınlaştırma">
            <span>Zoom</span>
            <input
              type="range"
              min={0.5}
              max={MAX_ZOOM}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={
                {
                  '--pct': `${Math.max(0, Math.min(100, ((zoom - 0.5) / Math.max(0.01, MAX_ZOOM - 0.5)) * 100))}%`
                } as React.CSSProperties
              }
              className="w-24 cursor-pointer"
            />
            <span className="w-8 text-right">{zoom.toFixed(1)}x</span>
          </label>
          <div className="relative">
            <button
              type="button"
              data-testid="shortcut-guide-btn"
              onClick={() => setShowGuide((v) => !v)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] transition-all duration-200 ${
                showGuide
                  ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
              title="Klavye Kısayolları"
            >
              <span className="font-bold">?</span> Kısayollar
            </button>
            {showGuide && (
              <div
                data-testid="shortcut-guide"
                className="absolute bottom-full right-0 z-50 mb-2 w-[300px] rounded-lg bg-black/60 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] "
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-widest text-[var(--accent)]">
                    NOIRCUT KISAYOLLARI
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowGuide(false)}
                    className="rounded-full px-1.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                {SHORTCUT_GUIDE.map((g) => (
                  <div key={g.group} className="mb-2 last:mb-0">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-white/35">{g.group}</div>
                    {g.items.map(([k, d]) => (
                      <div key={k} className="flex items-center justify-between py-0.5 text-[10px] text-white/75">
                        <span>{d}</span>
                        <Kbd>{k}</Kbd>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="panel-title">Timeline</span>
        </div>
      </div>

      {/* Gövde: Sol Kanal Mikseri + Sağ Zaman Çizelgesi */}
      <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Sol: Track Mixer (V1, A1, A2 Mute/Solo) */}
        <div className="flex w-[116px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.015]">
          <div className="flex h-6 items-center justify-between border-b border-white/[0.06] px-2.5 text-[9px] font-semibold tracking-wider text-white/35">
            <span>KANALLAR</span>
          </div>
          {LANES.map((lane) => {
            const st = lanes[lane]
            const audible = isLaneAudible(lanes, lane)
            const rowH = lane === 'V1' ? 'h-[60px]' : lane === 'V2' ? 'h-[36px]' : 'h-[44px]'
            const laneSub =
              lane === 'V2' ? 'Metin' : lane === 'V1' ? 'Video' : lane === 'A1' ? 'Ses 1' : 'Ses 2'
            const laneColor =
              lane === 'V1' ? 'var(--accent)' : lane === 'V2' ? '#8B5CF6' : '#06B6D4'
            return (
              <div
                key={lane}
                className={`relative flex ${rowH} items-center justify-between border-b border-white/[0.05] pl-3.5 pr-2.5`}
              >
                <span
                  className="absolute inset-y-1 left-0 w-[3px] rounded-r"
                  style={{ backgroundColor: laneColor }}
                />
                <div className="flex flex-col">
                  <span
                    className={`font-mono text-[11px] font-bold ${
                      audible ? 'text-white/85' : 'text-white/35 line-through'
                    }`}
                  >
                    {lane}
                  </span>
                  <span className="text-[9px] text-white/35">{laneSub}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid={`mute-${lane}`}
                    onClick={() => onToggleMute(lane)}
                    title={`${lane} Sessize Al (Mute)`}
                    className={`h-5 w-5 rounded text-[10px] font-bold transition ${
                      st.muted
                        ? 'bg-[#71717A] text-[#0B0B0C]'
                        : 'border border-[#71717A]/25 bg-white/5 text-[#71717A] hover:text-white'
                    }`}
                  >
                    M
                  </button>
                  <button
                    data-testid={`solo-${lane}`}
                    onClick={() => onToggleSolo(lane)}
                    title={`${lane} Sadece Bu Kanalı Dinle (Solo)`}
                    className={`h-5 w-5 rounded text-[10px] font-bold transition ${
                      st.solo
                        ? 'bg-[#D4D4D8] text-[#0B0B0C]'
                        : 'border border-[#71717A]/25 bg-white/5 text-[#71717A] hover:text-white'
                    }`}
                  >
                    S
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Sağ: Cetvel + Klipler + Playhead */}
        <div
          ref={area}
          data-testid="timeline-tracks"
          className="relative flex-1 overflow-x-auto overflow-y-hidden"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-clip-box]')) return
            onSelectClip(null)
            onScrubStart()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            seekFromClientX(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) seekFromClientX(e.clientX)
          }}
          onPointerUp={() => onScrubEnd()}
          onPointerCancel={() => onScrubEnd()}
        >
          <div
            className="relative h-full"
            style={{ width: total > 0 ? total * pps + 40 : '100%' }}
          >
            {/* 35mm Negatif Film Şeridi Zaman Cetveli (Filmstrip Time Ruler) */}
            <div
              data-testid="timeline-ruler"
              className="relative h-6 cursor-ew-resize overflow-hidden border-b border-white/[0.08] bg-[#09090b]"
              onPointerDown={(e) => {
                e.stopPropagation()
                onScrubStart()
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                seekFromClientX(e.clientX)
              }}
              onPointerMove={(e) => e.buttons === 1 && seekFromClientX(e.clientX)}
              onPointerUp={(e) => {
                e.stopPropagation()
                onScrubEnd()
              }}
              onPointerCancel={(e) => {
                e.stopPropagation()
                onScrubEnd()
              }}
            >
              {/* Alt Sinematografik Kare Alt-Çentikleri (Sub-frame Ticks) */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] opacity-65"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 1px, transparent 1px, transparent 12px)'
                }}
              />
              {ticks.map((t) => (
                <div
                  key={t}
                  className="pointer-events-none absolute bottom-0 top-[6px] flex items-center gap-1 border-l border-[var(--accent)]/45 pl-1.5 font-mono text-[9px] text-white/65"
                  style={{ left: t * pps }}
                >
                  <span>{label(t)}</span>
                  <span className="text-[7px] text-white/30">·{Math.round(t * fps)}F</span>
                </div>
              ))}

              {/* Cetvel Üzeri In / Out İşaretçileri */}
              {inPoint !== null && (
                <div
                  data-testid="ruler-in-marker"
                  style={{ left: inPoint * pps }}
                  className="pointer-events-none absolute inset-y-0 z-20 flex items-center border-l-2 border-[var(--accent)] pl-1 font-mono text-[8px] font-bold text-[var(--accent)]"
                >
                  [IN
                </div>
              )}
              {outPoint !== null && (
                <div
                  data-testid="ruler-out-marker"
                  style={{ left: outPoint * pps }}
                  className="pointer-events-none absolute inset-y-0 z-20 flex -translate-x-full items-center border-r-2 border-[var(--accent)] pr-1 font-mono text-[8px] font-bold text-[var(--accent)]"
                >
                  OUT]
                </div>
              )}

              {/* Cetvel Üzeri Sahne İşaretçileri (Case Markers) */}
              {markers.map((m) => {
                const meta = CASE_MARKER_COLOR_META[m.color] ?? CASE_MARKER_COLOR_META.amber
                const isSelected = m.id === activeMarkerId
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`case-marker-${m.id}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectMarker?.(isSelected ? null : m.id)
                      onSeek(m.time)
                    }}
                    style={{ left: m.time * pps }}
                    title={`${m.title}${m.note ? ` — ${m.note}` : ''} (${fmt(m.time, fps)})`}
                    className={`absolute top-1 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold transition-all ${
                      isSelected
                        ? 'scale-110 border-white text-white shadow-lg'
                        : 'border-white/30 text-white/95 hover:scale-105 hover:border-white'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rotate-45 rounded-[1.5px]"
                      style={{
                        backgroundColor: meta.hex,
                        boxShadow: `0 0 8px ${meta.glow}`
                      }}
                    />
                    <span className="max-w-[72px] truncate">{m.title}</span>
                  </button>
                )
              })}
            </div>

            {/* Sahne İşaretçileri Dikey Kılavuz Çizgileri */}
            {markers.map((m) => {
              const meta = CASE_MARKER_COLOR_META[m.color] ?? CASE_MARKER_COLOR_META.amber
              const isSelected = m.id === activeMarkerId
              return (
                <div
                  key={`line-${m.id}`}
                  style={{
                    left: m.time * pps,
                    borderColor: meta.hex,
                    opacity: isSelected ? 0.85 : 0.4
                  }}
                  className="pointer-events-none absolute bottom-0 top-6 z-20 border-l border-dashed"
                />
              )
            })}

            {/* In - Out Aralığı Gölgelendirme Katmanı */}
            {(inPoint !== null || outPoint !== null) && total > 0 && (
              <div
                data-testid="timeline-inout-range"
                style={{
                  left: (inPoint ?? 0) * pps,
                  width: Math.max(2, ((outPoint ?? total) - (inPoint ?? 0)) * pps)
                }}
                className="pointer-events-none absolute bottom-0 top-6 z-20 border-x border-[var(--accent)]/60 bg-[var(--accent)]/[0.06]"
              />
            )}

            {total <= 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-8 flex items-center justify-center text-[11px] text-white/30">
                Timeline boş — soldan bir video seç veya buraya sürükle
              </div>
            )}

            {/* Kanal Satırları: V2, V1, A1, A2 */}
            {LANES.map((lane) => {
              const laneClips = clips.filter((c) => c.lane === lane)
              const laneAudible = isLaneAudible(lanes, lane)
              const isVideo = lane === 'V1'
              const isCredit = lane === 'V2'
              const rowH = isVideo ? 60 : isCredit ? 36 : 44

              return (
                <div
                  key={lane}
                  data-testid={`lane-${lane}`}
                  style={{ height: rowH }}
                  onDragOver={(e) => {
                    if (!isCredit && e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
                      e.preventDefault()
                    }
                  }}
                  onDrop={(e) => {
                    if (isCredit) return
                    e.preventDefault()
                    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE)
                    if (mediaId) onDropMediaToLane(mediaId, lane)
                  }}
                  className="relative border-b border-white/[0.05]"
                >
                  {laneClips.map((c) => {
                    const m = mediaMap.get(c.mediaId)
                    const peaks = peaksMap[c.mediaId]
                    const clipW = Math.max(6, c.duration * pps - 2)
                    const isSelected = c.id === selectedClipId
                    const cell = 88
                    const showWaveform = isVideo
                      ? !c.audioDetached && Boolean(m?.hasAudio)
                      : isCredit
                        ? false
                        : Boolean(m?.hasAudio ?? true)

                    return (
                      <div
                        key={c.id}
                        data-clip-box
                        data-testid="clip"
                        data-clip-id={c.id}
                        data-lane={c.lane}
                        onPointerDown={(e) => startClipDrag(e, c, 'move')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectClip(c.id)
                        }}
                        style={{ left: c.start * pps, width: clipW }}
                        className={`group absolute bottom-[2px] top-[2px] overflow-hidden rounded-[13px] ${
                          draggingClipId === c.id
                            ? 'cursor-grabbing brightness-110 transition-none'
                            : 'cursor-grab transition-all duration-150'
                        } ${
                          isVideo || isCredit ? 'bg-[var(--clip-video)]' : 'bg-[var(--clip-audio)]'
                        } ${
                          isSelected
                            ? 'z-10 ring-2 ring-[var(--accent)]'
                            : 'ring-1 ring-[color:var(--border-subtle)] hover:ring-[var(--accent)]/60 hover:brightness-110'
                        }`}
                      >
                        {/* Sol & Sağ Kenar Kırpma (Edge Trim) Tutamaçları */}
                        <div
                          data-testid={`trim-left-${c.id}`}
                          onPointerDown={(e) => startClipDrag(e, c, 'trim-left')}
                          title="Sol kenardan kırp (Trim In)"
                          className="absolute bottom-0 left-0 top-0 z-30 w-2 cursor-ew-resize bg-[var(--accent)]/0 transition-colors hover:bg-[var(--accent)]/70"
                        />
                        <div
                          data-testid={`trim-right-${c.id}`}
                          onPointerDown={(e) => startClipDrag(e, c, 'trim-right')}
                          title="Sağ kenardan kırp (Trim Out)"
                          className="absolute bottom-0 right-0 top-0 z-30 w-2 cursor-ew-resize bg-[var(--accent)]/0 transition-colors hover:bg-[var(--accent)]/70"
                        />
                        {/* Hover Parlama Katmanı */}
                        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-white/[0.06] via-transparent to-white/[0.04] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                        {isCredit ? (
                          <div className="flex h-full items-center bg-gradient-to-r from-tungsten/15 via-transparent to-tungsten/10 px-2" />
                        ) : isVideo ? (
                          <>
                            {/* Filmstrip küçük resimleri */}
                            <div
                              className="absolute inset-x-0 top-[6px]"
                              style={{
                                bottom: showWaveform ? '20px' : '6px',
                                ...(m?.thumbnail
                                  ? {
                                      backgroundImage: `url(${m.thumbnail})`,
                                      backgroundSize: `${cell - 2}px 100%`,
                                      backgroundRepeat: 'repeat-x',
                                      maskImage: `repeating-linear-gradient(90deg, #000 0 ${cell - 2}px, transparent ${cell - 2}px ${cell}px)`,
                                      WebkitMaskImage: `repeating-linear-gradient(90deg, #000 0 ${cell - 2}px, transparent ${cell - 2}px ${cell}px)`
                                    }
                                  : {
                                      background:
                                        'linear-gradient(90deg, rgba(245,166,35,0.25), rgba(229,57,53,0.25))'
                                    })
                              }}
                            />
                            {/* Gömülü ses dalga formu (ayrılmamışsa) */}
                            {showWaveform && (
                              <div className="absolute inset-x-0 bottom-[5px] h-[16px] bg-black/75 border-t border-white/10">
                                <WaveformCanvas
                                  clip={c}
                                  peaks={peaks}
                                  width={clipW}
                                  height={16}
                                  color="#06B6D4"
                                  muted={!laneAudible}
                                />
                              </div>
                            )}
                            {/* Sprocket delikleri */}
                            <div
                              className="pointer-events-none absolute inset-x-0 top-0 h-[5px]"
                              style={{
                                background:
                                  'repeating-linear-gradient(90deg, transparent 0 5px, rgba(255,255,255,0.25) 5px 9px, transparent 9px 14px)'
                              }}
                            />
                            <div
                              className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px]"
                              style={{
                                background:
                                  'repeating-linear-gradient(90deg, transparent 0 5px, rgba(255,255,255,0.25) 5px 9px, transparent 9px 14px)'
                              }}
                            />
                          </>
                        ) : (
                          /* Ses Kanalı (A1 / A2) Tam Boy Gerçek Ses Dalgası */
                          <div className="absolute inset-0">
                            <WaveformCanvas
                              clip={c}
                              peaks={peaks}
                              width={clipW}
                              height={rowH - 4}
                              color={lane === 'A1' ? '#22D3EE' : '#06B6D4'}
                              muted={!laneAudible}
                            />
                          </div>
                        )}

                        {/* Klip Etiketi */}
                        <div className="pointer-events-none absolute left-1.5 right-1.5 top-1.5 flex items-center justify-between gap-1">
                          <span className="truncate rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-medium text-white/90">
                            {c.name}
                          </span>
                          <span className="shrink-0 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[8px] text-[var(--accent)]">
                            {c.lane === 'V2'
                              ? `${c.duration.toFixed(1)}s`
                              : c.lane === 'V1' && c.audioDetached
                                ? 'Sessiz'
                                : formatDb(c.gainDb)}
                          </span>
                        </div>

                        {/* Fade In & Fade Out Sürükleme Tutamaçları */}
                        {showWaveform && (
                          <>
                            <div
                              data-testid={`fade-in-handle-${c.id}`}
                              onPointerDown={(e) => startFadeDrag(e, c, 'in')}
                              title={`Fade In: ${c.fadeIn.toFixed(2)}s (Sürükle)`}
                              style={{
                                left: Math.min(
                                  clipW - 8,
                                  Math.max(2, (c.fadeIn / Math.max(0.01, c.duration)) * clipW)
                                )
                              }}
                              className="absolute top-0.5 z-20 h-3 w-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-black bg-white/90 shadow hover:scale-125 hover:bg-[var(--accent)]"
                            />
                            <div
                              data-testid={`fade-out-handle-${c.id}`}
                              onPointerDown={(e) => startFadeDrag(e, c, 'out')}
                              title={`Fade Out: ${c.fadeOut.toFixed(2)}s (Sürükle)`}
                              style={{
                                left: Math.max(
                                  8,
                                  Math.min(
                                    clipW - 2,
                                    clipW - (c.fadeOut / Math.max(0.01, c.duration)) * clipW
                                  )
                                )
                              }}
                              className="absolute top-0.5 z-20 h-3 w-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-black bg-white/90 shadow hover:scale-125 hover:bg-[var(--accent)]"
                            />
                          </>
                        )}

                        {/* Klip Üzeri Keyframe (Anahtar Kare) Elmas Noktaları */}
                        {(c.keyframes?.length ?? 0) > 0 && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-[6px] top-[18px] z-20 flex items-center">
                            {/* Keyframe bağlantı çizgisi */}
                            {c.keyframes!.length >= 2 && (
                              <div className="pointer-events-none absolute inset-x-2 h-[1.5px] bg-[var(--accent)]/40 " />
                            )}
                            {c.keyframes!.map((kf) => {
                              const xPx = Math.max(
                                5,
                                Math.min(
                                  clipW - 5,
                                  (kf.time / Math.max(0.01, c.duration)) * clipW
                                )
                              )
                              const isKfActive =
                                selectedKeyframeId === kf.id ||
                                Math.abs(time - (c.start + kf.time)) <= 0.045
                              return (
                                <button
                                  key={kf.id}
                                  type="button"
                                  data-testid={`clip-kf-${kf.id}`}
                                  data-kf-param={kf.param}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onSelectClip(c.id)
                                    setSelectedKeyframeId(kf.id)
                                    onSeek(c.start + kf.time)
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    const nextKfs = (c.keyframes ?? []).filter(
                                      (item) => item.id !== kf.id
                                    )
                                    onUpdateClip(c.id, { keyframes: nextKfs })
                                  }}
                                  style={{ left: xPx }}
                                  title={`Keyframe (${kf.param}: ${Math.round(kf.value)}) @ ${kf.time.toFixed(2)}s — Tıkla: Seç & Git | Sağ Tıkla: Sil`}
                                  className={`pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[1.5px] border transition-all duration-150 ${
                                    isKfActive
                                      ? 'scale-125 border-white bg-[var(--accent)] '
                                      : 'border-black/80 bg-[var(--accent)]/90  hover:scale-125 hover:border-white'
                                  }`}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* Mıknatıs Hizalama (Snap) Kılavuz Çizgisi */}
            {snapGuideTime !== null && (
              <div
                data-testid="snap-guide-line"
                className="pointer-events-none absolute inset-y-0 z-30 border-l border-dashed border-[var(--accent)]"
                style={{ left: snapGuideTime * pps }}
              />
            )}

            {/* Keskin Metalik Başlıklı ve Lazer Işık İzli Playhead İmleci */}
            {total > 0 && (
              <div
                data-testid="playhead"
                className="pointer-events-none absolute inset-y-0 z-30 w-[1.5px] bg-[var(--accent)] "
                style={{ left: time * pps }}
              >
                {/* Lazer Işık İzi (Laser Light Trail) */}
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-7"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, var(--accent-glow) 100%)',
                    opacity: playing ? 0.55 : 0.28
                  }}
                />
                {/* Keskin Metalik Playhead Başlığı */}
                <div
                  className="absolute -left-[7px] top-0 h-4 w-4 shadow-[0_2px_8px_rgba(0,0,0,0.85)] [clip-path:polygon(0_0,100%_0,100%_58%,50%_100%,0_58%)]"
                  style={{
                    background:
                      'linear-gradient(180deg, #FAFAFA 0%, #D4D4D8 45%, #71717A 100%)'
                  }}
                >
                  <div className="mx-auto mt-[2px] h-[2px] w-2 rounded-full bg-[var(--accent)]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
