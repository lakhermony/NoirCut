import { defaultBloomEffect, type BloomEffectConfig } from '../../../../shared/noirfilm'
import { NoirSlider, NoirToggle } from './NoirControls'

export default function BloomPanel({
  config,
  onChange
}: {
  config: BloomEffectConfig
  onChange: (next: BloomEffectConfig) => void
}) {
  const update = (patch: Partial<BloomEffectConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div data-testid="noirfilm-bloom-card" className="inner-card flex flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#FBBF24]" />
          <span className="text-[10.5px] font-semibold text-[#F1F2EE]">Bloom</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NoirToggle
            checked={config.enabled}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultBloomEffect())}
            className="rounded-full bg-[#1B1E24] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
          >
            Sıfırla
          </button>
        </div>
      </div>

      <NoirSlider
        label="Intensity"
        value={config.intensity}
        min={0}
        max={100}
        defaultValue={20}
        unit="%"
        disabled={!config.enabled}
        onChange={(intensity) => update({ intensity })}
      />
      <NoirSlider
        label="Threshold"
        value={config.threshold}
        min={10}
        max={98}
        defaultValue={65}
        unit="%"
        disabled={!config.enabled}
        onChange={(threshold) => update({ threshold })}
      />
      <NoirSlider
        label="Radius"
        value={config.radius}
        min={0}
        max={100}
        defaultValue={50}
        unit="%"
        disabled={!config.enabled}
        onChange={(radius) => update({ radius })}
      />
      <NoirSlider
        label="Softness"
        value={config.softness}
        min={0}
        max={100}
        defaultValue={55}
        unit="%"
        disabled={!config.enabled}
        onChange={(softness) => update({ softness })}
      />
      <NoirSlider
        label="Highlight Strength"
        value={config.highlightStrength}
        min={0}
        max={100}
        defaultValue={60}
        unit="%"
        disabled={!config.enabled}
        onChange={(highlightStrength) => update({ highlightStrength })}
      />
    </div>
  )
}
