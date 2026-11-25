import { defaultColorGrade, type ColorGrade, type WheelValue } from '../../../../shared/color'
import { HoneycombColorWheels } from '../ColorWheel'
import { Accordion } from './RightPanelControls'

export function RightPanelGradeTab({
  grade,
  activeClipName,
  wbDirty,
  wbPickerActive,
  onGrade,
  onAutoWhiteBalance,
  onToggleWbPicker
}: {
  grade: ColorGrade
  activeClipName?: string | null
  wbDirty: boolean
  wbPickerActive: boolean
  onGrade: (g: ColorGrade) => void
  onAutoWhiteBalance?: () => void
  onToggleWbPicker?: () => void
}) {
  const setWheel = (k: 'lift' | 'gamma' | 'gain') => (v: WheelValue) =>
    onGrade({ ...grade, [k]: v })

  return (
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

      <Accordion
        title="Beyaz Dengesi (White Balance)"
        defaultOpen
        right={
          <button
            type="button"
            data-testid="wb-reset-btn"
            disabled={!wbDirty}
            onClick={() => onGrade({ ...grade, temperature: 0, tint: 0 })}
            title="Sıcaklık ve Ton değerlerini sıfırla"
            className="chip !py-0.5 !text-[10px] disabled:opacity-30"
          >
            Sıfırla
          </button>
        }
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="auto-wb-btn"
            onClick={onAutoWhiteBalance}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-[#E4E4E7] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-white active:scale-95"
          >
            <span>Auto WB</span>
          </button>
          <button
            type="button"
            data-testid="wb-picker-btn"
            onClick={onToggleWbPicker}
            className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
              wbPickerActive
                ? 'border-[var(--accent)] bg-[var(--accent)]/25 text-white'
                : 'border-[color:var(--border-subtle)] bg-white/[0.04] text-[#E4E4E7]/85'
            }`}
          >
            <span>{wbPickerActive ? 'Seçiliyor…' : 'Damlalık'}</span>
          </button>
        </div>
      </Accordion>
    </>
  )
}
