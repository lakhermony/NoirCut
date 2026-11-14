/**
 * Harici ses dosyası gerektirmeyen deterministik Foley SFX WAV sentezleyicisi.
 * FFmpeg export sırasında V2 jenerik kliplerine ses katmanı üretmek için kullanılır.
 */
import type { CreditConfig } from './credits'

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/** Deterministik PRNG (sabit tohumlu gürültü) */
function makeRng(seed = 1337): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0xffffffff) * 2 - 1
  }
}

export function synthesizeCreditFoleyWav(
  credit: CreditConfig,
  durationSec: number,
  sampleRate = 48000
): Uint8Array {
  const dur = Math.max(0.2, durationSec)
  const totalSamples = Math.ceil(dur * sampleRate)
  const mixL = new Float32Array(totalSamples)
  const mixR = new Float32Array(totalSamples)
  const vol = Math.max(0, Math.min(1, credit.sfxVolume / 100))
  const rng = makeRng(4242)

  // 1) Daktilo tuş vuruşu + satır sonu zil tınısı
  if (credit.typewriter) {
    const title = credit.title
    const subtitle = credit.templateId === 'rolling-credits' ? '' : credit.subtitle
    const fullText = title + subtitle
    const totalChars = fullText.length
    const writeWindow = dur * 0.7

    if (totalChars > 0) {
      for (let k = 0; k < totalChars; k++) {
        const ch = fullText[k]
        if (ch === ' ') continue
        const tStart = (k / totalChars) * writeWindow
        const startIdx = Math.floor(tStart * sampleRate)
        const clickLen = Math.floor(sampleRate * 0.024)
        const pitchShift = 0.88 + ((k * 37) % 25) * 0.01

        for (let i = 0; i < clickLen; i++) {
          const idx = startIdx + i
          if (idx >= totalSamples) break
          const t = i / sampleRate
          const env = Math.exp(-t * 210)
          const body = Math.sin(2 * Math.PI * (170 * pitchShift * Math.exp(-t * 30)) * t) * 0.45
          const snap = rng() * 0.65 * Math.exp(-t * 360)
          const sample = (body + snap) * env * 0.42 * vol
          // Hafif stereo genişlik
          const pan = 0.46 + ((k % 5) / 5) * 0.08
          mixL[idx] += sample * (1 - pan) * 2
          mixR[idx] += sample * pan * 2
        }

        // Satır sonu (title -> subtitle geçişi veya son karakter) şaryo zili
        const isLineEnd =
          (subtitle.length > 0 && k === title.length - 1) || k === totalChars - 1
        if (isLineEnd) {
          const bellLen = Math.floor(sampleRate * 0.32)
          for (let i = 0; i < bellLen; i++) {
            const idx = startIdx + i
            if (idx >= totalSamples) break
            const t = i / sampleRate
            const env = Math.exp(-t * 11)
            const bell =
              (Math.sin(2 * Math.PI * 2420 * t) * 0.6 +
                Math.sin(2 * Math.PI * 3630 * t) * 0.25) *
              env *
              0.16 *
              vol
            mixL[idx] += bell
            mixR[idx] += bell
          }
        }
      }
    }
  }

  // 2) 35mm Sinema Projektörü uğultusu + 24fps organik mekanik tıkırtı
  if (credit.filmWeave) {
    const framePeriod = sampleRate / 24
    let lpState = 0
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      // Yumuşak fade in/out
      const edgeEnv = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.25)
      const hum =
        (Math.sin(2 * Math.PI * 58 * t) * 0.55 + Math.sin(2 * Math.PI * 116 * t) * 0.25) * 0.09

      // 24fps mekanik deklanşör tıkırtısı
      const phase = i % framePeriod
      const tickEnv = phase < sampleRate * 0.008 ? Math.exp((-phase / sampleRate) * 420) : 0
      const rawNoise = rng()
      lpState = lpState * 0.72 + rawNoise * 0.28
      const tick = lpState * tickEnv * 0.14

      const s = (hum + tick) * edgeEnv * vol
      mixL[i] += s
      mixR[i] += s
    }
  }

  // 16-bit Stereo PCM WAV paketleme
  const dataBytes = totalSamples * 4
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM
  view.setUint16(20, 1, true) // Linear PCM
  view.setUint16(22, 2, true) // Stereo
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < totalSamples; i++) {
    const l = Math.tanh(mixL[i])
    const r = Math.tanh(mixR[i])
    view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(l * 32767))), true)
    view.setInt16(offset + 2, Math.max(-32768, Math.min(32767, Math.round(r * 32767))), true)
    offset += 4
  }

  return new Uint8Array(buffer)
}
