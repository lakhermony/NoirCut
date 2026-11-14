import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSvgGradeTables, type ColorGrade } from '../../../shared/color'
import type { CreditConfig } from '../../../shared/credits'
import type { Lut3D } from '../../../shared/lut'
import type { MediaItem } from '../../../shared/types'
import { fmt } from '../lib/format'
import { WebGLColorEngine } from '../lib/webgl-grade'
import { getPlayableUrl } from '../hooks/usePlayer'
import CreditOverlay from './CreditOverlay'
import { MEDIA_DRAG_TYPE } from './LeftPanel'

/** Video seçilmemişken gösterilen yer tutucu kare */
function Scene() {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d7a96" />
          <stop offset="0.55" stopColor="#c9b79a" />
          <stop offset="1" stopColor="#d9a76a" />
        </linearGradient>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3d0" />
          <stop offset="1" stopColor="#fff3d0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)" />
      <circle cx="1100" cy="470" r="220" fill="url(#sun)" />
      <path d="M0 620 L260 440 L480 560 L760 380 L1060 580 L1320 450 L1600 600 V900 H0Z" fill="#5a6b73" />
      <path d="M0 720 L300 560 L620 700 L940 540 L1280 700 L1600 620 V900 H0Z" fill="#2c3a40" />
      <path d="M0 820 Q400 740 800 800 T1600 790 V900 H0Z" fill="#12181b" />
    </svg>
  )
}

