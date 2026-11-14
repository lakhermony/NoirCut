import { useState, type ReactNode } from 'react'
import {
  defaultColorGrade,
  type ColorGrade,
  type WheelValue
} from '../../../shared/color'
import { FONT_MAP, type CreditConfig, type CreditFont } from '../../../shared/credits'
import type { Tab } from '../types'
import { HoneycombColorWheels } from './ColorWheel'

function Accordion({
  title,
  defaultOpen = true,
  right,
  children
}: {
  title: string
  defaultOpen?: boolean
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-app)]/70">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="text-[9px] text-[#71717A]">{open ? '▼' : '▶'}</span>
          <span className="panel-title !text-[#E4E4E7]/85">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="space-y-3 border-t border-[#71717A]/15 px-3 pb-3 pt-2.5">{children}</div>}
    </section>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  unit = ''
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  unit?: string
  onChange: (n: number) => void
}) {
  const formatted = step < 1 ? value.toFixed(2) : String(Math.round(value))
  return (
    <div>
      <div
        className="mb-1 flex cursor-pointer justify-between text-[10px] text-white/55"
        title={defaultValue !== undefined ? 'Çift tıkla: sıfırla' : undefined}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      >
        <span>{label}</span>
        <span className="font-mono text-tungsten">
          {formatted}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

export default function RightPanel({
  tab,
  grade,
  activeClipName,
  onGrade,
  credit,
  onCredit,
  onAddCreditToTimeline
}: {
  tab: Tab
  grade: ColorGrade
  activeClipName?: string | null
  onGrade: (g: ColorGrade) => void
  credit: CreditConfig
  onCredit: (c: CreditConfig) => void
  onAddCreditToTimeline: () => void
}) {
  const setWheel = (k: 'lift' | 'gamma' | 'gain') => (v: WheelValue) =>
    onGrade({ ...grade, [k]: v })

  const addCreditRow = () => {
    onCredit({
      ...credit,
      rows: [
        ...credit.rows,
        { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'ROL', name: 'İsim' }
      ]
    })
  }

  const updateRow = (id: string, patch: { role?: string; name?: string }) => {
    onCredit({
      ...credit,
      rows: credit.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    })
  }

  const removeRow = (id: string) => {
    onCredit({
      ...credit,
      rows: credit.rows.filter((r) => r.id !== id)
    })
  }

  return (
    <aside className="glass flex h-full w-[320px] shrink-0 flex-col gap-3 overflow-y-auto p-3">
      {(tab === 'GRADE' || tab === 'CUT') && (
        <>
          <Accordion
            title="Renk Tekerlekleri"
            defaultOpen
            right={
              <button
                data-testid="grade-reset-btn"
                className="chip !py-0.5 !text-[10px]"
                onClick={() => onGrade(defaultColorGrade())}
                title="Tüm renk ve LUT ayarlarını sıfırla"
              >
                Sıfırla
              </button>
            }
          >
            {activeClipName && (
              <div className="truncate font-mono text-[9px] text-[#71717A]">Klip: {activeClipName}</div>
            )}
            <HoneycombColorWheels
              lift={grade.lift}
              gamma={grade.gamma}
              gain={grade.gain}
              onLift={setWheel('lift')}
              onGamma={setWheel('gamma')}
              onGain={setWheel('gain')}
            />
          </Accordion>

          <Accordion title="Temel Düzeltme" defaultOpen={tab === 'GRADE'}>
            <Slider
              label="Pozlama (Exposure)"
              value={grade.exposure}
              min={-2}
              max={2}
              step={0.05}
              defaultValue={0}
              unit=" EV"
              onChange={(exposure) => onGrade({ ...grade, exposure })}
            />
            <Slider
              label="Kontrast (Contrast)"
              value={grade.contrast}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(contrast) => onGrade({ ...grade, contrast })}
            />
            <Slider
              label="Sıcaklık (Temperature)"
              value={grade.temperature}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(temperature) => onGrade({ ...grade, temperature })}
            />
            <Slider
              label="Renk Tonu (Tint)"
              value={grade.tint}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              onChange={(tint) => onGrade({ ...grade, tint })}
            />
            <Slider
              label="Doygunluk (Saturation)"
              value={grade.saturation}
              min={0}
              max={200}
              step={1}
              defaultValue={100}
              unit="%"
              onChange={(saturation) => onGrade({ ...grade, saturation })}
            />
          </Accordion>
        </>
      )}

      {tab === 'CUT' && (
        <Accordion title="Klip Özellikleri" defaultOpen={false}>
          <Slider label="Hız" value={100} min={25} max={400} unit="%" onChange={() => {}} />
          <Slider label="Opaklık" value={100} min={0} max={100} unit="%" onChange={() => {}} />
        </Accordion>
      )}

      {tab === 'CREDITS' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="panel-title">Jenerik Editörü</span>
            <button
              data-testid="add-credit-btn"
              onClick={onAddCreditToTimeline}
              className="rounded-md bg-[#27272A] px-3 py-1.5 text-[10px] font-bold text-white ring-1 ring-[#71717A]/50 transition hover:bg-[#3F3F46] active:scale-95"
            >
              + Timeline'a Ekle
            </button>
          </div>

          <Accordion title="İçerik & Satırlar" defaultOpen>
            {credit.templateId === 'rolling-credits' ? (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Üst Başlık (Opsiyonel)</div>
                  <input
                    value={credit.title}
                    onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                    placeholder="Örn: NOIRCUT SUNAR"
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/50">Kadro Satırları (Rol — İsim)</span>
                  <button
                    data-testid="add-credit-row-btn"
                    onClick={addCreditRow}
                    className="chip !py-0.5 !text-[10px]"
                  >
                    + Yeni Satır Ekle
                  </button>
                </div>

                <div className="max-h-[150px] space-y-1.5 overflow-y-auto pr-0.5">
                  {credit.rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-1.5">
                      <input
                        value={row.role}
                        onChange={(e) => updateRow(row.id, { role: e.target.value })}
                        placeholder="Rol"
                        className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none focus:border-[#71717A]"
                      />
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.id, { name: e.target.value })}
                        placeholder="İsim"
                        className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white outline-none focus:border-[#71717A]"
                      />
                      <button
                        onClick={() => removeRow(row.id)}
                        title="Satırı sil"
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-white/40 hover:bg-[#71717A]/25 hover:text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Ana Başlık</div>
                  <input
                    data-testid="credit-title-input"
                    value={credit.title}
                    onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10px] text-white/50">Alt Başlık</div>
                  <input
                    data-testid="credit-subtitle-input"
                    value={credit.subtitle}
                    onChange={(e) => onCredit({ ...credit, subtitle: e.target.value })}
                    className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
                  />
                </div>
              </div>
            )}
          </Accordion>

          <Accordion title="Tipografi ve Süre" defaultOpen={false}>
            <div>
              <div className="mb-1 text-[10px] text-white/50">Font Seçimi</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(FONT_MAP) as CreditFont[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => onCredit({ ...credit, font: f })}
                    className={`rounded-md border px-2 py-1 text-[10px] transition ${
                      credit.font === f
                        ? 'border-[#71717A] bg-[#71717A]/20 text-white'
                        : 'border-[#71717A]/20 text-white/60 hover:border-[#71717A]/50'
                    }`}
                  >
                    {FONT_MAP[f].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                <span>Metin Rengi</span>
                <span className="font-mono text-[#71717A]">{credit.color}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={credit.color}
                  onChange={(e) => onCredit({ ...credit, color: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-[#71717A]/30 bg-transparent"
                />
                {['#FFFFFF', '#E4E4E7', '#A1A1AA', '#71717A'].map((sw) => (
                  <button
                    key={sw}
                    onClick={() => onCredit({ ...credit, color: sw })}
                    className={`h-5 w-5 rounded-full border transition ${
                      credit.color.toUpperCase() === sw ? 'border-white scale-110' : 'border-white/20'
                    }`}
                    style={{ background: sw }}
                    title={sw}
                  />
                ))}
              </div>
            </div>

            <Slider
              label="Yazı Boyutu"
              value={credit.fontSize}
              min={16}
              max={96}
              step={1}
              unit="px"
              onChange={(fontSize) => onCredit({ ...credit, fontSize })}
            />
            <Slider
              label="Harf Aralığı"
              value={credit.letterSpacing}
              min={0}
              max={16}
              step={0.5}
              unit="px"
              onChange={(letterSpacing) => onCredit({ ...credit, letterSpacing })}
            />
            <Slider
              label="Toplam Akış Süresi"
              value={credit.duration}
              min={2}
              max={30}
              step={0.5}
              unit="s"
              onChange={(duration) => onCredit({ ...credit, duration })}
            />
          </Accordion>

          <Accordion title="Efektler & Foley Ses" defaultOpen>
            <label className="flex cursor-pointer items-center justify-between rounded-md border border-[#71717A]/20 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/80 hover:border-[#71717A]/60">
              <span>Daktilo Efekti (Typewriter)</span>
              <input
                data-testid="credit-typewriter-toggle"
                type="checkbox"
                checked={credit.typewriter}
                onChange={(e) => onCredit({ ...credit, typewriter: e.target.checked })}
                className="accent-[#71717A]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-md border border-[#71717A]/20 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/80 hover:border-[#71717A]/60">
              <span>Film Titremesi (Gate Weave)</span>
              <input
                data-testid="credit-weave-toggle"
                type="checkbox"
                checked={credit.filmWeave}
                onChange={(e) => onCredit({ ...credit, filmWeave: e.target.checked })}
                className="accent-[#71717A]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-md border border-[#71717A]/20 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/80 hover:border-[#71717A]/60">
              <span>Efekt Sesi Ekle (Foley SFX)</span>
              <input
                data-testid="credit-sfx-toggle"
                type="checkbox"
                checked={credit.sfxEnabled}
                onChange={(e) => onCredit({ ...credit, sfxEnabled: e.target.checked })}
                className="accent-[#71717A]"
              />
            </label>

            {credit.sfxEnabled && (
              <Slider
                label="Foley Ses Seviyesi"
                value={credit.sfxVolume}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(sfxVolume) => onCredit({ ...credit, sfxVolume })}
              />
            )}
          </Accordion>
        </div>
      )}
    </aside>
  )
}
