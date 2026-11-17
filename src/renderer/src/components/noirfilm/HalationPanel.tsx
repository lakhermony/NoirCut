import {
  defaultHalationEffect,
  type HalationEffectConfig
} from '../../../../shared/noirfilm'
import { NoirColorSwatchInput, NoirSlider, NoirToggle } from './NoirControls'

export default function HalationPanel({
  config,
  onChange
}: {
  config: HalationEffectConfig
  onChange: (next: HalationEffectConfig) => void
}) {
  const update = (patch: Partial<HalationEffectConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div data-testid="noirfilm-halation-card" className="inner-card flex flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#FF4B1F]" />
          <span className="text-[10.5px] font-semibold text-[#F1F2EE]">Halation</span>
        </div>
        <div className="flex items-center gap-1.5">
          <NoirToggle
            checked={config.enabled}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultHalationEffect())}
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
        defaultValue={24}
        unit="%"
        disabled={!config.enabled}
        onChange={(intensity) => update({ intensity })}
      />
      <NoirSlider
        label="Threshold"
        value={config.threshold}
        min={10}
        max={98}
        defaultValue={62}
        unit="%"
        disabled={!config.enabled}
        onChange={(threshold) => update({ threshold })}
      />
      <NoirSlider
        label="Radius"
        value={config.radius}
        min={0}
        max={100}
        defaultValue={45}
        unit="%"
        disabled={!config.enabled}
        onChange={(radius) => update({ radius })}
      />
      <NoirSlider
        label="Spread"
        value={config.spread}
        min={0}
        max={100}
        defaultValue={50}
        unit="%"
        disabled={!config.enabled}
        onChange={(spread) => update({ spread })}
      />
      <NoirSlider
        label="Blend"
        value={config.blend}
        min={0}
        max={100}
        defaultValue={65}
        unit="%"
        disabled={!config.enabled}
        onChange={(blend) => update({ blend })}
      />
      <NoirColorSwatchInput
        label="Halation Color"
        value={config.color}
        presets={['#FF4B1F', '#FF2E2E', '#FF8533', '#FF6B4A']}
        disabled={!config.enabled}
        onChange={(color) => update({ color })}
      />
    </div>
  )
}
