import { defaultMistEffect, type MistEffectConfig } from '../../../../shared/noirfilm'
import { NoirSlider, NoirToggle } from './NoirControls'

export default function MistPanel({
  config,
  onChange
}: {
  config: MistEffectConfig
  onChange: (next: MistEffectConfig) => void
}) {
  const update = (patch: Partial<MistEffectConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div data-testid="noirfilm-mist-card" className="inner-card flex flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#A78BFA]" />
          <span className="text-[10.5px] font-semibold text-[#F1F2EE]">Mist</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NoirToggle
            checked={config.enabled}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultMistEffect())}
            className="rounded-full bg-[#1B1E24] px-2 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
          >
            Sıfırla
          </button>
        </div>
      </div>

      <NoirSlider
        label="Mist Intensity"
        value={config.intensity}
        min={0}
        max={100}
        defaultValue={20}
        unit="%"
        disabled={!config.enabled}
        onChange={(intensity) => update({ intensity })}
      />
      <NoirSlider
        label="Highlight Spread"
        value={config.highlightSpread}
        min={0}
        max={100}
        defaultValue={55}
        unit="%"
        disabled={!config.enabled}
        onChange={(highlightSpread) => update({ highlightSpread })}
      />
      <NoirSlider
        label="Atmospheric Softness"
        value={config.atmosphericSoftness}
        min={0}
        max={100}
        defaultValue={50}
        unit="%"
        disabled={!config.enabled}
        onChange={(atmosphericSoftness) => update({ atmosphericSoftness })}
      />
      <NoirSlider
        label="Contrast Reduction"
        value={config.contrastReduction}
        min={0}
        max={100}
        defaultValue={25}
        unit="%"
        disabled={!config.enabled}
        onChange={(contrastReduction) => update({ contrastReduction })}
      />
    </div>
  )
}
