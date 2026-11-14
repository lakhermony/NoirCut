import { useEffect, useRef, useState } from 'react'
import {
  LANES,
  formatDb,
  isLaneAudible,
  type LaneId,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem, PeaksResult } from '../../../shared/types'
import { fmt } from '../lib/format'
import { MEDIA_DRAG_TYPE } from './LeftPanel'
import WaveformCanvas from './WaveformCanvas'

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]

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
  canPlay,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onPlay,
  onCut,
  onDeleteSelected,
  onDetachSelected,
  onSelectClip,
  onUpdateClip,
  onToggleMute,
  onToggleSolo,
  onDropMediaToLane
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
  canPlay: boolean
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
  onPlay: () => void
  onCut: () => void
  onDeleteSelected: () => void
  onDetachSelected: () => void
  onSelectClip: (id: string | null) => void
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  onToggleMute: (lane: LaneId) => void
  onToggleSolo: (lane: LaneId) => void
  onDropMediaToLane: (mediaId: string, lane: LaneId) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)

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

  return (
    <footer className="glass flex h-[252px] shrink-0 flex-col overflow-hidden">
      {/* Üst Araç Çubuğu */}
      <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] px-3 py-1.5">
        <button
          data-testid="timeline-play-btn"
          onClick={onPlay}
          disabled={!canPlay}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#27272A] text-xs text-[#E4E4E7] ring-1 ring-[#71717A]/50 transition hover:bg-[#3F3F46] disabled:opacity-30"
          title="Oynat / Durdur (Boşluk)"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          data-testid="cut-btn"
          onClick={onCut}
          disabled={!canPlay}
          className="chip disabled:opacity-30"
          title="Playhead konumundan böl (C)"
        >
          ✂ Kes (C)
        </button>
        <button
          data-testid="delete-btn"
          onClick={onDeleteSelected}
          disabled={!selectedClip}
          className="chip disabled:opacity-30"
          title="Seçili klibi sil (Delete / Backspace)"
        >
          🗑 Sil (Del)
        </button>
        <button
          data-testid="timeline-detach-btn"
          onClick={onDetachSelected}
          disabled={!canDetach}
          className="chip disabled:opacity-30"
          title="Seçili videonun sesini A1 kanalına bağımsız klip olarak ayır"
        >
          🔊 Sesi Ayır
        </button>
        <span
          className="ml-2 rounded border border-white/10 bg-black/75 px-2 py-0.5 font-mono text-[11px] tracking-wider text-white/90 shadow-inner"
          data-testid="timeline-timecode"
        >
          {fmt(time, fps)}
        </span>
        {selectedClip && (
          <span className="ml-2 rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/60">
            Seçili: {selectedClip.lane} · {selectedClip.name} ({formatDb(selectedClip.gainDb)})
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
            🧲 Mıknatıs
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-[#71717A]" title="Zaman Çizelgesi Yakınlaştırma">
            <span>🔍</span>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1 w-24 cursor-pointer accent-[#71717A]"
            />
            <span className="w-8 text-right">{zoom.toFixed(1)}x</span>
          </label>
          <span className="panel-title">Timeline</span>
        </div>
      </div>

      {/* Gövde: Sol Kanal Mikseri + Sağ Zaman Çizelgesi */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sol: Track Mixer (V1, A1, A2 Mute/Solo) */}
        <div className="flex w-[116px] shrink-0 flex-col border-r border-white/[0.06] bg-black/30">
          <div className="flex h-5 items-center px-2.5 text-[9px] font-semibold tracking-wider text-white/30 border-b border-white/[0.06]">
            KANALLAR
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
            {/* Cetvel (sürükleyerek sarma) */}
            <div
              data-testid="timeline-ruler"
              className="relative h-5 cursor-ew-resize border-b border-white/[0.06] bg-black/20"
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
              {ticks.map((t) => (
                <div
                  key={t}
                  className="pointer-events-none absolute top-0 h-full border-l border-white/15 pl-1 font-mono text-[9px] text-white/35"
                  style={{ left: t * pps }}
                >
                  {label(t)}
                </div>
              ))}
            </div>

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
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectClip(c.id)
                        }}
                        style={{ left: c.start * pps, width: clipW }}
                        className={`group absolute bottom-[2px] top-[2px] cursor-pointer overflow-hidden rounded-md transition-shadow ${
                          isVideo || isCredit ? 'bg-[var(--clip-video)]' : 'bg-[var(--clip-audio)]'
                        } ${
                          isSelected
                            ? 'ring-2 ring-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)] z-10'
                            : 'ring-1 ring-[color:var(--border-subtle)] hover:ring-white/40'
                        }`}
                      >
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
                          <span className="truncate rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white/90">
                            {c.name}
                          </span>
                          <span className="shrink-0 rounded bg-black/65 px-1 py-0.5 font-mono text-[8px] text-tungsten">
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
                              className="absolute top-0.5 z-20 h-3 w-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-black bg-white/90 shadow hover:scale-125 hover:bg-tungsten"
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
                              className="absolute top-0.5 z-20 h-3 w-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-black bg-white/90 shadow hover:scale-125 hover:bg-tungsten"
                            />
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* Playhead */}
            {total > 0 && (
              <div
                data-testid="playhead"
                className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[var(--accent)] shadow-[0_0_10px_var(--accent-glow)]"
                style={{ left: time * pps }}
              >
                <div className="absolute -left-[6px] top-0 h-3 w-3 bg-[var(--accent)] [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]" />
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
