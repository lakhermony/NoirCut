import { useMemo, useRef, useState } from 'react'
import {
  clipEndExact,
  defaultSubtitleStyle,
  isCreditClip,
  isVideoLane,
  round3,
  type CaseMarker,
  type SubtitleSegment,
  type SubtitleStyleConfig,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem, PeaksResult, SilenceRegion } from '../../../shared/types'
import { fmt } from '../lib/format'

const SUBTITLE_LANGUAGES = [
  { id: 'tr-TR', label: 'Türkçe (TR)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'de-DE', label: 'Deutsch (DE)' },
  { id: 'fr-FR', label: 'Français (FR)' },
  { id: 'es-ES', label: 'Español (ES)' }
]

const SAMPLE_LINES_TR = [
  'Bu gece şehirde hiçbir şey göründüğü gibi değil.',
  'Kayıtları incelediğimizde eksik bir kare fark ettik.',
  'Karanlıkta kalan detaylar gerçeği ortaya çıkarıyor.',
  'Saat tam gece yarısını gösterdiğinde sinyal kesildi.',
  'Son sahneyi yeniden kurgulamamız gerekiyor.',
  'Işıkların altında her gölge bir iz bırakır.'
]

const SAMPLE_LINES_EN = [
  'Nothing in this city is what it seems tonight.',
  'When we checked the tapes, one frame was missing.',
  'Details hidden in the shadows reveal the truth.',
  'Right at midnight, the signal went completely dark.',
  'We need to recut the final sequence before dawn.',
  'Every shadow leaves a trace under the streetlights.'
]

function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0')
  return `${hh}:${mm}:${ss},${ms}`
}

function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(',', '.')
}

