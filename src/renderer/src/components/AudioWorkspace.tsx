import {
  MAX_DB,
  MIN_DB,
  NOIR_SOUNDSCAPE_PRESETS,
  type AudioFxPreset,
  type LaneId,
  type LaneState,
  type NoirSoundscapeId,
  type TimelineClip
} from '../../../shared/timeline'

function fmtDb(db: number): string {
  if (db <= MIN_DB) return '-∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export default function AudioWorkspace({
  activeClip,
  clips,
  lanes,
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
  onToggleLane: (lane: LaneId, key: 'muted' | 'solo') => void
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  autoDucking: boolean
  onToggleAutoDucking: (enabled: boolean) => void
  onAddSoundscapeClip: (presetId: NoirSoundscapeId) => void
  onSelectClip: (clipId: string) => void
}) {
  const audioClips = clips.filter(
    (c) => c.lane === 'A1' || c.lane === 'A2' || c.lane === 'V1'
  )

  const patchClip = (patch: Partial<TimelineClip>) => {
    if (!activeClip) return
    onUpdateClip(activeClip.id, patch)
  }

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
            {(['V1', 'A1', 'A2'] as LaneId[]).map((laneId) => {
              const st = lanes[laneId]
              const laneClips = clips.filter((c) => c.lane === laneId)
              return (
                <div
                  key={laneId}
                  className="flex flex-col justify-between rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white">{laneId}</span>
                    <span className="font-mono text-[9px] text-[var(--text-muted)]">
                      {laneClips.length} klip
                    </span>
                  </div>
                  <div className="my-3 flex h-14 items-end justify-center gap-1.5 rounded-2xl bg-black/35 p-2">
                    {[52, 74, 90, 64, 82].map((pct, bi) => (
                      <span
                        key={bi}
                        className="w-2 rounded-full transition-all duration-200"
                        style={{
                          height: st.muted ? '14%' : `${pct}%`,
                          background: st.muted
                            ? 'rgba(255,255,255,0.16)'
                            : 'linear-gradient(180deg, #c6ec82 0%, rgba(183,227,106,0.22) 100%)',
                          boxShadow: st.muted ? 'none' : '0 0 8px rgba(183,227,106,0.28)'
                        }}
                      />
                    ))}
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
                          ? 'border-[var(--accent)] bg-[var(--accent)]/12 text-white shadow-[0_0_12px_rgba(183,227,106,0.16)]'
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
                patchClip({ gainDb: 0, pan: 0, fadeIn: 0, fadeOut: 0, audioPreset: 'none' })
              }
              className="chip !py-0.5 !text-[9px] disabled:opacity-30"
            >
              Sıfırla
            </button>
          </div>

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
                    ? 'bg-[var(--accent)] shadow-[0_0_12px_rgba(183,227,106,0.4)]'
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

        {/* Sütun 3: Noir Atmosfer & Foley Ses Üreticisi */}
        <div className="soft-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] pb-2.5">
            <span className="panel-title">Noir Ses Atmosferleri (Foley & FX)</span>
            <span className="font-mono text-[9px] text-[var(--accent)]">A2 KANALINA EKLE</span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {NOIR_SOUNDSCAPE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onAddSoundscapeClip(preset.id)}
                className="flex items-center justify-between rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-left transition duration-150 hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-white">{preset.label}</div>
                  <div className="mt-0.5 text-[9.5px] text-[var(--text-muted)]">
                    {preset.desc}
                  </div>
                </div>
                <span className="ml-2 shrink-0 rounded-full bg-[var(--accent)] px-3 py-1 font-mono text-[9px] font-bold text-[var(--accent-fg)]">
                  + A2
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
