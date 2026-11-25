import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSvgGradeTables, isNeutralGrade, type ColorGrade } from '../../../shared/color'
import type { CreditConfig } from '../../../shared/credits'
import type { Lut3D } from '../../../shared/lut'
import {
  type SubtitleSegment,
  type SubtitleStyleConfig,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'
import { fmt } from '../lib/format'
import { WebGLColorEngine, type PlaybackQuality } from '../lib/webgl-grade'
import { getPlayableUrl, type OverlayVisualLayer, type VideoSlot } from '../hooks/usePlayer'
import type { ProxyPlaybackMode, ProxyResolutionScale } from '../types'
import CreditOverlay from './CreditOverlay'
import { MEDIA_DRAG_TYPE } from './LeftPanel'
import type { ComparisonMode } from './noirfilm/LookComparisonViewer'
import {
  computeClipTransformStyle,
  MonitorEmptyScene as Scene
} from './monitor/MonitorHelpers'
import { MonitorSubtitleOverlay } from './monitor/MonitorSubtitleOverlay'
import { MonitorTransportBar } from './monitor/MonitorTransportBar'

export default function Monitor({
  media,
  activeClip,
  overlayLayers = [],
  registerOverlayVideoEl,
  registerVideoBufferEl,
  videoProps,
  videoRef,
  error,
  playing,
  shuttleRate = 0,
  time,
  timeRef,
  subscribeTime,
  duration,
  onToggle,
  onShuttleReverse,
  onShuttlePause,
  onShuttleForward,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onDropMedia,
  grade,
  activeLut,
  creditOverlay,
  wbPickerActive = false,
  onPickWbRgb,
  onCancelWbPicker,
  onGrabStill,
  onCopyGrade,
  onPasteGrade,
  hasCopiedGrade = false,
  compareMode = 'none',
  externalWipe,
  forceWebGL = false,
  proxyPlaybackMode = 'auto',
  onProxyPlaybackModeChange,
  proxyScale = '1/2',
  onProxyScaleChange,
  onBatchProxyGenerate,
  subtitles = [],
  subtitleStyle,
  sourceMedia = null,
  onInsertFromSource,
  onShowToast
}: {
  media: MediaItem | null
  activeClip?: TimelineClip | null
  overlayLayers?: OverlayVisualLayer[]
  registerOverlayVideoEl?: (clipId: string, el: HTMLVideoElement | null) => void
  registerVideoBufferEl?: (slot: VideoSlot, el: HTMLVideoElement | null) => void
  videoProps: React.VideoHTMLAttributes<HTMLVideoElement>
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  error: string | null
  playing: boolean
  shuttleRate?: number
  time: number
  timeRef?: React.MutableRefObject<number>
  subscribeTime?: (cb: (t: number) => void) => () => void
  duration: number
  onToggle: () => void
  onShuttleReverse?: () => void
  onShuttlePause?: () => void
  onShuttleForward?: () => void
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onDropMedia: (id: string) => void
  grade: ColorGrade
  activeLut: Lut3D | null
  creditOverlay?: {
    credit: CreditConfig
    localTime: number
    clipStart?: number
    duration: number
    isPreview?: boolean
  } | null
  wbPickerActive?: boolean
  onPickWbRgb?: (r01: number, g01: number, b01: number) => void
  onCancelWbPicker?: () => void
  onGrabStill?: () => void
  onCopyGrade?: () => void
  onPasteGrade?: () => void
  hasCopiedGrade?: boolean
  compareMode?: ComparisonMode
  externalWipe?: number
  forceWebGL?: boolean
  proxyPlaybackMode?: ProxyPlaybackMode
  onProxyPlaybackModeChange?: (mode: ProxyPlaybackMode) => void
  proxyScale?: ProxyResolutionScale
  onProxyScaleChange?: (scale: ProxyResolutionScale) => void
  onBatchProxyGenerate?: () => void
  subtitles?: SubtitleSegment[]
  subtitleStyle?: SubtitleStyleConfig
  sourceMedia?: MediaItem | null
  onInsertFromSource?: (m: MediaItem, inTime: number, outTime: number) => void
  onShowToast?: (msg: string) => void
}) {
  const [wipe, setWipe] = useState(50)
  const [split, setSplit] = useState(false)
  const [dualMonitor, setDualMonitor] = useState(false)
  const [srcIn, setSrcIn] = useState(0)
  const [srcOut, setSrcOut] = useState(0)
  const [srcTime, setSrcTime] = useState(0)
  const srcVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (sourceMedia) {
      setSrcIn(0)
      setSrcOut(Math.max(0.5, sourceMedia.duration || 5))
      setSrcTime(0)
    }
  }, [sourceMedia?.id])

  const handleSnapshot = async () => {
    const vid = videoRef.current
    if (!vid || vid.videoWidth === 0 || vid.videoHeight === 0) {
      onShowToast?.('Anlık görüntü alınacak aktif video karesi bulunamadı')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = vid.videoWidth
    canvas.height = vid.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    const defaultName = `noircut-snapshot-${Math.round(time * 100)}.png`
    if (window.noircut?.saveSnapshot) {
      const res = await window.noircut.saveSnapshot(dataUrl, defaultName)
      if (res.ok) {
        onShowToast?.(`Kare kaydedildi: ${res.path?.split(/[\\/]/).pop() ?? defaultName}`)
      }
    } else {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = defaultName
      a.click()
      onShowToast?.(`Kare indirildi: ${defaultName}`)
    }
  }
  const effCompareMode: ComparisonMode =
    compareMode !== 'none' ? compareMode : split ? 'v-wipe' : 'none'
  const effWipe = externalWipe ?? wipe
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [falseColor, setFalseColor] = useState(false)
  const [safeFrame, setSafeFrame] = useState<'off' | '2.39:1' | '16:9' | '9:16'>('off')
  const [playbackQuality, setPlaybackQuality] = useState<PlaybackQuality>(() => {
    try {
      const saved = window.localStorage.getItem('noircut-playback-quality')
      if (saved === '0.5') return 0.5
      if (saved === '0.25') return 0.25
    } catch {
      // yoksay
    }
    return 1
  })
  const handleSelectQuality = useCallback((q: PlaybackQuality) => {
    setPlaybackQuality(q)
    try {
      window.localStorage.setItem('noircut-playback-quality', String(q))
    } catch {
      // yoksay
    }
  }, [])
  const [dragOver, setDragOver] = useState(false)
  const [webglReady, setWebglReady] = useState(true)
  const [webglDrawn, setWebglDrawn] = useState(false)
  const [hoverSample, setHoverSample] = useState<{
    x: number
    y: number
    r: number
    g: number
    b: number
  } | null>(null)

  const svgFilter = useMemo(() => buildSvgGradeTables(grade, activeLut), [grade, activeLut])

  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const slotARef = useRef<HTMLVideoElement | null>(null)
  const slotBRef = useRef<HTMLVideoElement | null>(null)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<WebGLColorEngine | null>(null)
  const topTimecodeRef = useRef<HTMLSpanElement | null>(null)
  const bottomTimecodeCurrentRef = useRef<HTMLSpanElement | null>(null)
  const progressFillRef = useRef<HTMLDivElement | null>(null)
  const progressThumbRef = useRef<HTMLDivElement | null>(null)
  const beforeWrapRef = useRef<HTMLDivElement | null>(null)
  const afterWrapRef = useRef<HTMLDivElement | null>(null)
  const overlayWrapRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const isImageMedia = media?.mediaKind === 'image'
  const isAudioMedia = media?.mediaKind === 'audio'
  const isVisualMedia = Boolean(media && !isAudioMedia)
  const hasActiveGradeOrFx = useMemo(
    () =>
      !isNeutralGrade(grade) ||
      Boolean(activeLut) ||
      falseColor ||
      split ||
      effCompareMode !== 'none',
    [grade, activeLut, falseColor, split, effCompareMode]
  )
  // EDIT sekmesinde aktif bir renk/LUT ayarı yokken doğrudan donanım hızlandırmalı HTML5 video katmanını kullan (sıfır WebGL2 doku kopyası)
  const useWebGLPipeline = isVisualMedia && (forceWebGL || hasActiveGradeOrFx)
  const latestRef = useRef({
    grade,
    activeLut,
    time,
    falseColor,
    effCompareMode,
    effWipe,
    playing,
    playbackQuality,
    activeClip,
    overlayLayers,
    fps: media?.fps || 25,
    duration,
    useWebGLPipeline
  })
  latestRef.current = {
    grade,
    activeLut,
    time,
    falseColor,
    effCompareMode,
    effWipe,
    playing,
    playbackQuality,
    activeClip,
    overlayLayers,
    fps: media?.fps || 25,
    duration,
    useWebGLPipeline
  }

  // Klip Transform + Keyframe Interpolasyonu + Geçiş (Transition) hesaplaması
  const clipTransformStyle = useMemo<React.CSSProperties>(
    () => computeClipTransformStyle(activeClip, time),
    [activeClip, time]
  )

  // Oynatma sırasında React re-render tetiklemeden Timecode, İlerleme Çubuğu ve Keyframe/Transition stillerini doğrudan DOM ref üzerinden güncelle
  useEffect(() => {
    if (!subscribeTime) return
    return subscribeTime((t) => {
      const { fps: curFps, duration: curDur, activeClip: curClip, overlayLayers: curOverlays } =
        latestRef.current
      const tc = fmt(t, curFps)
      if (topTimecodeRef.current && topTimecodeRef.current.textContent !== tc) {
        topTimecodeRef.current.textContent = tc
      }
      if (bottomTimecodeCurrentRef.current && bottomTimecodeCurrentRef.current.textContent !== tc) {
        bottomTimecodeCurrentRef.current.textContent = tc
      }
      const pct = curDur > 0 ? Math.max(0, Math.min(100, (t / curDur) * 100)) : 0
      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${pct}%`
      }
      if (progressThumbRef.current) {
        progressThumbRef.current.style.left = `${pct}%`
      }
      if (curClip) {
        const st = computeClipTransformStyle(curClip, t)
        if (beforeWrapRef.current) {
          beforeWrapRef.current.style.transform = String(st.transform ?? '')
          beforeWrapRef.current.style.opacity = String(st.opacity ?? 1)
        }
        if (afterWrapRef.current) {
          afterWrapRef.current.style.transform = String(st.transform ?? '')
          afterWrapRef.current.style.opacity = String(st.opacity ?? 1)
        }
      }
      for (const layer of curOverlays) {
        const el = overlayWrapRefs.current.get(layer.clip.id)
        if (el) {
          const ost = computeClipTransformStyle(layer.clip, t)
          el.style.transform = String(ost.transform ?? '')
          el.style.opacity = String(ost.opacity ?? 1)
        }
      }
    })
  }, [subscribeTime])

  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen])

  useEffect(() => {
    if (!wbPickerActive) {
      setHoverSample(null)
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelWbPicker?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [wbPickerActive, onCancelWbPicker])

  /**
   * Monitör kutusu üzerindeki (clientX, clientY) noktasından ham video karesinin
   * (veya yer tutucu sahnenin) 5x5 komşuluk ortalaması RGB (0..255) değerini örnekler.
   */
  const sampleRgbAtClientPoint = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const boxEl = box.current
      if (!boxEl) return null
      const rect = boxEl.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null

      const video = videoRef.current
      if (media && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const vw = video.videoWidth
        const vh = video.videoHeight
        const boxAspect = rect.width / rect.height
        const vidAspect = vw / vh

        let renderW = rect.width
        let renderH = rect.height
        let offsetX = 0
        let offsetY = 0

        if (vidAspect > boxAspect) {
          renderW = rect.width
          renderH = rect.width / vidAspect
          offsetY = (rect.height - renderH) * 0.5
        } else {
          renderH = rect.height
          renderW = rect.height * vidAspect
          offsetX = (rect.width - renderW) * 0.5
        }

        const localX = clientX - rect.left - offsetX
        const localY = clientY - rect.top - offsetY
        const u = Math.max(0, Math.min(1, localX / Math.max(1, renderW)))
        const v = Math.max(0, Math.min(1, localY / Math.max(1, renderH)))

        if (!sampleCanvasRef.current) {
          sampleCanvasRef.current = document.createElement('canvas')
        }
        const sc = sampleCanvasRef.current
        const sw = 160
        const sh = Math.max(90, Math.round((vh / vw) * sw))
        if (sc.width !== sw || sc.height !== sh) {
          sc.width = sw
          sc.height = sh
        }
        const ctx = sc.getContext('2d', { willReadFrequently: true })
        if (!ctx) return null
        try {
          ctx.drawImage(video, 0, 0, sw, sh)
          const px = Math.max(2, Math.min(sw - 3, Math.round(u * (sw - 1))))
          const py = Math.max(2, Math.min(sh - 3, Math.round(v * (sh - 1))))
          const data = ctx.getImageData(px - 2, py - 2, 5, 5).data
          let sr = 0
          let sg = 0
          let sb = 0
          const count = 25
          for (let i = 0; i < data.length; i += 4) {
            sr += data[i]
            sg += data[i + 1]
            sb += data[i + 2]
          }
          return [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)]
        } catch {
          return null
        }
      }

      // Video yüklü değilse yer tutucu sahne gradyanından örnekle
      const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      if (ny <= 0.55) {
        const t = ny / 0.55
        return [
          Math.round(93 + (201 - 93) * t),
          Math.round(122 + (183 - 122) * t),
          Math.round(150 + (154 - 150) * t)
        ]
      }
      const t = (ny - 0.55) / 0.45
      return [
        Math.round(201 + (217 - 201) * t),
        Math.round(183 + (167 - 183) * t),
        Math.round(154 + (106 - 154) * t)
      ]
    },
    [media, videoRef]
  )

  const drag = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    setWipe(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)))
  }

  const renderFrame = useCallback(
    (forceUpload = false) => {
      if (!latestRef.current.useWebGLPipeline) return
      const engine = engineRef.current
      const srcEl = isImageMedia ? imgRef.current : videoRef.current
      if (!engine || !srcEl || isAudioMedia) return
      const {
        grade: g,
        activeLut: lut,
        falseColor: fc,
        effCompareMode: cmp,
        effWipe: wp,
        playing: isPl,
        playbackQuality: pq
      } = latestRef.current
      try {
        const ok = engine.render(srcEl, g, lut, false, wp, fc, cmp, isPl, pq, forceUpload)
        if (ok) setWebglDrawn(true)
      } catch (err) {
        console.error('[NoirCut] WebGL render hatası:', err)
        setWebglReady(false)
        setWebglDrawn(false)
      }
    },
    [isAudioMedia, isImageMedia, videoRef]
  )

  // WebGL2 motorunu başlat (klip geçişlerinde motoru ve çizilmiş kareyi sıfırlama; siyah flaşı önler)
  useEffect(() => {
    if (!isVisualMedia) {
      setWebglDrawn(false)
      engineRef.current?.dispose()
      engineRef.current = null
      return
    }
    if (!useWebGLPipeline) return
    const canvas = canvasRef.current
    if (!canvas) return
    if (engineRef.current) {
      renderFrame(true)
      return
    }
    try {
      const engine = new WebGLColorEngine(canvas)
      engineRef.current = engine
      setWebglReady(true)
      renderFrame(true)
      return () => {
        engine.dispose()
        if (engineRef.current === engine) engineRef.current = null
      }
    } catch {
      setWebglReady(false)
      return undefined
    }
  }, [isVisualMedia, useWebGLPipeline, renderFrame])

  // Renk / LUT / zaman / medya / karşılaştırma / playback kalitesi değiştiğinde anında kareyi güncelle
  useEffect(() => {
    if (!useWebGLPipeline) return
    renderFrame()
  }, [
    useWebGLPipeline,
    media,
    grade,
    activeLut,
    time,
    falseColor,
    effCompareMode,
    effWipe,
    playbackQuality,
    renderFrame
  ])

  // Her iki video tamponunda (Slot A + Slot B) olayları ve senkronize requestVideoFrameCallback döngüsünü dinle
  useEffect(() => {
    if (!isVisualMedia) return
    const videos = [slotARef.current, slotBRef.current].filter(
      (el): el is HTMLVideoElement => el !== null
    )
    if (videos.length === 0 && videoRef.current) {
      videos.push(videoRef.current)
    }

    let supportsVfc = false
    const cleanups: Array<() => void> = []
    for (const v of videos) {
      const onMeta = () => {
        // Yalnızca aktif (preload olmayan) tampon 0. saniyedeyse ilk kareyi decode ettir
        if (!v.dataset.preloadClipId && v.paused && v.currentTime === 0) {
          try {
            v.currentTime = 0.0001
          } catch {
            // ignore
          }
        }
        if (latestRef.current.useWebGLPipeline) renderFrame(true)
      }
      const onForceFrame = () => {
        if (latestRef.current.useWebGLPipeline) renderFrame(true)
      }
      const onFrame = () => {
        if (latestRef.current.useWebGLPipeline) renderFrame()
      }
      v.addEventListener('loadedmetadata', onMeta)
      if (useWebGLPipeline) {
        v.addEventListener('loadeddata', onForceFrame)
        v.addEventListener('canplay', onFrame)
        v.addEventListener('canplaythrough', onFrame)
        v.addEventListener('seeked', onForceFrame)
        v.addEventListener('pause', onForceFrame)
        if (!playing) {
          v.addEventListener('timeupdate', onFrame)
        }
      }

      let vfcId = 0
      const rVfc = (
        v as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number
          cancelVideoFrameCallback?: (id: number) => void
        }
      ).requestVideoFrameCallback
      const cVfc = (
        v as HTMLVideoElement & {
          cancelVideoFrameCallback?: (id: number) => void
        }
      ).cancelVideoFrameCallback

      if (useWebGLPipeline && typeof rVfc === 'function') {
        supportsVfc = true
        const onVideoFrame = () => {
          if (videoRef.current === v) renderFrame(true)
          vfcId = rVfc.call(v, onVideoFrame)
        }
        vfcId = rVfc.call(v, onVideoFrame)
      }

      cleanups.push(() => {
        if (vfcId && typeof cVfc === 'function') cVfc.call(v, vfcId)
        v.removeEventListener('loadedmetadata', onMeta)
        v.removeEventListener('loadeddata', onForceFrame)
        v.removeEventListener('canplay', onFrame)
        v.removeEventListener('canplaythrough', onFrame)
        v.removeEventListener('seeked', onForceFrame)
        v.removeEventListener('pause', onForceFrame)
        v.removeEventListener('timeupdate', onFrame)
      })
    }

    // requestVideoFrameCallback desteklenmeyen ortamlarda veya görsel medya/grain animasyonunda yedek RAF döngüsü
    let raf = 0
    if (useWebGLPipeline && playing && (!supportsVfc || isImageMedia)) {
      const loop = () => {
        renderFrame()
        if (playing) raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      for (const fn of cleanups) fn()
    }
  }, [isVisualMedia, isImageMedia, useWebGLPipeline, media, playing, videoRef, renderFrame])

  const scrub = (e: React.PointerEvent) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration)
  }

  const progress = duration ? (time / duration) * 100 : 0

  return (
    <section
      data-testid="program-monitor"
      data-fullscreen={isFullscreen ? '1' : '0'}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#09090b] pt-3'
          : 'glass flex min-w-0 flex-1 flex-col overflow-hidden pt-3'
      }
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          <span className="panel-title">Program Monitörü</span>
          <button
            type="button"
            data-testid="toggle-fullscreen-btn"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Tam Ekrandan Çık (ESC)' : 'Tam Ekran Önizleme'}
            className="rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-0.5 font-mono text-[9.5px] font-medium text-[var(--text-muted)] transition duration-150 hover:border-white/25 hover:bg-[var(--bg-elevated,#292E36)] hover:text-white active:scale-[0.97]"
          >
            {isFullscreen ? 'Çık (ESC)' : '⛶ Tam Ekran'}
          </button>
          {media && (media.proxyState === 'building' || media.proxyState === 'ready') && (
            <span
              data-testid="monitor-proxy-badge"
              title={
                media.proxyState === 'building'
                  ? `Smart Proxy üretiliyor (%${Math.round((media.proxyProgress ?? 0) * 100)}) — 720p All-Intra (Export her zaman orijinal yüksek çözünürlüklü dosyayı kullanır)`
                  : 'Smart Proxy Aktif (720p All-Intra 60 FPS önizleme · Export orijinal dosyayı kullanır)'
              }
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-wider ${
                media.proxyState === 'building'
                  ? 'border-amber-400/50 bg-amber-400/12 text-amber-300'
                  : 'border-[var(--accent)]/45 bg-[var(--accent)]/12 text-[var(--accent)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  media.proxyState === 'building' ? 'animate-pulse bg-amber-400' : 'bg-[var(--accent)]'
                }`}
              />
              {media.proxyState === 'building'
                ? `PROXY %${Math.round((media.proxyProgress ?? 0) * 100)}`
                : 'PROXY'}
            </span>
          )}
          {onProxyPlaybackModeChange && (
            <div
              data-testid="proxy-mode-selector"
              className="flex items-center gap-0.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-0.5"
              title="Proxy Oynatma Modu (Otomatik / Proxy / Orijinal Kaynak)"
            >
              {(
                [
                  ['auto', 'OTO'],
                  ['proxy', 'PROXY'],
                  ['original', 'ORİJİNAL']
                ] as Array<[ProxyPlaybackMode, string]>
              ).map(([mId, mLbl]) => (
                <button
                  key={mId}
                  type="button"
                  data-testid={`proxy-mode-${mId}`}
                  onClick={() => onProxyPlaybackModeChange(mId)}
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold transition ${
                    proxyPlaybackMode === mId
                      ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                      : 'text-[var(--text-muted)] hover:text-white'
                  }`}
                >
                  {mLbl}
                </button>
              ))}
              {onProxyScaleChange && (
                <select
                  data-testid="proxy-scale-select"
                  value={proxyScale}
                  onChange={(e) => onProxyScaleChange(e.target.value as ProxyResolutionScale)}
                  title="Proxy Üretim Çözünürlük Ölçeği (1/2 · 1/4 · 1/8)"
                  style={{ colorScheme: 'dark' }}
                  className="ml-0.5 cursor-pointer appearance-none rounded-full border border-white/10 bg-[#181b21] px-2 py-0.5 text-center font-mono text-[8.5px] font-semibold text-white/90 outline-none transition hover:border-[var(--accent)]/60"
                >
                  <option value="1/2" className="bg-[#181b21] text-white">1/2</option>
                  <option value="1/4" className="bg-[#181b21] text-white">1/4</option>
                  <option value="1/8" className="bg-[#181b21] text-white">1/8</option>
                </select>
              )}
              {onBatchProxyGenerate && (
                <button
                  type="button"
                  data-testid="batch-proxy-btn"
                  onClick={onBatchProxyGenerate}
                  title="Projedeki Tüm Videolar İçin Toplu Proxy Üret (Batch Proxy)"
                  className="rounded-full px-1.5 py-0.5 font-mono text-[8.5px] text-[var(--accent)] hover:bg-white/10"
                >
                  ⚡
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Playback Kalitesi (Tam / 1/2 / 1/4) Seçici */}
          <div
            data-testid="playback-quality-selector"
            className="flex items-center gap-0.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-0.5"
            title="Önizleme Playback Kalitesi (1/2 veya 1/4 ağır 4K/10-bit dosyalarda 60 FPS akıcılık sağlar; Export her zaman tam çözünürlükte çalışır)"
          >
            {(
              [
                [1, 'Tam'],
                [0.5, '1/2'],
                [0.25, '1/4']
              ] as Array<[PlaybackQuality, string]>
            ).map(([q, label]) => (
              <button
                key={q}
                type="button"
                data-testid={`playback-quality-${q}`}
                onClick={() => handleSelectQuality(q)}
                className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition duration-150 ${
                  playbackQuality === q
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'text-[var(--text-muted)] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Açılıp kapanabilir Safe Frame (2.39:1 / 16:9 / 9:16) seçici */}
          <div
            data-testid="safe-frame-selector"
            className="flex items-center gap-0.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-0.5"
            title="Safe Frame (Kadraj Kılavuz Çizgileri)"
          >
            {(
              [
                ['off', 'SAFE: KAPALI'],
                ['2.39:1', '2.39:1'],
                ['16:9', '16:9'],
                ['9:16', '9:16']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`safe-frame-${id}`}
                onClick={() => setSafeFrame(id)}
                className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold transition duration-150 ${
                  safeFrame === id
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'text-[var(--text-muted)] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            data-testid="false-color-btn"
            type="button"
            onClick={() => setFalseColor((v) => !v)}
            title="False Color — Pozlama Kontrol Haritası (Mor: gömülü gölge · Yeşil/Pembe: orta ton & ten · Kırmızı: patlamış beyaz)"
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[9px] font-semibold transition duration-150 active:scale-[0.97] ${
              falseColor
                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-white/75 hover:border-white/25 hover:text-white'
            }`}
          >
            <span
              className="h-1.5 w-4 rounded-full"
              style={{
                background:
                  'linear-gradient(90deg,#7c3aed,#2563eb,#22c55e,#f472b6,#facc15,#ef4444)'
              }}
            />
            False Color
          </button>
          <button
            data-testid="split-toggle-btn"
            onClick={() => setSplit((s) => !s)}
            className={`chip !py-0.5 !text-[9px] font-mono ${
              split ? '!border-[var(--accent)] !bg-[var(--accent)]/15 !text-[var(--accent)]' : ''
            }`}
          >
            Önce / Sonra
          </button>
          <button
            data-testid="dual-monitor-btn"
            type="button"
            onClick={() => setDualMonitor((d) => !d)}
            title="İkili Monitör (Source + Program Monitor · 3-Point Editing I/O)"
            className={`chip !py-0.5 !text-[9px] font-mono ${
              dualMonitor ? '!border-[var(--accent)] !bg-[var(--accent)]/15 !text-[var(--accent)]' : ''
            }`}
          >
            İkili Monitör
          </button>
          <button
            data-testid="snapshot-btn"
            type="button"
            onClick={() => void handleSnapshot()}
            title="Aktif Video Karesini PNG Olarak Kaydet (Snapshot)"
            className="chip !py-0.5 !text-[9px] font-mono"
          >
            Snapshot
          </button>
          <span
            ref={topTimecodeRef}
            className="rounded-full border border-[var(--accent)]/40 bg-[var(--bg-surface)] px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]"
            data-testid="timecode"
          >
            {fmt(time, media?.fps || 25)}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-2">
        <div
          ref={box}
          data-testid="monitor-box"
          title={wbPickerActive ? undefined : 'Çift tıkla: Tam ekran önizleme (ESC ile çık)'}
          onDoubleClick={(e) => {
            if (wbPickerActive) return
            e.stopPropagation()
            setIsFullscreen((v) => !v)
          }}
          onPointerMove={(e) => {
            if (!wbPickerActive) return
            const boxEl = box.current
            if (!boxEl) return
            const rect = boxEl.getBoundingClientRect()
            const rgb = sampleRgbAtClientPoint(e.clientX, e.clientY)
            if (rgb) {
              setHoverSample({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                r: rgb[0],
                g: rgb[1],
                b: rgb[2]
              })
            }
          }}
          onPointerLeave={() => {
            if (wbPickerActive) setHoverSample(null)
          }}
          onClick={(e) => {
            if (!wbPickerActive || !onPickWbRgb) return
            e.stopPropagation()
            const rgb = sampleRgbAtClientPoint(e.clientX, e.clientY)
            if (rgb) {
              onPickWbRgb(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
              e.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE)
            if (id) onDropMedia(id)
          }}
          className={`relative aspect-video max-h-full max-w-full overflow-hidden rounded-2xl bg-[var(--bg-app)] ring-1 shadow-[0_14px_40px_rgba(0,0,0,0.55)] transition ${
            wbPickerActive
              ? 'cursor-crosshair ring-2 ring-[var(--accent)] '
              : dragOver
                ? 'ring-2 ring-[var(--accent)]'
                : 'ring-[color:var(--border-subtle)]'
          }`}
          style={{ height: '100%' }}
        >
          {/* Sinema Vizör Köşe İşaretleri (Viewfinder Brackets) */}
          <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 h-3.5 w-3.5 border-l-2 border-t-2 border-[var(--accent)]/55" />
          <span className="pointer-events-none absolute right-2.5 top-2.5 z-20 h-3.5 w-3.5 border-r-2 border-t-2 border-[var(--accent)]/55" />
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 h-3.5 w-3.5 border-b-2 border-l-2 border-[var(--accent)]/55" />
          <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 h-3.5 w-3.5 border-b-2 border-r-2 border-[var(--accent)]/55" />

          {/* Tally Light (Oynatma Sırasında Parlayan REC / LIVE Noktası + J/K/L Shuttle Hızı) */}
          <div className="pointer-events-none absolute left-4 top-3.5 z-20 flex items-center gap-1.5 rounded border border-white/10 bg-black/65 px-2 py-0.5 ">
            <span
              className={`h-2 w-2 rounded-full transition-all ${
                playing
                  ? shuttleRate < 0
                    ? 'animate-pulse bg-amber-400 '
                    : 'animate-pulse bg-red-500 '
                  : 'bg-white/30'
              }`}
            />
            <span
              className={`font-mono text-[8px] font-bold tracking-widest ${
                playing
                  ? shuttleRate < 0
                    ? 'text-amber-300'
                    : 'text-red-400'
                  : 'text-white/60'
              }`}
            >
              {playing
                ? shuttleRate < 0
                  ? `REV ${Math.abs(shuttleRate)}X`
                  : shuttleRate > 1
                    ? `FWD ${shuttleRate}X`
                    : 'REC • LIVE'
                : 'STBY'}
            </span>
          </div>

          {/* Sağ Üst Vizör Donanım Rozeti */}
          {!split && (
            <div className="pointer-events-none absolute right-4 top-3.5 z-20 flex items-center gap-1.5 rounded border border-white/10 bg-black/65 px-2 py-0.5 font-mono text-[8px] font-semibold tracking-widest text-white/75 ">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] " />
              <span>
                {useWebGLPipeline ? 'NOIRCUT ENGINE • WEBGL2' : 'NOIRCUT ENGINE • DIRECT GPU'}
              </span>
            </div>
          )}

          {/* Safe Frame (2.39:1 / 16:9 / 9:16) Kadraj Kılavuz Çizgileri */}
          {safeFrame !== 'off' && (
            <div
              data-testid="safe-frame-overlay"
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            >
              {safeFrame === '2.39:1' && (
                <>
                  <div className="absolute inset-x-0 top-0 h-[12.8%] bg-black/65 border-b border-dashed border-amber-400/65" />
                  <div className="absolute inset-x-0 bottom-0 h-[12.8%] bg-black/65 border-t border-dashed border-amber-400/65" />
                  <span className="absolute bottom-[13.8%] right-3 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[8px] text-amber-300/90">
                    2.39:1 ANAMORPHIC SCOPE
                  </span>
                </>
              )}
              {safeFrame === '16:9' && (
                <>
                  <div className="h-[90%] w-[90%] border border-dashed border-white/30" />
                  <div className="absolute h-[80%] w-[80%] border border-white/20" />
                  <span className="absolute bottom-[6%] right-[6%] rounded bg-black/75 px-1.5 py-0.5 font-mono text-[8px] text-white/70">
                    16:9 ACTION / TITLE SAFE
                  </span>
                </>
              )}
              {safeFrame === '9:16' && (
                <>
                  <div className="absolute inset-y-0 left-0 w-[34.2%] bg-black/65 border-r border-dashed border-cyan-400/65" />
                  <div className="absolute inset-y-0 right-0 w-[34.2%] bg-black/65 border-l border-dashed border-cyan-400/65" />
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[8px] text-cyan-300/90">
                    9:16 VERTICAL SAFE
                  </span>
                </>
              )}
              {/* Merkez Vizör Artı İşareti (Center Crosshair) */}
              <div className="relative h-4 w-4">
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/35" />
                <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/35" />
              </div>
            </div>
          )}
          {/* SVG Renk Motoru Filtresi (Sahne önizlemesi ve WebGL2 yedek katmanı için tam Lift/Gamma/Gain/LUT) */}
          <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true">
            <defs>
              <filter id="noircut-grade-filter" colorInterpolationFilters="sRGB">
                <feComponentTransfer result="graded">
                  <feFuncR type="table" tableValues={svgFilter.tableR} />
                  <feFuncG type="table" tableValues={svgFilter.tableG} />
                  <feFuncB type="table" tableValues={svgFilter.tableB} />
                </feComponentTransfer>
                {svgFilter.lutMatrix ? (
                  <>
                    <feColorMatrix
                      in="graded"
                      type="matrix"
                      values={svgFilter.lutMatrix}
                      result="lutted"
                    />
                    <feColorMatrix
                      in="lutted"
                      type="saturate"
                      values={svgFilter.saturation.toFixed(3)}
                    />
                  </>
                ) : (
                  <feColorMatrix
                    in="graded"
                    type="saturate"
                    values={svgFilter.saturation.toFixed(3)}
                  />
                )}
              </filter>
            </defs>
          </svg>

          {/* ÖNCE (ham görüntü + çift tamponlu kesintisiz video kaynağı: Slot A & Slot B) */}
          <div ref={beforeWrapRef} className="absolute inset-0" style={clipTransformStyle}>
            {isImageMedia && media && (
              <img
                ref={imgRef}
                data-testid="image-main"
                src={media.url}
                crossOrigin="anonymous"
                onLoad={() => renderFrame(true)}
                alt={media.name}
                style={{
                  filter:
                    useWebGLPipeline && !split && (!webglReady || !webglDrawn)
                      ? 'url(#noircut-grade-filter)'
                      : undefined
                }}
                className="h-full w-full object-contain"
              />
            )}
            {isVisualMedia && media ? (
              <>
                <video
                  {...videoProps}
                  ref={(el) => {
                    slotARef.current = el
                    if (registerVideoBufferEl) {
                      registerVideoBufferEl('A', el)
                    } else {
                      videoRef.current = el
                    }
                  }}
                  data-testid="video-main"
                  data-video-slot="A"
                  src={!registerVideoBufferEl ? (getPlayableUrl(media) ?? undefined) : undefined}
                  crossOrigin="anonymous"
                  playsInline
                  preload="auto"
                  style={{
                    filter:
                      useWebGLPipeline && !split && (!webglReady || !webglDrawn)
                        ? 'url(#noircut-grade-filter)'
                        : undefined
                  }}
                  className={
                    isImageMedia
                      ? 'hidden'
                      : 'absolute inset-0 h-full w-full object-contain'
                  }
                />
                <video
                  {...videoProps}
                  ref={(el) => {
                    slotBRef.current = el
                    registerVideoBufferEl?.('B', el)
                  }}
                  data-testid="video-preload-buffer"
                  data-video-slot="B"
                  crossOrigin="anonymous"
                  playsInline
                  preload="auto"
                  style={{
                    opacity: 0,
                    filter:
                      useWebGLPipeline && !split && (!webglReady || !webglDrawn)
                        ? 'url(#noircut-grade-filter)'
                        : undefined
                  }}
                  className={
                    isImageMedia
                      ? 'hidden'
                      : 'pointer-events-none absolute inset-0 h-full w-full object-contain'
                  }
                />
              </>
            ) : (
              <div
                style={{ filter: 'saturate(0.75) contrast(0.9) brightness(0.95)' }}
                className="h-full w-full"
              >
                <Scene />
              </div>
            )}
          </div>

          {/* SONRA (WebGL2 renk düzenlenmiş kare + SVG filtre yedeklemesi; EDIT modunda ve nötr grade'de doğrudan HTML5 video katmanı görünür) */}
          <div
            ref={afterWrapRef}
            className="pointer-events-none absolute inset-0"
            style={{
              ...clipTransformStyle,
              clipPath: split ? `inset(0 0 0 ${wipe}%)` : 'none',
              display: isVisualMedia && !useWebGLPipeline ? 'none' : undefined
            }}
          >
            {isVisualMedia ? (
              <>
                {webglReady && (
                  <canvas
                    ref={canvasRef}
                    data-testid="video-graded-canvas"
                    data-false-color={falseColor ? '1' : '0'}
                    className={`h-full w-full object-contain ${webglDrawn ? 'opacity-100' : 'opacity-0'}`}
                  />
                )}
                {(!webglReady || !webglDrawn) && (
                  <div
                    className="absolute inset-0 h-full w-full"
                    style={{
                      backdropFilter: 'url(#noircut-grade-filter)',
                      WebkitBackdropFilter: 'url(#noircut-grade-filter)'
                    }}
                  />
                )}
              </>
            ) : (
              <div className="h-full w-full" style={{ filter: 'url(#noircut-grade-filter)' }}>
                <Scene />
              </div>
            )}

            {/* Yedek / Sahne görünümü için Vignette katmanı */}
            {(!isVisualMedia || !webglReady || !webglDrawn) && (grade.vignette ?? 0) > 0 && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,${Math.min(0.92, ((grade.vignette ?? 0) / 100) * 0.88).toFixed(3)}) 100%)`
                }}
              />
            )}
          </div>

          {/* Üst Video Kanalları (V2, V3...) Eşzamanlı Bindirme / PiP Katmanları */}
          {overlayLayers.map((layer) => {
            const ovUrl = getPlayableUrl(layer.media)
            if (!ovUrl) return null
            const ovStyle = computeClipTransformStyle(layer.clip, time)
            const isOvImage = layer.media.mediaKind === 'image'
            return (
              <div
                key={layer.clip.id}
                ref={(el) => {
                  if (el) overlayWrapRefs.current.set(layer.clip.id, el)
                  else overlayWrapRefs.current.delete(layer.clip.id)
                }}
                data-testid={`overlay-layer-${layer.clip.lane}`}
                className="pointer-events-none absolute inset-0 z-10"
                style={ovStyle}
              >
                {isOvImage ? (
                  <img
                    src={ovUrl}
                    alt={layer.clip.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <video
                    ref={(el) => registerOverlayVideoEl?.(layer.clip.id, el)}
                    src={ovUrl}
                    crossOrigin="anonymous"
                    playsInline
                    preload="auto"
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
            )
          })}

          {!media && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
              <div className="rounded-lg border border-white/10 bg-black/60 px-4 py-2 text-center text-xs text-white/70">
                Soldan bir video, ses veya görsel seç ya da timeline&apos;a sürükle
              </div>
            </div>
          )}

          {isAudioMedia && media && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
              <div className="rounded-xl border border-white/15 bg-black/75 px-4 py-2.5 text-center font-mono text-xs text-[var(--accent)]">
                SES DOSYASI · {media.name}
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-x-6 bottom-4 rounded-md border border-crimson/50 bg-black/80 px-3 py-2 text-xs text-crimson">
              {error}
            </div>
          )}

          {creditOverlay && (
            <CreditOverlay
              credit={creditOverlay.credit}
              localTime={creditOverlay.localTime}
              clipStart={creditOverlay.clipStart}
              subscribeTime={subscribeTime}
              duration={creditOverlay.duration}
              playing={playing}
              isPreview={creditOverlay.isPreview}
            />
          )}

          {/* Power Window / Blur / Mosaic / Vignette Canlı Maske Katmanı */}
          {activeClip?.mask?.enabled && (() => {
            const m = activeClip.mask
            if (m.mode === 'vignette') {
              const alpha = Math.min(0.88, (m.strength / 100) * 0.85)
              return (
                <div
                  data-testid="monitor-mask-overlay"
                  className="pointer-events-none absolute inset-0 z-20"
                  style={{
                    background: `radial-gradient(circle, transparent 36%, rgba(0,0,0,${alpha.toFixed(2)}) 100%)`
                  }}
                />
              )
            }
            const blurPx =
              m.mode === 'mosaic'
                ? Math.max(3, Math.round((m.strength / 100) * 14))
                : Math.max(2, Math.round((m.strength / 100) * 24))
            return (
              <div
                data-testid="monitor-mask-overlay"
                className="pointer-events-none absolute z-20 border border-dashed border-white/35"
                style={{
                  left: `${m.x - m.w / 2}%`,
                  top: `${m.y - m.h / 2}%`,
                  width: `${m.w}%`,
                  height: `${m.h}%`,
                  borderRadius: m.shape === 'ellipse' ? '50%' : '6px',
                  backdropFilter:
                    m.mode === 'mosaic' ? `blur(${blurPx}px) contrast(1.25)` : `blur(${blurPx}px)`,
                  backgroundImage:
                    m.mode === 'mosaic'
                      ? 'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 4px, transparent 4px 8px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 4px, transparent 4px 8px)'
                      : undefined
                }}
              />
            )
          })()}

          {/* İkili Monitör: Sol Source Monitor (3-Point Editing I / O) */}
          {dualMonitor && (
            <div
              data-testid="source-monitor-panel"
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-3 left-3 top-11 z-30 flex w-[42%] flex-col overflow-hidden rounded-xl border border-white/15 bg-black/90 p-2 shadow-2xl backdrop-blur"
            >
              <div className="mb-1 flex items-center justify-between text-[9px] font-mono text-white/75">
                <span className="truncate font-semibold text-[var(--accent)]">
                  SOURCE · {sourceMedia?.name ?? 'Medya Seçilmedi'}
                </span>
                <span>
                  I: {srcIn.toFixed(1)}s · O: {srcOut.toFixed(1)}s
                </span>
              </div>
              <div className="relative flex-1 overflow-hidden rounded-lg bg-black">
                {sourceMedia?.mediaKind === 'video' ? (
                  <video
                    ref={srcVideoRef}
                    src={sourceMedia.url}
                    controls
                    onTimeUpdate={(e) => setSrcTime(e.currentTarget.currentTime)}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-white/45">
                    Kütüphaneden bir video klibi seçin
                  </div>
                )}
              </div>
              {sourceMedia && (
                <div className="mt-1.5 flex items-center justify-between gap-1 font-mono text-[9px]">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSrcIn(Math.min(srcTime, Math.max(0, srcOut - 0.2)))}
                      className="rounded border border-white/20 bg-white/10 px-2 py-0.5 text-white hover:border-[var(--accent)]"
                    >
                      In (I)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSrcOut(Math.max(srcTime, srcIn + 0.2))}
                      className="rounded border border-white/20 bg-white/10 px-2 py-0.5 text-white hover:border-[var(--accent)]"
                    >
                      Out (O)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInsertFromSource?.(sourceMedia, srcIn, srcOut)}
                    className="rounded bg-[var(--accent)] px-2 py-0.5 font-semibold text-[var(--accent-fg)] hover:brightness-110"
                  >
                    Timeline&apos;a İndir
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Zaman Damgalı Altyazı (Subtitle) Canlı Önizleme Katmanı (Karaoke / Hormozi destekli) */}
          <MonitorSubtitleOverlay
            subtitles={subtitles}
            subtitleStyle={subtitleStyle}
            currentTime={timeRef ? timeRef.current : time}
          />

          {wbPickerActive && (
            <>
              <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--accent)]/60 bg-black/85 px-3 py-1 font-mono text-[10px] text-white shadow-lg ">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
                <span>Damlalık Aktif: Nötr beyaz/gri bir noktaya tıklayın (İptal: Esc)</span>
              </div>
              {hoverSample && (
                <div
                  className="pointer-events-none absolute z-30 flex -translate-x-1/2 -translate-y-[125%] items-center gap-2 rounded-md border border-white/25 bg-black/90 px-2 py-1 font-mono text-[9px] text-white shadow-xl"
                  style={{ left: hoverSample.x, top: hoverSample.y }}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-white/60 shadow-inner"
                    style={{
                      backgroundColor: `rgb(${hoverSample.r}, ${hoverSample.g}, ${hoverSample.b})`
                    }}
                  />
                  <span>
                    RGB({hoverSample.r}, {hoverSample.g}, {hoverSample.b})
                  </span>
                </div>
              )}
            </>
          )}

          {split && (
            <>
              <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-white/70">
                ÖNCE
              </span>
              <span className="pointer-events-none absolute right-3 top-3 rounded bg-[#27272A] px-2 py-0.5 text-[10px] font-semibold tracking-widest text-white ring-1 ring-[#71717A]/50">
                SONRA
              </span>
              <div
                data-testid="wipe-handle"
                className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${wipe}%` }}
                onPointerDown={(e) => {
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  drag(e)
                }}
                onPointerMove={(e) => e.buttons === 1 && drag(e)}
              >
                <div className="mx-auto h-full w-[2px] bg-[var(--text-muted)]" />
                <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/90 text-[10px] text-[var(--text-muted)]">
                  ⇆
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transport: J/K/L NLE Shuttle / Play-Pause / İlerleme Çubuğu / Zaman Kodu */}
      <MonitorTransportBar
        media={media}
        playing={playing}
        shuttleRate={shuttleRate}
        time={time}
        timeRef={timeRef}
        duration={duration}
        progress={progress}
        progressFillRef={progressFillRef}
        progressThumbRef={progressThumbRef}
        bottomTimecodeCurrentRef={bottomTimecodeCurrentRef}
        hasCopiedGrade={hasCopiedGrade}
        onToggle={onToggle}
        onSeek={onSeek}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        onScrubPointer={scrub}
        onShuttleReverse={onShuttleReverse}
        onShuttlePause={onShuttlePause}
        onShuttleForward={onShuttleForward}
        onGrabStill={onGrabStill}
        onCopyGrade={onCopyGrade}
        onPasteGrade={onPasteGrade}
      />
    </section>
  )
}
