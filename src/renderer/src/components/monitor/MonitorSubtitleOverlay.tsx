import type { SubtitleSegment, SubtitleStyleConfig } from '../../../../shared/timeline'

export function MonitorSubtitleOverlay({
  subtitles,
  subtitleStyle,
  currentTime
}: {
  subtitles: SubtitleSegment[]
  subtitleStyle?: SubtitleStyleConfig
  currentTime: number
}) {
  if (subtitles.length === 0) return null
  const activeSub = subtitles.find((s) => currentTime >= s.start && currentTime <= s.end)
  if (!activeSub) return null

  const posCls =
    subtitleStyle?.position === 'top'
      ? 'top-6'
      : subtitleStyle?.position === 'center'
        ? 'top-1/2 -translate-y-1/2'
        : 'bottom-6'
  const anim = subtitleStyle?.animation ?? 'none'
  const hiColor = subtitleStyle?.highlightColor ?? '#FACC15'
  const words = activeSub.text.split(/\s+/).filter(Boolean)
  const progress = Math.max(
    0,
    Math.min(
      0.999,
      (currentTime - activeSub.start) / Math.max(0.05, activeSub.end - activeSub.start)
    )
  )
  const activeWordIdx = Math.floor(progress * Math.max(1, words.length))
  const bgAlpha = Math.max(0, Math.min(1, (subtitleStyle?.backgroundOpacity ?? 72) / 100))

  return (
    <div
      data-testid="monitor-subtitle-overlay"
      className={`pointer-events-none absolute inset-x-6 z-30 flex justify-center ${posCls}`}
    >
      <span
        style={{
          fontFamily: subtitleStyle?.fontFamily ?? 'Inter, system-ui, sans-serif',
          fontSize: `${Math.max(12, Math.round((subtitleStyle?.fontSize ?? 26) * 0.72))}px`,
          color: subtitleStyle?.textColor ?? '#F1F2EE',
          backgroundColor:
            bgAlpha > 0 ? (subtitleStyle?.backgroundColor ?? '#0A0B0E') : 'transparent',
          opacity: 1
        }}
        className={`max-w-[85%] rounded-lg px-3.5 py-1.5 text-center shadow-lg ${
          anim === 'hormozi'
            ? 'font-black uppercase tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]'
            : 'font-medium'
        }`}
      >
        {anim === 'none'
          ? activeSub.text
          : anim === 'typewriter'
            ? activeSub.text.slice(0, Math.max(1, Math.ceil(progress * activeSub.text.length)))
            : words.map((w, idx) => {
                const isCurrent = idx === activeWordIdx
                const isPast = idx < activeWordIdx
                return (
                  <span
                    key={`${w}-${idx}`}
                    style={{
                      color:
                        anim === 'hormozi'
                          ? isCurrent
                            ? hiColor
                            : subtitleStyle?.textColor ?? '#FFFFFF'
                          : isCurrent || isPast
                            ? hiColor
                            : subtitleStyle?.textColor ?? '#F1F2EE',
                      transform: anim === 'hormozi' && isCurrent ? 'scale(1.14)' : undefined,
                      display: 'inline-block',
                      marginRight: '0.32em',
                      transition: 'transform 80ms ease'
                    }}
                  >
                    {w}
                  </span>
                )
              })}
      </span>
    </div>
  )
}
