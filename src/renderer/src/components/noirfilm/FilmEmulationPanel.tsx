import {
  defaultFilmEmulation,
  type FilmEmulationConfig,
  type FilmFormat
} from '../../../../shared/noirfilm'
import {
  NoirCircularDial,
  NoirColorSwatchInput,
  NoirSlider,
  NoirToggle
} from './NoirControls'

const FORMATS: Array<{ id: FilmFormat; label: string; badge: string }> = [
  { id: '35mm', label: '35mm Film', badge: 'Sinema Standardı' },
  { id: '16mm', label: '16mm Film', badge: 'Organik Bağımsız' },
  { id: '8mm', label: '8mm Film', badge: 'Yüksek Karakter' }
]

export default function FilmEmulationPanel({
  config,
  onChange
}: {
  config: FilmEmulationConfig
  onChange: (next: FilmEmulationConfig) => void
}) {
  const update = (patch: Partial<FilmEmulationConfig>) =>
    onChange({ ...config, ...patch, enabled: true })

  return (
    <div data-testid="noirfilm-emulation-panel" className="flex flex-col gap-3">
      {/* Üst Başlık + Aç/Kapat + Sıfırla */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#B7E36A]" />
            <span className="text-[11px] font-semibold tracking-wider text-[#F1F2EE] uppercase">
              Dijital Film Emülasyon Motoru
            </span>
          </div>
          <p className="text-[9.5px] text-[#9298A3]">
            Dijital film esinli simülasyon (gerçek film stoğu kalibrasyon verisi yerine ayarlanabilir sinema eğrisi).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <NoirToggle
            testId="film-emu-toggle"
            checked={config.enabled}
            label={config.enabled ? 'Aktif' : 'Kapalı'}
            onChange={(enabled) => onChange({ ...config, enabled })}
          />
          <button
            type="button"
            onClick={() => onChange(defaultFilmEmulation())}
            className="rounded-full bg-[#242830] px-3 py-1 text-[9.5px] font-medium text-[#9298A3] transition-colors hover:bg-[#292E36] hover:text-[#F1F2EE]"
          >
            Sıfırla
          </button>
        </div>
      </div>

      {/* Film Format Seçimi (35mm / 16mm / 8mm) */}
      <div className="flex flex-wrap items-center gap-2">
        {FORMATS.map((f) => {
          const active = config.format === f.id
          return (
            <button
              key={f.id}
              type="button"
              data-testid={`film-format-${f.id}`}
              onClick={() => update({ format: f.id })}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[10px] font-semibold transition-all duration-150 ${
                active
                  ? 'bg-[#B7E36A] text-[#101114] shadow-[0_0_12px_rgba(183,227,106,0.28)]'
                  : 'bg-[#242830] text-[#9298A3] hover:bg-[#292E36] hover:text-[#F1F2EE]'
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`text-[8.5px] font-normal ${active ? 'text-[#101114]/75' : 'text-[#9298A3]/70'}`}
              >
                {f.badge}
              </span>
            </button>
          )
        })}
      </div>

      {/* Dairesel Hassas Kontroller + Sürgüler */}
      <div className="grid grid-cols-12 gap-3">
        <div className="inner-card col-span-5 flex flex-wrap items-center justify-around gap-3 p-3">
          <NoirCircularDial
            label="Contrast"
            value={config.contrast}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(contrast) => update({ contrast })}
          />
          <NoirCircularDial
            label="Roll-off"
            value={config.highlightRolloff}
            min={0}
            max={100}
            defaultValue={35}
            unit="%"
            disabled={!config.enabled}
            onChange={(highlightRolloff) => update({ highlightRolloff })}
          />
          <NoirCircularDial
            label="Density"
            value={config.colorDensity}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(colorDensity) => update({ colorDensity })}
          />
          <NoirCircularDial
            label="Response"
            value={config.filmResponse}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(filmResponse) => update({ filmResponse })}
          />
        </div>

        <div className="inner-card col-span-7 grid grid-cols-2 gap-x-4 gap-y-2.5 p-3">
          <NoirSlider
            label="Film Contrast"
            value={config.contrast}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(contrast) => update({ contrast })}
          />
          <NoirSlider
            label="Highlight Roll-off"
            value={config.highlightRolloff}
            min={0}
            max={100}
            defaultValue={35}
            unit="%"
            disabled={!config.enabled}
            onChange={(highlightRolloff) => update({ highlightRolloff })}
          />
          <NoirSlider
            label="Shadow Response"
            value={config.shadowResponse}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(shadowResponse) => update({ shadowResponse })}
          />
          <NoirSlider
            label="Saturation"
            value={config.saturation}
            min={0}
            max={200}
            defaultValue={100}
            unit="%"
            disabled={!config.enabled}
            onChange={(saturation) => update({ saturation })}
          />
          <NoirSlider
            label="Color Density"
            value={config.colorDensity}
            min={-100}
            max={100}
            defaultValue={0}
            disabled={!config.enabled}
            onChange={(colorDensity) => update({ colorDensity })}
          />
          <NoirSlider
            label="Color Temperature"
            value={config.temperature}
            min={-100}
            max={100}
            defaultValue={0}
            gradient={`linear-gradient(90deg, #38bdf8 0%, rgba(255,255,255,0.14) 50%, #f59e0b 100%)`}
            disabled={!config.enabled}
            onChange={(temperature) => update({ temperature })}
          />
          <div className="col-span-2 grid grid-cols-2 gap-3 pt-1">
            <NoirColorSwatchInput
              label="Highlight Tint"
              value={config.highlightTint}
              presets={['#FFF8EE', '#FFE4B8', '#E6F2FF', '#F3E8FF']}
              disabled={!config.enabled}
              onChange={(highlightTint) => update({ highlightTint })}
            />
            <NoirColorSwatchInput
              label="Shadow Tint"
              value={config.shadowTint}
              presets={['#0D141C', '#14110E', '#081814', '#16101B']}
              disabled={!config.enabled}
              onChange={(shadowTint) => update({ shadowTint })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
