import { useEffect, useState } from 'react'
import {
  MAX_DB,
  MIN_DB,
  NOIR_SOUNDSCAPE_PRESETS,
  clipAt,
  clipGainAt,
  defaultAudioEffectsChain,
  getOrderedAudioLanes,
  getOrderedVideoLanesAsc,
  isAudioLane,
  isCreditClip,
  isLaneAudible,
  isVideoLane,
  type AudioEffectsChain,
  type AudioFxPreset,
  type LaneId,
  type LaneState,
  type NoirSoundscapeId,
  type TimelineClip
} from '../../../shared/timeline'
import type { PeaksResult } from '../../../shared/types'
import WaveformCanvas from './WaveformCanvas'

function fmtDb(db: number): string {
  if (db <= MIN_DB) return '-∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export default function AudioWorkspace({
  activeClip,
  clips,
  lanes,
  peaksMap = {},
  playing = false,
  time = 0,
  subscribeTime,
  masterGainDb = 0,
  onMasterGainChange,
  onToggleLane,
  onUpdateClip,
  autoDucking,
  onToggleAutoDucking,
  onAddSoundscapeClip,
  onSelectClip
}: {
  activeClip: TimelineClip | null
  clips: TimelineClip[]
  lanes: Record<LaneId, LaneState>
  peaksMap?: Record<string, PeaksResult>
  playing?: boolean
  time?: number
  subscribeTime?: (cb: (t: number) => void) => () => void
  masterGainDb?: number
  onMasterGainChange?: (db: number) => void
  onToggleLane: (lane: LaneId, key: 'muted' | 'solo') => void
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  autoDucking: boolean
  onToggleAutoDucking: (enabled: boolean) => void
  onAddSoundscapeClip: (presetId: NoirSoundscapeId) => void
  onSelectClip: (clipId: string) => void
}) {
  const [liveTime, setLiveTime] = useState(time)
  useEffect(() => {
    setLiveTime(time)
  }, [time])
  useEffect(() => {
    if (!subscribeTime) return
    return subscribeTime((t) => setLiveTime(t))
  }, [subscribeTime])

  const audioClips = clips.filter(
    (c) => isAudioLane(c.lane) || (isVideoLane(c.lane) && !isCreditClip(c))
  )
  const mixerLanes: LaneId[] = [
    ...getOrderedVideoLanesAsc(lanes, clips),
    ...getOrderedAudioLanes(lanes, clips)
  ].filter(
    (laneId) =>
      laneId === 'V1' ||
      isAudioLane(laneId) ||
      clips.some((c) => c.lane === laneId && !isCreditClip(c))
  )

  const patchClip = (patch: Partial<TimelineClip>) => {
    if (!activeClip) return
    onUpdateClip(activeClip.id, patch)
  }

  const fx: AudioEffectsChain = activeClip?.audioEffects ?? defaultAudioEffectsChain()
  const patchFx = (patch: Partial<AudioEffectsChain>) => {
    if (!activeClip) return
    onUpdateClip(activeClip.id, {
      audioEffects: { ...fx, ...patch }
    })
  }

  // Canlı Kanal ve Master Peak/VU seviye hesaplaması (peaksMap + aktif klip kazancı üzerinden)
  const computeLaneLevelPct = (laneId: LaneId): { levelPct: number; peakDb: number } => {
    if (!isLaneAudible(lanes, laneId)) return { levelPct: 0, peakDb: -60 }
    const c = clipAt(clips, laneId, liveTime)
    if (!c || isCreditClip(c) || (isVideoLane(c.lane) && c.audioDetached)) {
      return { levelPct: 8, peakDb: -48 }
    }
    const local = Math.max(0, Math.min(c.duration, liveTime - c.start))
    const gainLin = clipGainAt(c, local)
    const pk = peaksMap[c.mediaId]
    let sampleNorm = 0.55
    if (pk && pk.peaks.length > 0) {
      const idx = Math.min(
        pk.peaks.length - 1,
        Math.max(0, Math.floor((c.in + local) * pk.perSecond))
      )
      sampleNorm = Math.max(0.08, pk.peaks[idx] / 255)
    }
    const jitter = playing ? 0.92 + Math.sin(liveTime * 29 + laneId.charCodeAt(1)) * 0.08 : 1
    const eff = Math.min(1.4, sampleNorm * gainLin * jitter)
    const db = eff <= 0.001 ? -60 : Math.max(-60, Math.min(6, 20 * Math.log10(eff)))
    const pct = Math.max(6, Math.min(100, ((db + 60) / 66) * 100))
    return { levelPct: Math.round(pct), peakDb: Number(db.toFixed(1)) }
  }

  const laneMeters = mixerLanes.map((lid) => ({ laneId: lid, ...computeLaneLevelPct(lid) }))
  const masterPeakDb = Math.min(
    6,
    laneMeters.reduce((m, x) => Math.max(m, x.peakDb), -60) + masterGainDb
  )
  const masterLevelPct = Math.max(6, Math.min(100, Math.round(((masterPeakDb + 60) / 66) * 100)))

  return (
    <section
      data-testid="audio-workspace"
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Üst Başlık */}
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="panel-title">Ses Mikseri ve İşleme Stüdyosu (Audio Workspace)</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-muted)]">
          <span>
            Aktif Klip:{' '}
            <strong className="text-white">
              {activeClip ? activeClip.name : 'Seçilmedi'}
            </strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            Auto-Ducking:{' '}
            <strong className={autoDucking ? 'text-[var(--accent)]' : 'text-white/50'}>
              {autoDucking ? 'AÇIK' : 'KAPALI'}
            </strong>
          </span>
        </div>
      </div>

      {/* 3 Sütunlu Profesyonel Ses Düzeni */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3.5 lg:grid-cols-3">
        {/* Sütun 1: Kanal Mikseri (V1 / A1 / A2) & Klip Listesi */}
        <div className="soft-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-2.5">
            <span className="panel-title">Kanal Mikseri (Track Mixer)</span>
            <span className="font-mono text-[9px] text-[var(--text-muted)]">MUTE · SOLO</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {mixerLanes.map((laneId) => {
              const st = lanes[laneId] ?? { muted: false, solo: false }
              const laneClips = clips.filter((c) => c.lane === laneId)
              const meter = laneMeters.find((m) => m.laneId === laneId) ?? {
                levelPct: 12,
                peakDb: -48
              }
              return (
                <div
                  key={laneId}
                  data-testid={`audio-mixer-channel-${laneId}`}
                  className="flex flex-col justify-between rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white">{laneId}</span>
                    <span
                      className={`font-mono text-[8.5px] ${
                        meter.peakDb > -3 ? 'text-rose-400' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {st.muted ? 'MUTE' : `${meter.peakDb} dB`}
                    </span>
                  </div>
                  <div className="my-2.5 flex h-16 items-end justify-center gap-1.5 rounded-2xl bg-black/35 p-2">
                    {[0.72, 0.9, 1.0, 0.84, 0.95].map((mult, bi) => {
                      const barPct = st.muted
                        ? 10
                        : Math.max(10, Math.min(100, Math.round(meter.levelPct * mult)))
                      return (
                        <span
                          key={bi}
                          className="w-2 rounded-full transition-all duration-150"
                          style={{
                            height: `${barPct}%`,
                            background: st.muted
                              ? 'rgba(255,255,255,0.16)'
                              : barPct > 88
                                ? 'linear-gradient(180deg, #EF4444 0%, var(--accent) 55%, var(--accent-soft) 100%)'
                                : 'linear-gradient(180deg, var(--accent-hover) 0%, var(--accent-soft) 100%)',
                            boxShadow: st.muted ? 'none' : '0 0 8px var(--accent-glow)'
                          }}
                        />
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToggleLane(laneId, 'muted')}
                      className={`rounded-full border py-1 font-mono text-[9px] font-bold transition duration-150 active:scale-95 ${
                        st.muted
                          ? 'border-rose-500/70 bg-rose-500/20 text-rose-300'
                          : 'border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:text-white'
                      }`}
                    >
                      MUTE
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleLane(laneId, 'solo')}
                      className={`rounded-full border py-1 font-mono text-[9px] font-bold transition duration-150 active:scale-95 ${
                        st.solo
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
                          : 'border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:text-white'
                      }`}
                    >
                      SOLO
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Master Output Fader & Peak Meter */}
          <div
            data-testid="master-audio-bus"
            className="rounded-2xl border border-[color:var(--border-subtle)] bg-black/30 p-3"
          >
            <div className="mb-1.5 flex items-center justify-between text-[10px]">
              <span className="font-mono font-bold tracking-wider text-white/85">
                MASTER BUS · PEAK METER
              </span>
              <span
                className={`font-mono text-[10px] font-bold ${
                  masterPeakDb > -1.5 ? 'text-rose-400' : 'text-[var(--accent)]'
                }`}
              >
                {fmtDb(masterGainDb)} ({masterPeakDb.toFixed(1)} dBFS)
              </span>
            </div>
            <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${masterLevelPct}%`,
                  background:
                    'linear-gradient(90deg, var(--accent) 0%, var(--accent-hover) 75%, #F59E0B 90%, #EF4444 100%)'
                }}
              />
            </div>
            <input
              data-testid="master-gain-slider"
              type="range"
              min={-36}
              max={12}
              step={0.5}
              value={masterGainDb}
              onDoubleClick={() => onMasterGainChange?.(0)}
              onChange={(e) => onMasterGainChange?.(parseFloat(e.target.value))}
              style={
                {
                  '--pct': `${Math.max(0, Math.min(100, ((masterGainDb + 36) / 48) * 100))}%`
                } as React.CSSProperties
              }
              className="w-full"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <span className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              Ses İçeren Klipler
            </span>
            <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
              {audioClips.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] p-3 text-center text-[10px] text-[var(--text-muted)]">
                  Zaman çizelgesinde ses veya video klibi yok.
                </div>
              ) : (
                audioClips.map((c) => {
                  const selected = activeClip?.id === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectClip(c.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[10px] transition duration-150 ${
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white shadow-[0_0_12px_var(--accent-glow)]'
                          : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/75 hover:border-white/25'
                      }`}
                    >
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="ml-2 shrink-0 font-mono text-[9px] text-[var(--accent)]">
                        {c.lane} · {fmtDb(c.gainDb ?? 0)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Sütun 2: Seçili Klip Kazanç, Pan, Fade ve Audio FX */}
        <div className="soft-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-2">
            <span className="panel-title">Klip Ses İşleme (Clip DSP)</span>
            <button
              type="button"
              disabled={!activeClip}
              onClick={() =>
                patchClip({
                  gainDb: 0,
                  pan: 0,
                  fadeIn: 0,
                  fadeOut: 0,
                  audioPreset: 'none',
                  audioEffects: defaultAudioEffectsChain()
                })
              }
              className="chip !py-0.5 !text-[9px] disabled:opacity-30"
            >
              Sıfırla
            </button>
          </div>

          {activeClip && (
            <div className="h-10 w-full overflow-hidden rounded-xl border border-white/[0.06] bg-black/40">
              <WaveformCanvas
                clip={activeClip}
                peaks={peaksMap[activeClip.mediaId]}
                width={320}
                height={40}
                variant="track"
              />
            </div>
          )}

          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-white/70">
                <span>Ses Seviyesi (Gain)</span>
                <span className="font-mono text-[var(--accent)]">
                  {fmtDb(activeClip?.gainDb ?? 0)}
                </span>
              </div>
              <input
                type="range"
                min={MIN_DB}
                max={MAX_DB}
                step={0.5}
                disabled={!activeClip}
                value={activeClip?.gainDb ?? 0}
                onChange={(e) => patchClip({ gainDb: parseFloat(e.target.value) })}
                style={
                  {
                    '--pct': `${Math.max(0, Math.min(100, (((activeClip?.gainDb ?? 0) - MIN_DB) / Math.max(0.001, MAX_DB - MIN_DB)) * 100))}%`
                  } as React.CSSProperties
                }
                className="w-full disabled:opacity-35"
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[10px] text-white/70">
                <span>Pan (Sol ↔ Sağ Denge)</span>
                <span className="font-mono text-[var(--accent)]">{activeClip?.pan ?? 0}</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                disabled={!activeClip}
                value={activeClip?.pan ?? 0}
                onChange={(e) => patchClip({ pan: parseFloat(e.target.value) })}
                style={
                  {
                    '--pct': `${Math.max(0, Math.min(100, (((activeClip?.pan ?? 0) + 100) / 200) * 100))}%`
                  } as React.CSSProperties
                }
                className="w-full disabled:opacity-35"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-white/70">
                  <span>Fade In</span>
                  <span className="font-mono text-[var(--accent)]">
                    {(activeClip?.fadeIn ?? 0).toFixed(1)} sn
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)}
                  step={0.1}
                  disabled={!activeClip}
                  value={activeClip?.fadeIn ?? 0}
                  onChange={(e) => patchClip({ fadeIn: parseFloat(e.target.value) })}
                  style={
                    {
                      '--pct': `${Math.max(0, Math.min(100, ((activeClip?.fadeIn ?? 0) / Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)) * 100))}%`
                    } as React.CSSProperties
                  }
                  className="w-full disabled:opacity-35"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-white/70">
                  <span>Fade Out</span>
                  <span className="font-mono text-[var(--accent)]">
                    {(activeClip?.fadeOut ?? 0).toFixed(1)} sn
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)}
                  step={0.1}
                  disabled={!activeClip}
                  value={activeClip?.fadeOut ?? 0}
                  onChange={(e) => patchClip({ fadeOut: parseFloat(e.target.value) })}
                  style={
                    {
                      '--pct': `${Math.max(0, Math.min(100, ((activeClip?.fadeOut ?? 0) / Math.max(0.5, (activeClip?.duration ?? 5) * 0.5)) * 100))}%`
                    } as React.CSSProperties
                  }
                  className="w-full disabled:opacity-35"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] text-white/65">Ses Efekt Ön Ayarı (Audio FX)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['none', 'Doğal', 'Ham ses'],
                    ['denoise', 'Denoise', 'Gürültü azalt'],
                    ['bass-boost', 'Sinematik Bas', 'Alt frekans']
                  ] as Array<[AudioFxPreset, string, string]>
                ).map(([id, label, desc]) => {
                  const selected = (activeClip?.audioPreset ?? 'none') === id
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!activeClip}
                      onClick={() => patchClip({ audioPreset: id })}
                      className={`rounded-xl border p-2.5 text-left transition duration-150 disabled:opacity-35 ${
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                          : 'border-[color:var(--border-subtle)] bg-[var(--bg-panel)] text-white/70 hover:border-white/25'
                      }`}
                    >
                      <div className="text-[10px] font-semibold">{label}</div>
                      <div className="mt-0.5 text-[8.5px] text-white/45">{desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3.5 py-2.5 transition duration-150 hover:border-[var(--accent)]/50">
              <div>
                <div className="text-[11px] font-semibold text-white">Auto-Ducking (Diyalog Önceliği)</div>
                <div className="text-[9px] text-[var(--text-muted)]">
                  A1 diyalog kanalında ses varken A2 müzik/ambiyansı otomatik kısar
                </div>
              </div>
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition duration-200 ${
                  autoDucking
                    ? 'bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                    : 'bg-[#2a2f39]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={autoDucking}
                  onChange={(e) => onToggleAutoDucking(e.target.checked)}
                  className="sr-only"
                />
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    autoDucking
                      ? 'translate-x-[18px] bg-[#101114]'
                      : 'translate-x-[3px] bg-[#8f96a3]'
                  }`}
                />
              </span>
            </label>
          </div>
        </div>

        {/* Sütun 3: Profesyonel Ses Efekt Zinciri (3-Bant EQ · Compressor · Limiter · Reverb · Denoise) & Noir Atmosferleri */}
        <div className="soft-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-2">
            <span className="panel-title">Ses Efekt Zinciri (EQ · Comp · Limiter · Reverb)</span>
            <span className="font-mono text-[9px] text-[var(--accent)]">DSP CHAIN</span>
          </div>

          {/* 3-Band Equalizer */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-white/85">
              <span>3-Bant Parametrik Equalizer</span>
              <button
                type="button"
                disabled={!activeClip}
                onClick={() => patchFx({ eqLowDb: 0, eqMidDb: 0, eqHighDb: 0 })}
                className="font-mono text-[8.5px] text-[var(--text-muted)] hover:text-white disabled:opacity-30"
              >
                EQ Sıfırla
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  ['eqLowDb', 'Low (100Hz)', fx.eqLowDb],
                  ['eqMidDb', 'Mid (1kHz)', fx.eqMidDb],
                  ['eqHighDb', 'High (8kHz)', fx.eqHighDb]
                ] as const
              ).map(([key, lbl, val]) => (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-[9px] text-white/65">
                    <span>{lbl}</span>
                    <span className="font-mono text-[var(--accent)]">
                      {val > 0 ? `+${val}` : val}dB
                    </span>
                  </div>
                  <input
                    data-testid={`audio-${key}-slider`}
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    disabled={!activeClip}
                    value={val}
                    onDoubleClick={() => patchFx({ [key]: 0 })}
                    onChange={(e) => patchFx({ [key]: parseFloat(e.target.value) })}
                    style={
                      {
                        '--pct': `${Math.max(0, Math.min(100, ((val + 12) / 24) * 100))}%`
                      } as React.CSSProperties
                    }
                    className="w-full disabled:opacity-35"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Compressor, Limiter, Reverb & Noise Reduction */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-white">Compressor</span>
                <input
                  data-testid="audio-compressor-toggle"
                  type="checkbox"
                  disabled={!activeClip}
                  checked={fx.compressorEnabled}
                  onChange={(e) => patchFx({ compressorEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
              </div>
              <div className="mb-1 flex justify-between text-[8.5px] text-white/60">
                <span>Threshold ({fx.compressorThresholdDb}dB)</span>
                <span>{fx.compressorRatio}:1</span>
              </div>
              <input
                type="range"
                min={-36}
                max={0}
                step={1}
                disabled={!activeClip || !fx.compressorEnabled}
                value={fx.compressorThresholdDb}
                onChange={(e) => patchFx({ compressorThresholdDb: parseFloat(e.target.value) })}
                style={
                  {
                    '--pct': `${((fx.compressorThresholdDb + 36) / 36) * 100}%`
                  } as React.CSSProperties
                }
                className="w-full disabled:opacity-35"
              />
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-white">Brickwall Limiter</span>
                <input
                  data-testid="audio-limiter-toggle"
                  type="checkbox"
                  disabled={!activeClip}
                  checked={fx.limiterEnabled}
                  onChange={(e) => patchFx({ limiterEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
              </div>
              <div className="mb-1 flex justify-between text-[8.5px] text-white/60">
                <span>Tavan (Ceiling)</span>
                <span className="font-mono text-[var(--accent)]">{fx.limiterCeilingDb} dB</span>
              </div>
              <input
                type="range"
                min={-12}
                max={0}
                step={0.5}
                disabled={!activeClip || !fx.limiterEnabled}
                value={fx.limiterCeilingDb}
                onChange={(e) => patchFx({ limiterCeilingDb: parseFloat(e.target.value) })}
                style={
                  {
                    '--pct': `${((fx.limiterCeilingDb + 12) / 12) * 100}%`
                  } as React.CSSProperties
                }
                className="w-full disabled:opacity-35"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-2.5">
              <div className="mb-1 flex justify-between text-[9.5px] text-white/80">
                <span>Studio Reverb</span>
                <span className="font-mono text-[var(--accent)]">{fx.reverbMix}%</span>
              </div>
              <input
                data-testid="audio-reverb-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                disabled={!activeClip}
                value={fx.reverbMix}
                onChange={(e) => patchFx({ reverbMix: parseFloat(e.target.value) })}
                style={{ '--pct': `${fx.reverbMix}%` } as React.CSSProperties}
                className="w-full disabled:opacity-35"
              />
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2">
              <div>
                <div className="text-[10px] font-semibold text-white">Noise Reduction</div>
                <div className="text-[8.5px] text-[var(--text-muted)]">Dip gürültü filtresi</div>
              </div>
              <input
                data-testid="audio-nr-toggle"
                type="checkbox"
                disabled={!activeClip}
                checked={fx.noiseReduction}
                onChange={(e) => patchFx({ noiseReduction: e.target.checked })}
                className="accent-[var(--accent)]"
              />
            </label>
          </div>

          <div className="mt-1 flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-1.5">
            <span className="panel-title">Noir Ses Atmosferleri (Foley & FX)</span>
            <span className="font-mono text-[9px] text-[var(--accent)]">A2 KANALINA EKLE</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {NOIR_SOUNDSCAPE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onAddSoundscapeClip(preset.id)}
                className="flex items-center justify-between rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-2 text-left transition duration-150 hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-semibold text-white">{preset.label}</div>
                  <div className="truncate text-[8.5px] text-[var(--text-muted)]">
                    {preset.desc}
                  </div>
                </div>
                <span className="ml-1.5 shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 font-mono text-[8px] font-bold text-[var(--accent-fg)]">
                  +A2
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
