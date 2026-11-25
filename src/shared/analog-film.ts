/**
 * Analog Film Pass — WebGL2 önizleme ve FFmpeg export'un ortak paylaştığı saf matematik.
 *  - Physical Halation: eşik üstü parlak bölge → ayrılabilir Gauss blur → kırmızı-turuncu tint → screen birleştirme
 *  - Luminance-Aware Film Grain: gölge/orta tonlarda güçlü, parlak alanlarda zayıflayan animasyonlu gren
 */

export interface AnalogFilmConfig {
  enabled: boolean
  /** 0..100 — halation için parlaklık eşiği (%) */
  halationThreshold: number
  /** 0..100 — halation yoğunluğu */
  halationIntensity: number
  /** 0..100 — halation blur yarıçapı */
  halationRadius: number
  /** 0..100 — gren miktarı */
  grainAmount: number
  /** 0..100 — gren tane boyutu */
  grainSize: number
  /** 0..100 — gren pürüzlülüğü (0 = yumuşak, 100 = sert) */
  grainRoughness: number
}

export const defaultAnalogFilm = (): AnalogFilmConfig => ({
  enabled: false,
  halationThreshold: 70,
  halationIntensity: 45,
  halationRadius: 40,
  grainAmount: 30,
  grainSize: 35,
  grainRoughness: 50
})

export const cloneAnalogFilm = (a?: AnalogFilmConfig): AnalogFilmConfig => ({
  ...defaultAnalogFilm(),
  ...(a ?? {})
})

export const isAnalogHalationActive = (a?: AnalogFilmConfig): boolean =>
  Boolean(a?.enabled && a.halationIntensity > 0.5)

export const isAnalogGrainActive = (a?: AnalogFilmConfig): boolean =>
  Boolean(a?.enabled && a.grainAmount > 0.5)

export const isAnalogFilmActive = (a?: AnalogFilmConfig): boolean =>
  isAnalogHalationActive(a) || isAnalogGrainActive(a)

/** Halation tint rengi (kırmızı-turuncu). */
export const HALATION_TINT: [number, number, number] = [1.0, 0.24, 0.06]
/** Blur edilmiş parlak katman kazancı (screen öncesi). */
export const HALATION_GAIN = 2.0

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function analogHalationParams(a: AnalogFilmConfig): {
  /** 0..1 eşik (kanal bazlı: max(c - T, 0) / (1 - T)) */
  threshold: number
  /** screen opaklığı = intensity */
  opacity: number
  /** blur sigması (kare yüksekliğinin oranı) */
  sigmaFrac: number
} {
  return {
    threshold: clamp(a.halationThreshold / 100, 0.05, 0.98),
    opacity: clamp(a.halationIntensity / 100, 0, 1),
    sigmaFrac: 0.004 + 0.03 * clamp(a.halationRadius / 100, 0, 1)
  }
}

export function analogGrainParams(a: AnalogFilmConfig): {
  /** ±genlik (0..1 piksel aralığında) */
  amplitude: number
  /** 1080 satırlık karede gren hücre boyutu (px) */
  cellPx1080: number
  /** 0..1 pürüzlülük */
  roughness: number
} {
  return {
    amplitude: clamp(a.grainAmount / 100, 0, 1) * 0.22,
    cellPx1080: 1 + 3 * clamp(a.grainSize / 100, 0, 1),
    roughness: clamp(a.grainRoughness / 100, 0, 1)
  }
}

/** Parlaklığa duyarlı gren ağırlığı: L=0 → 1.0, L=1 → 0.08 (gölge/orta ton güçlü, highlight zayıf). */
export const grainToneWeight = (luma01: number): number => {
  const L = clamp(luma01, 0, 1)
  return Math.max(0.08, 1 - 0.92 * L * L)
}
