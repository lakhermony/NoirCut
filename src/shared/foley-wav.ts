/**
 * Harici ses dosyası gerektirmeyen deterministik Foley SFX WAV sentezleyicisi.
 * FFmpeg export sırasında V2 jenerik kliplerine ses katmanı üretmek için kullanılır.
 */
import type { CreditConfig } from './credits'
import { NOIR_SOUNDSCAPE_PRESETS, type NoirSoundscapeId } from './timeline'

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

function packStereoPcmWavAndPeaks(
  mixL: Float32Array,
  mixR: Float32Array,
  durationSec: number,
  sampleRate: number,
  peaksPerSecond = 50
): { wav: Uint8Array; peaks: Uint8Array } {
  const totalSamples = mixL.length
  const dataBytes = totalSamples * 4
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  const totalPeakBuckets = Math.max(1, Math.ceil(durationSec * peaksPerSecond))
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / totalPeakBuckets))
  const peaks = new Uint8Array(totalPeakBuckets)

  let offset = 44
  for (let i = 0; i < totalSamples; i++) {
    const l = Math.tanh(mixL[i])
    const r = Math.tanh(mixR[i])
    view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(l * 32767))), true)
    view.setInt16(offset + 2, Math.max(-32768, Math.min(32767, Math.round(r * 32767))), true)
    offset += 4

    const bIdx = Math.min(totalPeakBuckets - 1, Math.floor(i / samplesPerBucket))
    const amp = Math.min(255, Math.round(Math.max(Math.abs(l), Math.abs(r)) * 255))
    if (amp > peaks[bIdx]) peaks[bIdx] = amp
  }

  return { wav: new Uint8Array(buffer), peaks }
}

/**
 * Harici ses dosyasına ihtiyaç duymadan 4 imza Noir Soundscape efektini
 * (Gerilim Riser, Düşük Bas Darbesi / Sub Drop, Film Projektörü, Gece Yağmuru)
 * 48kHz Stereo WAV ve hazır dalga formu tepe (peaks) dizisi olarak sentezler.
 */
