import {
  defaultChromaKey,
  type ChromaKeyConfig
} from '../../../../shared/noirfilm'
import { NoirColorSwatchInput, NoirSlider, NoirToggle } from './NoirControls'

export default function ChromaKeyPanel({
  config,
  onChange
}: {
  config: ChromaKeyConfig
  onChange: (next: ChromaKeyConfig) => void
}) {
  const update = (patch: Partial<ChromaKeyConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div
      data-testid="noirfilm-chromakey-panel"
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
    >
      {/* Sol: Anahtar Rengi (Green Screen / Blue Screen / Özel) & Tolerans */}
      <div className="inner-card flex flex-col gap-3 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full border border-white/30"
              style={{ backgroundColor: config.keyColor }}
            />
            <span className="text-[11px] font-semibold text-[#F1F2EE]">
              Chroma Key (Green / Blue Screen)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <NoirToggle
              testId="chromakey-enable-toggle"
              checked={config.enabled}
              label={config.enabled ? 'AKTİF' : 'KAPALI'}
              onChange={(enabled) => onChange({ ...config, enabled })}
            />
            <button
              type="button"
              onClick={() => onChange(defaultChromaKey())}
              className="rounded-full bg-[#1B1E24] px-2.5 py-0.5 text-[9px] text-[#9298A3] hover:text-[#F1F2EE]"
            >
              Sıfırla
            </button>
          </div>
        </div>

        {/* Hızlı Green Screen / Blue Screen Seçici */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="chromakey-preset-green"
            onClick={() => update({ keyColor: '#00B140' })}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-semibold transition ${
              config.keyColor.toLowerCase() === '#00b140'
                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                : 'border-[#343943] bg-[#1B1E24] text-[#9298A3] hover:text-white'
            }`}
          >
            <span className="h-3 w-3 rounded-full bg-[#00B140]" />
            <span>Green Screen</span>
          </button>
          <button
            type="button"
            data-testid="chromakey-preset-blue"
            onClick={() => update({ keyColor: '#0047BB' })}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-semibold transition ${
              config.keyColor.toLowerCase() === '#0047bb'
                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                : 'border-[#343943] bg-[#1B1E24] text-[#9298A3] hover:text-white'
            }`}
          >
            <span className="h-3 w-3 rounded-full bg-[#0047BB]" />
            <span>Blue Screen</span>
          </button>
        </div>

        <NoirColorSwatchInput
          label="Anahtar Rengi Seçici (Color Picker)"
          value={config.keyColor}
          presets={['#00B140', '#00FF00', '#188038', '#0047BB', '#0000FF', '#2563EB']}
          disabled={!config.enabled}
          onChange={(keyColor) => update({ keyColor })}
        />

        <NoirSlider
          label="Renk Toleransı (Key Tolerance)"
          testId="chromakey-tolerance-slider"
          value={config.tolerance}
          min={1}
          max={90}
          defaultValue={32}
          unit="%"
          disabled={!config.enabled}
          onChange={(tolerance) => update({ tolerance })}
        />

        <NoirSlider
          label="Kenar Yumuşatma (Edge Refinement)"
          testId="chromakey-edge-slider"
          value={config.edgeSoftness}
          min={0}
          max={75}
          defaultValue={18}
          unit="%"
          disabled={!config.enabled}
          onChange={(edgeSoftness) => update({ edgeSoftness })}
        />
      </div>

      {/* Sağ: Spill Suppression, Matte Preview & Arka Plan Değiştirme */}
      <div className="inner-card flex flex-col justify-between gap-3 p-3.5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold text-[#F1F2EE]">
              Spill Suppression & Matte Kontrolü
            </span>
            <NoirToggle
              testId="chromakey-matte-toggle"
              checked={config.mattePreview}
              label="Matte Önizleme"
              onChange={(mattePreview) => update({ mattePreview })}
            />
          </div>

          <NoirSlider
            label="Yeşil/Mavi Yansıma Giderme (Spill Suppression)"
            testId="chromakey-spill-slider"
            value={config.spillSuppression}
            min={0}
            max={100}
            defaultValue={45}
            unit="%"
            disabled={!config.enabled}
            onChange={(spillSuppression) => update({ spillSuppression })}
          />

          <NoirSlider
            label="Ön Plan Şeffaflığı (Adjustable Transparency)"
            testId="chromakey-opacity-slider"
            value={config.opacity}
            min={0}
            max={100}
            defaultValue={100}
            unit="%"
            disabled={!config.enabled}
            onChange={(opacity) => update({ opacity })}
          />
        </div>

        <div className="rounded-xl border border-[#343943]/80 bg-[#1B1E24] p-2.5">
          <NoirColorSwatchInput
            label="Arka Plan Değiştirme Rengi (Background Replacement)"
            value={config.bgColor}
            presets={['#0B0D12', '#18181B', '#1E293B', '#31102F', '#F1F2EE']}
            disabled={!config.enabled}
            onChange={(bgColor) => update({ bgColor, bgMode: 'color' })}
          />
        </div>
      </div>
    </div>
  )
}
