import {
  defaultFilmTexture,
  FILM_GRAIN_PRESETS,
  type FilmGrainProfile,
  type FilmTextureConfig
} from '../../../../shared/noirfilm'
import { NoirSlider, NoirToggle } from './NoirControls'

const GRAIN_PROFILES: Array<{ id: FilmGrainProfile; label: string }> = [
  { id: '35mm', label: '35mm' },
  { id: '16mm', label: '16mm' },
  { id: '8mm', label: '8mm' },
  { id: 'fine', label: 'Fine Grain' },
  { id: 'heavy', label: 'Heavy Grain' },
  { id: 'vintage', label: 'Vintage Grain' }
]

export default function FilmGrainPanel({
  config,
  onChange
}: {
  config: FilmTextureConfig
  onChange: (next: FilmTextureConfig) => void
}) {
  const update = (patch: Partial<FilmTextureConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  const applyProfile = (profile: FilmGrainProfile) => {
    const preset = FILM_GRAIN_PRESETS[profile]
    onChange({
      ...config,
      enabled: true,
      profile,
      ...preset
    })
  }

  return (
    <div data-testid="noirfilm-texture-panel" className="flex flex-col gap-3">
      {/* Üst Başlık + Playback Önizleme Anahtarı */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#B7E36A]" />
            <span className="text-[11px] font-semibold tracking-wider text-[#F1F2EE] uppercase">
              Film Texture & Organic Grain Engine
            </span>
          </div>
          <p className="text-[9.5px] text-[#9298A3]">
            Oynatma sırasında greni geçici kapatıp export sırasında tam kalitede uygulayabilirsiniz.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NoirToggle
            testId="grain-playback-preview-toggle"
            checked={config.playbackPreview}
            label="Oynatmada Önizle"
            onChange={(playbackPreview) => onChange({ ...config, playbackPreview })}
          />
          <NoirToggle
            testId="film-grain-toggle"
            checked={config.enabled}
            label={config.enabled ? 'Aktif' : 'Kapalı'}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultFilmTexture())}
            className="rounded-full bg-[#242830] px-3 py-1 text-[9.5px] font-medium text-[#9298A3] transition-colors hover:bg-[#292E36] hover:text-[#F1F2EE]"
          >
            Sıfırla
          </button>
        </div>
      </div>

      {/* Gren Profilleri */}
      <div className="flex flex-wrap items-center gap-1.5">
        {GRAIN_PROFILES.map((p) => {
          const active = config.profile === p.id
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`grain-profile-${p.id}`}
              onClick={() => applyProfile(p.id)}
              className={`rounded-full px-3.5 py-1 text-[10px] font-semibold transition-all duration-150 ${
                active
                  ? 'bg-[#B7E36A] text-[#101114] shadow-[0_0_12px_rgba(183,227,106,0.25)]'
                  : 'bg-[#242830] text-[#9298A3] hover:bg-[#292E36] hover:text-[#F1F2EE]'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* 7 Organik Gren Parametresi */}
      <div className="inner-card grid grid-cols-2 gap-x-5 gap-y-2.5 p-3">
        <NoirSlider
          label="Grain Amount"
          testId="nf-grain-amount"
          value={config.amount}
          min={0}
          max={100}
          defaultValue={24}
          unit="%"
          disabled={!config.enabled}
          onChange={(amount) => update({ amount })}
        />
        <NoirSlider
          label="Grain Size"
          value={config.size}
          min={0}
          max={100}
          defaultValue={38}
          unit="%"
          disabled={!config.enabled}
          onChange={(size) => update({ size })}
        />
        <NoirSlider
          label="Grain Strength"
          value={config.strength}
          min={0}
          max={100}
          defaultValue={45}
          unit="%"
          disabled={!config.enabled}
          onChange={(strength) => update({ strength })}
        />
        <NoirSlider
          label="Grain Softness"
          value={config.softness}
          min={0}
          max={100}
          defaultValue={35}
          unit="%"
          disabled={!config.enabled}
          onChange={(softness) => update({ softness })}
        />
        <NoirSlider
          label="Grain Distribution (Gölge ↔ Işık)"
          value={config.distribution}
          min={0}
          max={100}
          defaultValue={50}
          unit="%"
          disabled={!config.enabled}
          onChange={(distribution) => update({ distribution })}
        />
        <NoirSlider
          label="Luminance Grain"
          value={config.luminanceGrain}
          min={0}
          max={100}
          defaultValue={75}
          unit="%"
          disabled={!config.enabled}
          onChange={(luminanceGrain) => update({ luminanceGrain })}
        />
        <div className="col-span-2">
          <NoirSlider
            label="Color Grain (Chroma)"
            value={config.colorGrain}
            min={0}
            max={100}
            defaultValue={25}
            unit="%"
            disabled={!config.enabled}
            onChange={(colorGrain) => update({ colorGrain })}
          />
        </div>
      </div>
    </div>
  )
}