export function synthesizeNoirSoundscapeWav(
  presetId: NoirSoundscapeId,
  sampleRate = 48000
): { wav: Uint8Array; peaks: Uint8Array; duration: number; label: string } {
  const meta =
    NOIR_SOUNDSCAPE_PRESETS.find((p) => p.id === presetId) ?? NOIR_SOUNDSCAPE_PRESETS[0]
  const dur = meta.duration
  const totalSamples = Math.ceil(dur * sampleRate)
  const mixL = new Float32Array(totalSamples)
  const mixR = new Float32Array(totalSamples)
  const rng = makeRng(
    presetId === 'tension-riser'
      ? 7001
      : presetId === 'sub-drop'
        ? 7002
        : presetId === 'film-projector'
          ? 7003
          : 7004
  )

  if (presetId === 'tension-riser') {
    // 1) Gerilim Riser: Yükselen sinematik gerilim sweep + filtreli gürültü kreşendosu
    let phase1 = 0
    let phase2 = 0
    let phase3 = 0
    let lpL = 0
    let lpR = 0
    const peakTime = dur * 0.88
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const u = Math.min(1, t / peakTime)
      const curve = u * u * u
      const env =
        t <= peakTime
          ? Math.pow(u, 1.8)
          : Math.exp((-(t - peakTime) / Math.max(0.05, dur - peakTime)) * 9)

      const f1 = 55 + 390 * curve
      const f2 = f1 * 1.498 // Beşli aralık gerilimi
      const f3 = f1 * 2.02 // Hafif detune oktav
      phase1 += (2 * Math.PI * f1) / sampleRate
      phase2 += (2 * Math.PI * f2) / sampleRate
      phase3 += (2 * Math.PI * f3) / sampleRate

      const tonalL = Math.sin(phase1) * 0.45 + Math.sin(phase2) * 0.28 + Math.sin(phase3) * 0.18
      const tonalR =
        Math.sin(phase1 + 0.3) * 0.45 +
        Math.sin(phase2 - 0.4) * 0.28 +
        Math.sin(phase3 + 0.6) * 0.18

      const alpha = 0.04 + 0.55 * curve
      lpL = lpL * (1 - alpha) + rng() * alpha
      lpR = lpR * (1 - alpha) + rng() * alpha
      const tremble = 0.78 + 0.22 * Math.sin(2 * Math.PI * (4 + 14 * u) * t)

      mixL[i] = (tonalL * 0.65 + lpL * 0.6 * curve) * env * tremble * 0.88
      mixR[i] = (tonalR * 0.65 + lpR * 0.6 * curve) * env * tremble * 0.88
    }
  } else if (presetId === 'sub-drop') {
    // 2) Düşük Bas Darbesi / Sub Drop: Punchy darbe + 95Hz -> 28Hz derin LFE bas inişi
    let phase = 0
    let subPhase = 0
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const attack = Math.min(1, t / 0.012)
      const decay = Math.exp(-t * 1.15)
      const freq = 28 + 72 * Math.exp(-t * 2.4)
      phase += (2 * Math.PI * freq) / sampleRate
      subPhase += (2 * Math.PI * (freq * 0.5)) / sampleRate

      const punch = t < 0.09 ? rng() * Math.exp(-t * 55) * 0.38 : 0
      const body = Math.sin(phase) * 0.78 + Math.sin(subPhase) * 0.35 + Math.sin(phase * 2) * 0.14
      const val = Math.tanh((body + punch) * 1.35) * attack * decay * 0.92
      mixL[i] = val
      mixR[i] = val
    }
  } else if (presetId === 'film-projector') {
    // 3) Film Projektörü: 35mm 24fps mekanik deklanşör tıkırtısı + motor uğultusu
    const framePeriod = sampleRate / 24
    let lpL = 0
    let lpR = 0
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const edgeEnv = Math.min(1, t / 0.18) * Math.min(1, (dur - t) / 0.22)
      const hum =
        (Math.sin(2 * Math.PI * 58 * t) * 0.55 +
          Math.sin(2 * Math.PI * 116 * t) * 0.28 +
          Math.sin(2 * Math.PI * 174 * t) * 0.12) *
        0.18

      const phase = i % framePeriod
      const clickEnv =
        phase < sampleRate * 0.009 ? Math.exp((-phase / sampleRate) * 390) : 0
      const sprocketEnv =
        Math.abs(phase - framePeriod * 0.48) < sampleRate * 0.005
          ? Math.exp((-Math.abs(phase - framePeriod * 0.48) / sampleRate) * 520) * 0.45
          : 0

      lpL = lpL * 0.68 + rng() * 0.32
      lpR = lpR * 0.68 + rng() * 0.32

      const mechL = lpL * (clickEnv + sprocketEnv) * 0.75
      const mechR = lpR * (clickEnv + sprocketEnv) * 0.75
      mixL[i] = (hum + mechL) * edgeEnv * 0.85
      mixR[i] = (hum + mechR) * edgeEnv * 0.85
    }
  } else {
    // 4) Gece Yağmuru: Noir atmosferik sağanak + stereo su damlası tınıları
    let brownL = 0
    let brownR = 0
    let pinkL = 0
    let pinkR = 0
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const edgeEnv = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.4)
      const nL = rng()
      const nR = rng()
      brownL = (brownL + 0.025 * nL) / 1.025
      brownR = (brownR + 0.025 * nR) / 1.025
      pinkL = pinkL * 0.82 + nL * 0.18
      pinkR = pinkR * 0.82 + nR * 0.18

      // Yağmur damlası pıtırtıları
      const dropPulse = Math.sin(2 * Math.PI * 19 * t) * Math.sin(2 * Math.PI * 43 * t)
      const dropEnv = dropPulse > 0.86 ? (dropPulse - 0.86) * 4.5 : 0
      const dropL = nL * dropEnv * 0.35
      const dropR = nR * dropEnv * 0.35

      mixL[i] = (brownL * 1.4 + pinkL * 0.38 + dropL) * edgeEnv * 0.68
      mixR[i] = (brownR * 1.4 + pinkR * 0.38 + dropR) * edgeEnv * 0.68
    }
  }

  const { wav, peaks } = packStereoPcmWavAndPeaks(mixL, mixR, dur, sampleRate, 50)
  return { wav, peaks, duration: dur, label: meta.label }
}
