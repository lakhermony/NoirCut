import { useEffect, useRef } from 'react'
import {
  FONT_MAP,
  creditTypewriterInfo,
  type CreditConfig
} from '../../../shared/credits'
import { foleyAudio } from '../lib/foley-audio'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export default function CreditOverlay({
  credit,
  localTime,
  duration,
  playing = false,
  isPreview = false
}: {
  credit: CreditConfig
  localTime: number
  duration: number
  playing?: boolean
  isPreview?: boolean
}) {
  const dur = Math.max(0.2, duration || credit.duration)
  const p = clamp01(localTime / dur)
  const fontFamily = FONT_MAP[credit.font]?.css ?? FONT_MAP.sans.css

  const { totalChars, visibleChars, titleLen } = creditTypewriterInfo(credit, localTime, dur)
  const prevVisibleRef = useRef(visibleChars)

  // Daktilo tuş vuruşu ve satır sonu zil sesi senkronu
  useEffect(() => {
    const prev = prevVisibleRef.current
    prevVisibleRef.current = visibleChars
    if (!playing || !credit.sfxEnabled || !credit.typewriter) return
    if (visibleChars > prev && visibleChars - prev <= 4) {
      const fullText = credit.title + (credit.templateId === 'rolling-credits' ? '' : credit.subtitle)
      const ch = fullText[visibleChars - 1]
      if (ch && ch !== ' ') {
        const isLineEnd =
          (credit.subtitle.length > 0 && visibleChars === titleLen) || visibleChars === totalChars
        foleyAudio.triggerTypewriterKey(credit.sfxVolume / 100, isLineEnd)
      }
    }
  }, [
    visibleChars,
    playing,
    credit.sfxEnabled,
    credit.typewriter,
    credit.sfxVolume,
    credit.title,
    credit.subtitle,
    credit.templateId,
    titleLen,
    totalChars
  ])

  // 35mm Projektör uğultusu / tıkırtısı (Film Titremesi aktifken)
  useEffect(() => {
    const shouldRun = playing && credit.sfxEnabled && credit.filmWeave
    foleyAudio.setProjectorRunning(shouldRun, credit.sfxVolume / 100)
    return () => {
      foleyAudio.stopProjector()
    }
  }, [playing, credit.sfxEnabled, credit.filmWeave, credit.sfxVolume])

  const displayTitle = credit.typewriter ? credit.title.slice(0, Math.min(titleLen, visibleChars)) : credit.title
  const subChars = Math.max(0, visibleChars - titleLen)
  const displaySubtitle = credit.typewriter ? credit.subtitle.slice(0, subChars) : credit.subtitle
  const showCaret = credit.typewriter && visibleChars < totalChars

  // Fade zarfı (0..1)
  const fadeInEnd = 0.18
  const fadeOutStart = 0.82
  const alpha =
    credit.typewriter && p < fadeOutStart
      ? 1
      : p < fadeInEnd
        ? p / fadeInEnd
        : p > fadeOutStart
          ? (1 - p) / (1 - fadeOutStart)
          : 1

  const blurPx =
    credit.templateId === 'noir-opening' && !credit.typewriter
      ? p < fadeInEnd
        ? (1 - p / fadeInEnd) * 8
        : p > fadeOutStart
          ? ((p - fadeOutStart) / (1 - fadeOutStart)) * 8
          : 0
      : 0

  // Organik Film Gate Weave titremesi ve ışık sızması
  const weaveX = credit.filmWeave ? Math.sin(localTime * 37.7) * 1.4 + Math.cos(localTime * 19.3) * 0.8 : 0
  const weaveY = credit.filmWeave ? Math.cos(localTime * 43.1) * 1.2 + Math.sin(localTime * 23.7) * 0.6 : 0
  const flicker = credit.filmWeave ? 0.94 + Math.sin(localTime * 53.0) * 0.04 : 1

  return (
    <div
      data-testid="credit-overlay"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden select-none"
      style={{
        fontFamily,
        color: credit.color,
        transform: credit.filmWeave ? `translate(${weaveX.toFixed(2)}px, ${weaveY.toFixed(2)}px)` : undefined,
        opacity: flicker
      }}
    >
      {credit.filmWeave && (
        <div
          className="absolute inset-0 opacity-25 mix-blend-screen"
          style={{
            background: `radial-gradient(circle at ${20 + Math.sin(localTime * 0.9) * 12}% ${18 + Math.cos(localTime * 0.7) * 10}%, rgba(245,166,35,0.38), transparent 55%)`
          }}
        />
      )}

      {isPreview && (
        <span className="absolute left-3 bottom-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[9px] tracking-wider text-tungsten ring-1 ring-tungsten/40">
          JENERİK ÖNİZLEME
        </span>
      )}

      {credit.templateId === 'rolling-credits' && (
        <div
          className="absolute inset-x-0 flex flex-col items-center gap-4 px-8 text-center"
          style={{
            top: `${(1 - p) * 105 - p * 85}%`,
            transform: 'translateY(-10%)'
          }}
        >
          {credit.title.trim() && (
            <div
              className="mb-4 font-bold uppercase"
              style={{
                fontSize: `clamp(14px, ${credit.fontSize * 0.055}vw, ${credit.fontSize}px)`,
                letterSpacing: `${credit.letterSpacing}px`
              }}
            >
              {displayTitle}
              {showCaret && visibleChars <= titleLen && <span className="animate-pulse opacity-75">|</span>}
            </div>
          )}
          <div className="flex w-full max-w-[82%] flex-col gap-3">
            {credit.rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-2 items-baseline gap-5"
                style={{
                  fontSize: `clamp(11px, ${credit.fontSize * 0.042}vw, ${Math.round(credit.fontSize * 0.72)}px)`
                }}
              >
                <span
                  className="text-right font-semibold uppercase opacity-60"
                  style={{ letterSpacing: `${Math.max(1, credit.letterSpacing * 0.7)}px` }}
                >
                  {row.role}
                </span>
                <span
                  className="text-left font-medium"
                  style={{ letterSpacing: `${Math.max(0.5, credit.letterSpacing * 0.35)}px` }}
                >
                  {row.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {credit.templateId === 'noir-opening' && (
        <div
          className="flex h-full w-full flex-col items-center justify-center px-8 text-center"
          style={{
            opacity: alpha,
            filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(1)}px)` : 'none',
            textShadow: '0 4px 24px rgba(0,0,0,0.85)'
          }}
        >
          <div
            className="font-bold uppercase leading-tight"
            style={{
              fontSize: `clamp(18px, ${credit.fontSize * 0.07}vw, ${credit.fontSize}px)`,
              letterSpacing: `${credit.letterSpacing}px`
            }}
          >
            {displayTitle}
            {showCaret && visibleChars <= titleLen && <span className="animate-pulse opacity-75">|</span>}
          </div>
          {credit.subtitle.trim() && (
            <div
              className="mt-3 uppercase opacity-75"
              style={{
                fontSize: `clamp(10px, ${credit.fontSize * 0.025}vw, ${Math.max(12, Math.round(credit.fontSize * 0.3))}px)`,
                letterSpacing: `${Math.max(2, credit.letterSpacing * 0.6)}px`
              }}
            >
              {displaySubtitle}
              {showCaret && visibleChars > titleLen && <span className="animate-pulse opacity-75">|</span>}
            </div>
          )}
        </div>
      )}

      {credit.templateId === 'lower-third' && (
        <div
          className="absolute bottom-[10%] left-[6%] flex items-stretch gap-3 rounded-r-md bg-black/55 px-4 py-2.5 backdrop-blur-sm"
          style={{
            opacity: alpha,
            transform: `translateX(${((1 - alpha) * -18).toFixed(1)}px)`
          }}
        >
          <div className="w-1 rounded-full bg-tungsten shadow-[0_0_10px_#F5A623]" />
          <div>
            <div
              className="font-bold uppercase leading-tight"
              style={{
                fontSize: `clamp(13px, ${credit.fontSize * 0.045}vw, ${Math.round(credit.fontSize * 0.78)}px)`,
                letterSpacing: `${credit.letterSpacing}px`
              }}
            >
              {displayTitle}
              {showCaret && visibleChars <= titleLen && <span className="animate-pulse opacity-75">|</span>}
            </div>
            {credit.subtitle.trim() && (
              <div
                className="mt-0.5 opacity-80"
                style={{
                  fontSize: `clamp(10px, ${credit.fontSize * 0.028}vw, ${Math.max(12, Math.round(credit.fontSize * 0.45))}px)`,
                  letterSpacing: `${Math.max(0.5, credit.letterSpacing * 0.4)}px`
                }}
              >
                {displaySubtitle}
                {showCaret && visibleChars > titleLen && <span className="animate-pulse opacity-75">|</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {credit.templateId === 'chapter-card' && (
        <div
          className="flex h-full w-full flex-col items-center justify-center px-8 text-center"
          style={{
            opacity: alpha,
            textShadow: '0 4px 20px rgba(0,0,0,0.85)'
          }}
        >
          <div
            className="font-bold uppercase"
            style={{
              fontSize: `clamp(16px, ${credit.fontSize * 0.065}vw, ${credit.fontSize}px)`,
              letterSpacing: `${credit.letterSpacing}px`
            }}
          >
            {displayTitle}
            {showCaret && visibleChars <= titleLen && <span className="animate-pulse opacity-75">|</span>}
          </div>
          <div className="my-3 h-px w-24 bg-current opacity-45" />
          {credit.subtitle.trim() && (
            <div
              className="italic opacity-85"
              style={{
                fontSize: `clamp(11px, ${credit.fontSize * 0.032}vw, ${Math.max(14, Math.round(credit.fontSize * 0.42))}px)`,
                letterSpacing: `${Math.max(1, credit.letterSpacing * 0.3)}px`
              }}
            >
              {displaySubtitle}
              {showCaret && visibleChars > titleLen && <span className="animate-pulse opacity-75">|</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