export default function Monitor({
  media,
  videoProps,
  videoRef,
  error,
  playing,
  time,
  duration,
  onToggle,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onDropMedia,
  grade,
  activeLut,
  creditOverlay
}: {
  media: MediaItem | null
  videoProps: React.VideoHTMLAttributes<HTMLVideoElement>
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  error: string | null
  playing: boolean
  time: number
  duration: number
  onToggle: () => void
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onDropMedia: (id: string) => void
  grade: ColorGrade
  activeLut: Lut3D | null
  creditOverlay?: {
    credit: CreditConfig
    localTime: number
    duration: number
    isPreview?: boolean
  } | null
}) {
  const [wipe, setWipe] = useState(50)
  const [split, setSplit] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [webglReady, setWebglReady] = useState(true)
  const [webglDrawn, setWebglDrawn] = useState(false)

  const svgFilter = useMemo(() => buildSvgGradeTables(grade, activeLut), [grade, activeLut])

  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<WebGLColorEngine | null>(null)
  const latestRef = useRef({ grade, activeLut })
  latestRef.current = { grade, activeLut }

  const drag = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    setWipe(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)))
  }

  const renderFrame = useCallback(() => {
    const engine = engineRef.current
    const video = videoRef.current
    if (!engine || !video) return
    const { grade: g, activeLut: lut } = latestRef.current
    try {
      const ok = engine.render(video, g, lut, false, 0)
      if (ok) setWebglDrawn(true)
    } catch (err) {
      console.error('[NoirCut] WebGL render hatası:', err)
      setWebglReady(false)
      setWebglDrawn(false)
    }
  }, [videoRef])

  // WebGL2 motorunu başlat
  useEffect(() => {
    setWebglDrawn(false)
    if (!media) {
      engineRef.current?.dispose()
      engineRef.current = null
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const engine = new WebGLColorEngine(canvas)
      engineRef.current = engine
      setWebglReady(true)
      renderFrame()
      return () => {
        engine.dispose()
        if (engineRef.current === engine) engineRef.current = null
      }
    } catch {
      setWebglReady(false)
      return undefined
    }
  }, [media, renderFrame])

  // Renk / LUT / zaman değiştiğinde anında kareyi güncelle
  useEffect(() => {
    renderFrame()
  }, [grade, activeLut, time, renderFrame])

  // Video olaylarında (loadedmetadata, loadeddata, canplay, seeked) ve oynatma sırasında 60fps güncelle
  useEffect(() => {
    const v = videoRef.current
    if (!v || !media) return
    const onMeta = () => {
      // İlk kareyi hemen decode ettir (duraklatılmış haldeyken readyState >= 2 olması için)
      if (v.paused && v.currentTime === 0) {
        try {
          v.currentTime = 0.0001
        } catch {
          // ignore
        }
      }
      renderFrame()
    }
    const onFrame = () => renderFrame()
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', onFrame)
    v.addEventListener('canplay', onFrame)
    v.addEventListener('canplaythrough', onFrame)
    v.addEventListener('seeked', onFrame)
    v.addEventListener('timeupdate', onFrame)

    let raf = 0
    const loop = () => {
      renderFrame()
      if (playing) raf = requestAnimationFrame(loop)
    }
    if (playing) raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', onFrame)
      v.removeEventListener('canplay', onFrame)
      v.removeEventListener('canplaythrough', onFrame)
      v.removeEventListener('seeked', onFrame)
      v.removeEventListener('timeupdate', onFrame)
    }
  }, [media, playing, videoRef, renderFrame])

  const scrub = (e: React.PointerEvent) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration)
  }

  const progress = duration ? (time / duration) * 100 : 0

  return (
    <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden pt-3">
      <div className="flex items-center justify-between px-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="panel-title">Program Monitörü</span>
          {media && webglReady && (
            <span className="rounded bg-tungsten/15 px-1.5 py-0.5 font-mono text-[9px] text-tungsten">
              WebGL2
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="split-toggle-btn"
            onClick={() => setSplit((s) => !s)}
            className={`chip ${split ? '!border-tungsten/70 !text-tungsten' : ''}`}
          >
            Önce / Sonra
          </button>
          <span
            className="rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-tungsten"
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
          className={`relative aspect-video max-h-full max-w-full overflow-hidden rounded-lg bg-[var(--bg-app)] ring-1 shadow-[0_12px_36px_rgba(0,0,0,0.7)] transition ${
            dragOver ? 'ring-2 ring-[var(--accent)]' : 'ring-[color:var(--border-subtle)]'
          }`}
          style={{ height: '100%' }}
        >
          {/* Sinema Vizör Köşe İşaretleri (Viewfinder Brackets) */}
          <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 h-3 w-3 border-l border-t border-white/25" />
          <span className="pointer-events-none absolute right-2.5 top-2.5 z-20 h-3 w-3 border-r border-t border-white/25" />
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 h-3 w-3 border-b border-l border-white/25" />
          <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 h-3 w-3 border-b border-r border-white/25" />

          {/* Tally Light (Oynatma Durum Işığı) */}
          <div className="pointer-events-none absolute left-4 top-3.5 z-20 flex items-center gap-1.5 rounded bg-black/55 px-1.5 py-0.5 backdrop-blur-sm">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-all ${
                playing
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]'
                  : 'bg-white/25'
              }`}
            />
            <span className="font-mono text-[8px] font-semibold tracking-widest text-white/60">
              {playing ? 'PLAY' : 'STBY'}
            </span>
          </div>
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

          {/* ÖNCE (ham görüntü + ses kaynağı) */}
          <div className="absolute inset-0">
            {media ? (
              <video
                {...videoProps}
                ref={videoRef}
                data-testid="video-main"
                src={getPlayableUrl(media) ?? undefined}
                crossOrigin="anonymous"
                playsInline
                preload="auto"
                style={{
                  filter: !split && (!webglReady || !webglDrawn) ? 'url(#noircut-grade-filter)' : undefined
                }}
                className="h-full w-full object-contain"
              />
            ) : (
              <div
                style={{ filter: 'saturate(0.75) contrast(0.9) brightness(0.95)' }}
                className="h-full w-full"
              >
                <Scene />
              </div>
            )}
          </div>

          {/* SONRA (WebGL2 renk düzenlenmiş kare + SVG filtre yedeklemesi; split açıkken wipe sağında görünür) */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: split ? `inset(0 0 0 ${wipe}%)` : 'none' }}
          >
            {media ? (
              <>
                {webglReady && (
                  <canvas
                    ref={canvasRef}
                    data-testid="video-graded-canvas"
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
          </div>

          {!media && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
              <div className="rounded-lg border border-white/10 bg-black/60 px-4 py-2 text-center text-xs text-white/70">
                Soldan bir video seç veya buraya sürükle
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
              duration={creditOverlay.duration}
              playing={playing}
              isPreview={creditOverlay.isPreview}
            />
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

      {/* Transport: Geri Sar / Play-Pause / İleri Sar / İlerleme Çubuğu / Zaman Kodu */}
      <div className="flex items-center gap-2.5 border-t border-[color:var(--border-subtle)] bg-[var(--bg-app)]/70 px-4 py-2.5">
        <button
          onClick={() => onSeek(Math.max(0, time - 5))}
          disabled={!media}
          title="5 sn Geri Sar"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-muted)] transition hover:border-white/40 hover:text-white disabled:opacity-30"
        >
          ↺5
        </button>
        <button
          data-testid="play-btn"
          onClick={onToggle}
          disabled={!media}
          title="Oynat / Durdur (Boşluk)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white ring-1 ring-[color:var(--border-subtle)] transition hover:bg-white/20 active:scale-95 disabled:opacity-30"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          onClick={() => onSeek(Math.min(duration, time + 5))}
          disabled={!media}
          title="5 sn İleri Sar"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-muted)] transition hover:border-white/40 hover:text-white disabled:opacity-30"
        >
          5↻
        </button>
        <div
          className="relative mx-1 h-5 flex-1 cursor-pointer"
          onPointerDown={(e) => {
            onScrubStart()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            scrub(e)
          }}
          onPointerMove={(e) => e.buttons === 1 && scrub(e)}
          onPointerUp={() => onScrubEnd()}
          onPointerCancel={() => onScrubEnd()}
        >
          <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-white/15" />
          <div
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--text-muted)]"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-2 ring-[var(--bg-app)]"
            style={{ left: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 rounded border border-white/10 bg-black/75 px-2.5 py-1 font-mono text-[11px] tracking-wider text-white/90 shadow-inner">
          {fmt(time, media?.fps || 25)} <span className="text-white/30">/</span> {fmt(duration, media?.fps || 25)}
        </span>
      </div>
    </section>
  )
}
