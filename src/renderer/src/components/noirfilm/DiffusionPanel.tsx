import {
  defaultDiffusionEffect,
  type DiffusionEffectConfig
} from '../../../../shared/noirfilm'
import { NoirSlider, NoirToggle } from './NoirControls'

export default function DiffusionPanel({
  config,
  onChange
}: {
  config: DiffusionEffectConfig
  onChange: (next: DiffusionEffectConfig) => void
}) {
  const update = (patch: Partial<DiffusionEffectConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div data-testid="noirfilm-diffusion-card" className="inner-card flex flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#38BDF8]" />
          <span className="text-[10.5px] font-semibold text-[#F1F2EE]">Diffusion</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NoirToggle
            checked={config.enabled}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultDiffusionEffect())}
            className="rounded-full bg-[#1B1E24] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
          >
            Sıfırla
          </button>
        </div>
      </div>

      <NoirSlider
        label="Diffusion Strength"
        value={config.strength}
        min={0}
        max={100}
        defaultValue={22}
        unit="%"
        disabled={!config.enabled}
        onChange={(strength) => update({ strength })}
      />
      <NoirSlider
        label="Highlight Diffusion"
        value={config.highlightDiffusion}
        min={0}
        max={100}
        defaultValue={55}
        unit="%"
        disabled={!config.enabled}
        onChange={(highlightDiffusion) => update({ highlightDiffusion })}
      />
      <NoirSlider
        label="Softness"
        value={config.softness}
        min={0}
        max={100}
        defaultValue={50}
        unit="%"
        disabled={!config.enabled}
        onChange={(softness) => update({ softness })}
      />
      <NoirSlider
        label="Contrast Preservation"
        value={config.contrastPreservation}
        min={0}
        max={100}
        defaultValue={70}
        unit="%"
        disabled={!config.enabled}
        onChange={(contrastPreservation) => update({ contrastPreservation })}
      />
    </div>
  )
}