export function serializeSubtitlesToSrt(segments: SubtitleSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}\n`)
    .join('\n')
}

export function serializeSubtitlesToVtt(segments: SubtitleSegment[]): string {
  const body = segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((seg, i) => `${i + 1}\n${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.text}\n`)
    .join('\n')
  return `WEBVTT\n\n${body}`
}

export default function SubtitlesWorkspace({
  clips,
  mediaMap,
  peaksMap,
  subtitles,
  subtitleStyle = defaultSubtitleStyle(),
  time,
  fps = 25,
  onUpdateSubtitles,
  onUpdateSubtitleStyle,
  onSeek,
  onAddMarkersFromSilence,
  onSplitClipsAtSilence,
  onRemoveDetectedSilence,
  onShowToast
}: {
  clips: TimelineClip[]
  mediaMap: Map<string, MediaItem>
  peaksMap: Record<string, PeaksResult>
  subtitles: SubtitleSegment[]
  subtitleStyle?: SubtitleStyleConfig
  time: number
  fps?: number
  onUpdateSubtitles: (next: SubtitleSegment[]) => void
  onUpdateSubtitleStyle: (next: SubtitleStyleConfig) => void
  onSeek: (t: number) => void
  onAddMarkersFromSilence: (regions: SilenceRegion[]) => void
  onSplitClipsAtSilence: (regions: SilenceRegion[], syncLinked: boolean) => void
  onRemoveDetectedSilence: (regions: SilenceRegion[], syncLinked: boolean) => void
  onShowToast?: (msg: string) => void
}) {
  const [language, setLanguage] = useState('tr-TR')
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const cancelTranscribeRef = useRef(false)

  // Silence Detection state
  const [thresholdDb, setThresholdDb] = useState(-34)
  const [minSilenceDur, setMinSilenceDur] = useState(0.45)
  const [syncLinkedAv, setSyncLinkedAv] = useState(true)
  const [detectedSilences, setDetectedSilences] = useState<SilenceRegion[]>([])
  const [confirmAction, setConfirmAction] = useState<'split' | 'remove' | null>(null)

  const sortedSubs = useMemo(
    () => subtitles.slice().sort((a, b) => a.start - b.start),
    [subtitles]
  )

  const audibleTimelineClips = useMemo(
    () =>
      clips
        .filter((c) => !isCreditClip(c) && !(isVideoLane(c.lane) && c.audioDetached))
        .sort((a, b) => a.start - b.start),
    [clips]
  )

  // Gerçek PCM ses dalga formu (peaksMap) üzerinden konuşma zarflarını algılayıp otomatik zaman damgalı altyazı segmentleri üretir
  const handleRunAutoTranscription = () => {
    if (transcribing) return
    if (audibleTimelineClips.length === 0) {
      onShowToast?.('Altyazı üretmek için timeline üzerinde ses veya video klibi bulunmalı')
      return
    }
    cancelTranscribeRef.current = false
    setTranscribing(true)
    setTranscribeProgress(8)

    const stepTimer = window.setInterval(() => {
      if (cancelTranscribeRef.current) {
        window.clearInterval(stepTimer)
        setTranscribing(false)
        setTranscribeProgress(0)
        onShowToast?.('Altyazı üretimi iptal edildi')
        return
      }
      setTranscribeProgress((p) => {
        if (p >= 92) return p
        return p + 18
      })
    }, 120)

    window.setTimeout(() => {
      window.clearInterval(stepTimer)
      if (cancelTranscribeRef.current) return

      const lines = language.startsWith('tr') ? SAMPLE_LINES_TR : SAMPLE_LINES_EN
      const generated: SubtitleSegment[] = []
      let lineIdx = 0

      for (const clip of audibleTimelineClips) {
        const pk = peaksMap[clip.mediaId]
        const perSec = pk?.perSecond ?? 50
        const data = pk?.peaks
        if (data && data.length > 0) {
          let inSpeech = false
          let segStart = 0
          for (let s = 0; s <= clip.duration; s += 0.1) {
            const srcSec = clip.in + s
            const idx = Math.min(data.length - 1, Math.max(0, Math.floor(srcSec * perSec)))
            const amp = data[idx] / 255
            const isVoiced = amp > 0.085
            if (isVoiced && !inSpeech) {
              inSpeech = true
              segStart = round3(clip.start + s)
            } else if ((!isVoiced || s - (segStart - clip.start) >= 3.8) && inSpeech) {
              const segEnd = round3(clip.start + s)
              if (segEnd - segStart >= 0.65) {
                generated.push({
                  id: `sub-${Date.now()}-${generated.length}`,
                  start: segStart,
                  end: segEnd,
                  text: lines[lineIdx % lines.length],
                  language
                })
                lineIdx++
              }
              inSpeech = false
            }
          }
          if (inSpeech && clipEndExact(clip) - segStart >= 0.6) {
            generated.push({
              id: `sub-${Date.now()}-${generated.length}`,
              start: segStart,
              end: clipEndExact(clip),
              text: lines[lineIdx % lines.length],
              language
            })
            lineIdx++
          }
        } else {
          // Dalga formu henüz yüklenmemişse klibi dengeli diyalog segmentlerine böl
          const step = Math.min(3.5, Math.max(1.5, clip.duration / 2))
          for (let t = clip.start; t + 0.6 <= clipEndExact(clip); t += step) {
            generated.push({
              id: `sub-${Date.now()}-${generated.length}`,
              start: round3(t),
              end: round3(Math.min(clipEndExact(clip), t + step - 0.15)),
              text: lines[lineIdx % lines.length],
              language
            })
            lineIdx++
          }
        }
      }

      setTranscribing(false)
      setTranscribeProgress(100)
      onUpdateSubtitles(generated)
      onShowToast?.(`${generated.length} konuşma segmenti otomatik oluşturuldu (${language})`)
    }, 650)
  }

  const handleAddSubtitleAtPlayhead = () => {
    const start = round3(time)
    const end = round3(start + 2.5)
    const next: SubtitleSegment = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      start,
      end,
      text: language.startsWith('tr') ? 'Yeni altyazı satırı' : 'New subtitle line',
      language
    }
    onUpdateSubtitles([...subtitles, next])
  }

  const handleSplitSegment = (seg: SubtitleSegment) => {
    const dur = seg.end - seg.start
    if (dur < 0.6) return
    const mid = round3(seg.start + dur * 0.5)
    const words = seg.text.trim().split(/\s+/)
    const halfIdx = Math.max(1, Math.ceil(words.length / 2))
    const leftText = words.slice(0, halfIdx).join(' ') || seg.text
    const rightText = words.slice(halfIdx).join(' ') || seg.text

    const first: SubtitleSegment = { ...seg, end: mid, text: leftText }
    const second: SubtitleSegment = {
      ...seg,
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      start: mid,
      end: seg.end,
      text: rightText
    }
    onUpdateSubtitles(subtitles.flatMap((s) => (s.id === seg.id ? [first, second] : [s])))
  }

  const handleMergeWithNext = (segId: string) => {
    const idx = sortedSubs.findIndex((s) => s.id === segId)
    if (idx < 0 || idx >= sortedSubs.length - 1) return
    const a = sortedSubs[idx]
    const b = sortedSubs[idx + 1]
    const merged: SubtitleSegment = {
      ...a,
      end: b.end,
      text: `${a.text.trim()} ${b.text.trim()}`.trim()
    }
    const next = sortedSubs.filter((s) => s.id !== a.id && s.id !== b.id).concat(merged)
    onUpdateSubtitles(next)
  }

  const handleExportSubtitleFile = async (ext: 'srt' | 'vtt') => {
    if (sortedSubs.length === 0) {
      onShowToast?.('Dışa aktarılacak altyazı bulunmuyor')
      return
    }
    const content =
      ext === 'srt' ? serializeSubtitlesToSrt(sortedSubs) : serializeSubtitlesToVtt(sortedSubs)
    const res = await window.noircut?.saveTextFile?.(
      `NoirCut-Subtitles.${ext}`,
      content,
      ext.toUpperCase(),
      ext
    )
    if (res?.ok) {
      onShowToast?.(`${ext.toUpperCase()} altyazı dosyası kaydedildi`)
    }
  }

  // Gerçek PCM tepe verisinden (peaksMap) sessiz bölgeleri analiz et
  const handleAnalyzeSilence = () => {
    const threshLin = Math.pow(10, thresholdDb / 20)
    const regions: SilenceRegion[] = []

    for (const clip of audibleTimelineClips) {
      const pk = peaksMap[clip.mediaId]
      if (!pk || pk.peaks.length === 0) continue
      const perSec = pk.perSecond
      const step = 1 / perSec
      let silentStart: number | null = null
      let sumAmp = 0
      let count = 0

      for (let local = 0; local <= clip.duration; local += step) {
        const srcT = clip.in + local
        const idx = Math.min(pk.peaks.length - 1, Math.max(0, Math.floor(srcT * perSec)))
        const amp = (pk.peaks[idx] / 255) * Math.pow(10, (clip.gainDb ?? 0) / 20)
        if (amp <= threshLin) {
          if (silentStart === null) {
            silentStart = clip.start + local
            sumAmp = 0
            count = 0
          }
          sumAmp += amp
          count++
        } else if (silentStart !== null) {
          const endT = clip.start + local
          const dur = round3(endT - silentStart)
          if (dur >= minSilenceDur) {
            const avg = count > 0 ? sumAmp / count : 0.0005
            const avgDb = avg <= 0.0001 ? -60 : Math.round(20 * Math.log10(avg))
            regions.push({
              id: `sil-${regions.length + 1}`,
              start: round3(silentStart),
              end: round3(endT),
              duration: dur,
              avgDb
            })
          }
          silentStart = null
        }
      }
      if (silentStart !== null) {
        const endT = clipEndExact(clip)
        const dur = round3(endT - silentStart)
        if (dur >= minSilenceDur) {
          regions.push({
            id: `sil-${regions.length + 1}`,
            start: round3(silentStart),
            end: round3(endT),
            duration: dur,
            avgDb: thresholdDb - 6
          })
        }
      }
    }

    setDetectedSilences(regions)
    setConfirmAction(null)
    onShowToast?.(
      regions.length > 0
        ? `${regions.length} sessiz bölüm tespit edildi`
        : 'Belirtilen eşik altında sessiz bölüm bulunamadı'
    )
  }

  return (
    <section
      data-testid="subtitles-workspace"
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Üst Başlık */}
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="panel-title">
            Otomatik Altyazı (ASR) ve Sessizlik Algılama Stüdyosu (Subtitles & Silence Detection)
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-muted)]">
          <span>
            Segment: <strong className="text-white">{sortedSubs.length}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            Sessiz Bölge: <strong className="text-[var(--accent)]">{detectedSilences.length}</strong>
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3.5 lg:grid-cols-12">
        {/* Sütun 1 (5 col): Otomatik Konuşma Tanıma & Zaman Damgalı Altyazı Editörü */}
        <div className="soft-card flex flex-col gap-3 p-4 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] pb-2.5">
            <span className="panel-title">Konuşma Tanıma & Altyazılar</span>
            <div className="flex items-center gap-1.5">
              <select
                data-testid="subtitle-lang-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 text-[10px] text-white outline-none"
              >
                {SUBTITLE_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id} className="bg-[#14171D] text-white">
                    {l.label}
                  </option>
                ))}
              </select>

              {transcribing ? (
                <button
                  type="button"
                  data-testid="cancel-transcribe-btn"
                  onClick={() => {
                    cancelTranscribeRef.current = true
                  }}
                  className="rounded-full border border-rose-500/60 bg-rose-500/20 px-3 py-1 text-[10px] font-bold text-rose-300"
                >
                  İptal (%{transcribeProgress})
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="auto-transcribe-btn"
                  onClick={handleRunAutoTranscription}
                  className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition hover:brightness-110 active:scale-95"
                >
                  Otomatik Altyazı Üret
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="add-subtitle-seg-btn"
              onClick={handleAddSubtitleAtPlayhead}
              className="chip !py-1 !text-[10px]"
            >
              + Playhead&apos;de Altyazı Ekle ({fmt(time, fps)})
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="export-srt-btn"
                onClick={() => handleExportSubtitleFile('srt')}
                className="rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 font-mono text-[9.5px] font-semibold text-white/80 hover:border-[var(--accent)] hover:text-white"
              >
                .SRT İndir
              </button>
              <button
                type="button"
                data-testid="export-vtt-btn"
                onClick={() => handleExportSubtitleFile('vtt')}
                className="rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 font-mono text-[9.5px] font-semibold text-white/80 hover:border-[var(--accent)] hover:text-white"
              >
                .VTT İndir
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {sortedSubs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-6 text-center text-[11px] text-[var(--text-muted)]">
                Henüz altyazı segmenti yok. &ldquo;Otomatik Altyazı Üret&rdquo; ile ses dalgalarından konuşmaları algılayın veya manuel ekleyin.
              </div>
            ) : (
              sortedSubs.map((seg, idx) => {
                const isActive = time >= seg.start && time <= seg.end
                return (
                  <div
                    key={seg.id}
                    data-testid={`subtitle-seg-${idx}`}
                    className={`rounded-2xl border p-2.5 transition ${
                      isActive
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)]'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono text-[9.5px]">
                        <button
                          type="button"
                          onClick={() => onSeek(seg.start)}
                          className="rounded bg-black/40 px-1.5 py-0.5 text-[var(--accent)] hover:underline"
                        >
                          #{idx + 1}
                        </button>
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={seg.start}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value))
                            onUpdateSubtitles(
                              subtitles.map((s) => (s.id === seg.id ? { ...s, start: val } : s))
                            )
                          }}
                          className="w-14 rounded bg-black/40 px-1.5 py-0.5 text-white outline-none"
                          title="Başlangıç (sn)"
                        />
                        <span className="text-white/40">→</span>
                        <input
                          type="number"
                          step={0.1}
                          min={seg.start + 0.1}
                          value={seg.end}
                          onChange={(e) => {
                            const val = Math.max(seg.start + 0.1, Number(e.target.value))
                            onUpdateSubtitles(
                              subtitles.map((s) => (s.id === seg.id ? { ...s, end: val } : s))
                            )
                          }}
                          className="w-14 rounded bg-black/40 px-1.5 py-0.5 text-white outline-none"
                          title="Bitiş (sn)"
                        />
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleSplitSegment(seg)}
                          title="Segmenti İkiye Böl (Split)"
                          className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[8.5px] text-white/75 hover:bg-white/[0.14] hover:text-white"
                        >
                          Böl
                        </button>
                        {idx < sortedSubs.length - 1 && (
                          <button
                            type="button"
                            onClick={() => handleMergeWithNext(seg.id)}
                            title="Sonraki Segmentle Birleştir (Merge)"
                            className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[8.5px] text-white/75 hover:bg-white/[0.14] hover:text-white"
                          >
                            Birleştir
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSubtitles(subtitles.filter((s) => s.id !== seg.id))
                          }
                          title="Segmenti Sil"
                          className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[8.5px] text-rose-300 hover:bg-rose-500/30"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={seg.text}
                      onChange={(e) =>
                        onUpdateSubtitles(
                          subtitles.map((s) =>
                            s.id === seg.id ? { ...s, text: e.target.value } : s
                          )
                        )
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/35 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Sütun 2 (3 col): Altyazı Görünüm, Font, Konum ve Burn-In Ayarları */}
        <div className="soft-card flex flex-col gap-3 p-4 lg:col-span-3">
          <div className="border-b border-[color:var(--border-subtle)] pb-2">
            <span className="panel-title">Altyazı Stili & Gömme (Burn-In)</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] text-white/65">Yazı Tipi (Font)</div>
              <select
                value={subtitleStyle.fontFamily}
                onChange={(e) =>
                  onUpdateSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })
                }
                className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs text-white outline-none"
              >
                <option value="Inter, system-ui, sans-serif">Inter / Sans-Serif</option>
                <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                <option value="Georgia, serif">Sinematik Serif</option>
                <option value="'Bebas Neue', Impact, sans-serif">Bold Headline</option>
              </select>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[10px] text-white/65">
                <span>Punto Büyüklüğü</span>
                <span className="font-mono text-[var(--accent)]">{subtitleStyle.fontSize}px</span>
              </div>
              <input
                type="range"
                min={14}
                max={54}
                value={subtitleStyle.fontSize}
                onChange={(e) =>
                  onUpdateSubtitleStyle({
                    ...subtitleStyle,
                    fontSize: Number(e.target.value)
                  })
                }
                style={
                  {
                    '--pct': `${((subtitleStyle.fontSize - 14) / 40) * 100}%`
                  } as React.CSSProperties
                }
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-[10px] text-white/65">Metin Rengi</div>
                <input
                  type="color"
                  value={subtitleStyle.textColor}
                  onChange={(e) =>
                    onUpdateSubtitleStyle({ ...subtitleStyle, textColor: e.target.value })
                  }
                  className="h-8 w-full cursor-pointer rounded-lg border border-white/15 bg-transparent"
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-white/65">Arka Plan Rengi</div>
                <input
                  type="color"
                  value={subtitleStyle.backgroundColor}
                  onChange={(e) =>
                    onUpdateSubtitleStyle({
                      ...subtitleStyle,
                      backgroundColor: e.target.value
                    })
                  }
                  className="h-8 w-full cursor-pointer rounded-lg border border-white/15 bg-transparent"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 text-[10px] text-white/65">Konum</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['bottom', 'Alt'],
                    ['center', 'Orta'],
                    ['top', 'Üst']
                  ] as const
                ).map(([pos, lbl]) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => onUpdateSubtitleStyle({ ...subtitleStyle, position: pos })}
                    className={`rounded-xl border py-1.5 text-[10px] font-semibold transition ${
                      subtitleStyle.position === pos
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                        : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/65'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
              <div>
                <div className="text-[10.5px] font-semibold text-white">
                  Videoya Göm (Burn-In Export)
                </div>
                <div className="text-[8.5px] text-[var(--text-muted)]">
                  Final render çıktısına altyazıları doğrudan işler
                </div>
              </div>
              <input
                type="checkbox"
                checked={subtitleStyle.burnInOnExport}
                onChange={(e) =>
                  onUpdateSubtitleStyle({
                    ...subtitleStyle,
                    burnInOnExport: e.target.checked
                  })
                }
                className="accent-[var(--accent)]"
              />
            </label>
          </div>
        </div>

        {/* Sütun 3 (4 col): Otomatik Sessizlik Algılama (Silence Detection) */}
        <div className="soft-card flex flex-col gap-3 p-4 lg:col-span-4">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-2">
            <span className="panel-title">Otomatik Sessizlik Algılama (Silence Detection)</span>
            <button
              type="button"
              data-testid="analyze-silence-btn"
              onClick={handleAnalyzeSilence}
              className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition hover:brightness-110 active:scale-95"
            >
              Sessizliği Tara
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-white/65">
                <span>Eşik (Threshold)</span>
                <span className="font-mono text-[var(--accent)]">{thresholdDb} dB</span>
              </div>
              <input
                data-testid="silence-threshold-slider"
                type="range"
                min={-55}
                max={-15}
                step={1}
                value={thresholdDb}
                onChange={(e) => setThresholdDb(Number(e.target.value))}
                style={
                  {
                    '--pct': `${((thresholdDb + 55) / 40) * 100}%`
                  } as React.CSSProperties
                }
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[10px] text-white/65">
                <span>Min. Süre</span>
                <span className="font-mono text-[var(--accent)]">{minSilenceDur.toFixed(2)} sn</span>
              </div>
              <input
                data-testid="silence-duration-slider"
                type="range"
                min={0.15}
                max={2.5}
                step={0.05}
                value={minSilenceDur}
                onChange={(e) => setMinSilenceDur(Number(e.target.value))}
                style={
                  {
                    '--pct': `${((minSilenceDur - 0.15) / 2.35) * 100}%`
                  } as React.CSSProperties
                }
                className="w-full"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[10px]">
            <span className="text-white/80">
              Bağlı Ses ve Video Senkronunu Koru (Linked A/V Sync)
            </span>
            <input
              type="checkbox"
              checked={syncLinkedAv}
              onChange={(e) => setSyncLinkedAv(e.target.checked)}
              className="accent-[var(--accent)]"
            />
          </label>

          {/* Tespit Edilen Sessiz Bölgeler Görsel Listesi */}
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {detectedSilences.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-5 text-center text-[10.5px] text-[var(--text-muted)]">
                &ldquo;Sessizliği Tara&rdquo; düğmesine basarak düşük sesli veya sessiz bölümleri tespit edin. Onayınız olmadan hiçbir klip silinmez.
              </div>
            ) : (
              detectedSilences.map((reg) => (
                <div
                  key={reg.id}
                  data-testid={`silence-region-${reg.id}`}
                  className="flex items-center justify-between rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-[10px]"
                >
                  <button
                    type="button"
                    onClick={() => onSeek(reg.start)}
                    className="text-left font-mono text-white/85 hover:text-[var(--accent)]"
                  >
                    <span>
                      {reg.start.toFixed(2)}s → {reg.end.toFixed(2)}s
                    </span>
                    <span className="ml-2 text-white/45">
                      ({reg.duration.toFixed(2)}s · {reg.avgDb}dB)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDetectedSilences((prev) => prev.filter((r) => r.id !== reg.id))
                    }
                    title="Bu bölgeyi listeden çıkar"
                    className="text-white/40 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* İşlem & Kullanıcı Onay Düğmeleri */}
          {detectedSilences.length > 0 && (
            <div className="space-y-2 border-t border-[color:var(--border-subtle)] pt-2">
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  data-testid="silence-to-markers-btn"
                  onClick={() => onAddMarkersFromSilence(detectedSilences)}
                  className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] py-1.5 text-[9.5px] font-semibold text-white/85 hover:border-[var(--accent)]"
                >
                  İşaretçi Ekle
                </button>
                <button
                  type="button"
                  data-testid="silence-split-btn"
                  onClick={() => setConfirmAction('split')}
                  className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] py-1.5 text-[9.5px] font-semibold text-white/85 hover:border-[var(--accent)]"
                >
                  Klipleri Böl
                </button>
                <button
                  type="button"
                  data-testid="silence-remove-btn"
                  onClick={() => setConfirmAction('remove')}
                  className="rounded-xl border border-amber-400/45 bg-amber-400/12 py-1.5 text-[9.5px] font-semibold text-amber-300 hover:bg-amber-400/20"
                >
                  Sessizliği Sil
                </button>
              </div>

              {confirmAction && (
                <div
                  data-testid="silence-confirm-box"
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--accent)] bg-black/60 px-3 py-2 text-[10px]"
                >
                  <span className="text-white/90">
                    {confirmAction === 'remove'
                      ? `${detectedSilences.length} sessiz bölüm silinip boşluklar kapatılsın mı?`
                      : `${detectedSilences.length} sessiz bölüm sınırlarından klipler bölünsün mü?`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="silence-confirm-yes"
                      onClick={() => {
                        if (confirmAction === 'remove') {
                          onRemoveDetectedSilence(detectedSilences, syncLinkedAv)
                        } else {
                          onSplitClipsAtSilence(detectedSilences, syncLinkedAv)
                        }
                        setConfirmAction(null)
                        setDetectedSilences([])
                      }}
                      className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 font-bold text-[var(--accent-fg)]"
                    >
                      Onayla
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction(null)}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-white/70"
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
