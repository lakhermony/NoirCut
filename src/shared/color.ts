/**
 * Renk düzenleme (Color Grading) veri modeli ve matematiği.
 * Hem WebGL önizleme (renderer) hem de FFmpeg export (main) tarafından kullanılır.
 */
import { BUILTIN_LUTS, sampleLut3D, type Lut3D } from './lut'
import {
  cloneNoirFilmConfig,
  evaluateFilmEmulationRgb,
  isNeutralNoirFilm,
  type NoirFilmConfig
} from './noirfilm'

export interface WheelValue {
  /** -1..1 renk tekerleği X kayması */
  x: number
  /** -1..1 renk tekerleği Y kayması */
  y: number
  /** -1..1 parlaklık (master luminance) kayması */
  l: number
}

export interface CurvePoint {
  x: number
  y: number
}

export type CurveChannelId = 'master' | 'red' | 'green' | 'blue'

export interface ColorCurves {
  master: CurvePoint[]
  red: CurvePoint[]
  green: CurvePoint[]
  blue: CurvePoint[]
}

/**
 * 6 Seçici Renk Bandı (Hue vs Sat & Hue vs Hue):
 * [0: Kırmızı (0°), 1: Turuncu/Cilt (30°), 2: Sarı (60°), 3: Yeşil (120°), 4: Camgöbeği (180°), 5: Mavi (240°)]
 */
export type HueBandArray = [number, number, number, number, number, number]

export const HUE_BAND_CENTERS: HueBandArray = [0, 30, 60, 120, 180, 240]
export const HUE_BAND_WIDTHS: HueBandArray = [38, 32, 42, 65, 65, 75]
export const HUE_BAND_META: Array<{ label: string; short: string; color: string; deg: number }> = [
  { label: 'Kırmızı (Red)', short: 'RED', color: '#EF4444', deg: 0 },
  { label: 'Cilt / Turuncu (Skin)', short: 'SKIN', color: '#F97316', deg: 30 },
  { label: 'Sarı (Yellow)', short: 'YLW', color: '#EAB308', deg: 60 },
  { label: 'Yeşil (Green)', short: 'GRN', color: '#22C55E', deg: 120 },
  { label: 'Camgöbeği (Cyan)', short: 'CYN', color: '#06B6D4', deg: 180 },
  { label: 'Mavi (Blue)', short: 'BLU', color: '#3B82F6', deg: 240 }
]

export type CameraProfileId = 'rec709' | 'f-log' | 'f-log2' | 's-log3' | 'd-log'

export const CAMERA_PROFILES: Array<{ id: CameraProfileId; label: string; glsl: number }> = [
  { id: 'rec709', label: 'Standart (Rec.709)', glsl: 0 },
  { id: 'f-log', label: 'Fujifilm F-Log', glsl: 1 },
  { id: 'f-log2', label: 'Fujifilm F-Log2', glsl: 2 },
  { id: 's-log3', label: 'Sony S-Log3', glsl: 3 },
  { id: 'd-log', label: 'DJI D-Log', glsl: 4 }
]

export function cameraProfileIndex(id?: CameraProfileId): number {
  return CAMERA_PROFILES.find((p) => p.id === id)?.glsl ?? 0
}

/** Log kodlu değeri (0..1) sahne-lineer ışığa çevirir. */
function logToLinear(profile: CameraProfileId, x: number): number {
  switch (profile) {
    case 'f-log':
      return x >= 0.100537775
        ? (Math.pow(10, (x - 0.790453) / 0.344676) - 0.009468) / 0.555556
        : (x - 0.092864) / 8.735631
    case 'f-log2':
      return x >= 0.100686685
        ? (Math.pow(10, (x - 0.384316) / 0.245281) - 0.064829) / 5.555556
        : (x - 0.092864) / 8.799461
    case 's-log3':
      return x >= 171.2102946929 / 1023
        ? Math.pow(10, (x * 1023 - 420) / 261.5) * 0.19 - 0.01
        : ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95)
    case 'd-log':
      return x > 0.14
        ? (Math.pow(10, 3.89616 * x - 2.27752) - 0.0929) / 0.9892
        : (x - 0.0929) / 6.025
    default:
      return x
  }
}

/** Kamera log profilini Rec.709 görüntü uzayına dönüştürür (Input CST). */
export function applyCameraProfile(
  profile: CameraProfileId | undefined,
  r: number,
  g: number,
  b: number
): [number, number, number] {
  if (!profile || profile === 'rec709') return [r, g, b]
  const oetf = (lin: number) => {
    const v = Math.max(0, Math.min(1, lin))
    return v < 0.018 ? 4.5 * v : 1.099 * Math.pow(v, 0.45) - 0.099
  }
  return [
    oetf(logToLinear(profile, r)),
    oetf(logToLinear(profile, g)),
    oetf(logToLinear(profile, b))
  ]
}

export interface ColorGrade {
  /** Kamera giriş profili (Log → Rec.709) */
  cameraProfile: CameraProfileId
  /** 0..100 Halation (sıcak kırmızı ışık halesi) */
  halation: number
  /** 0..100 Mist / Diffusion (sinematik pus) */
  mist: number
  lift: WheelValue
  gamma: WheelValue
  gain: WheelValue
  offset: WheelValue
  /** -2..+2 stop */
  exposure: number
  /** -100..+100 */
  contrast: number
  /** -100..+100 (parlak alan kurtarma / güçlendirme) */
  highlights: number
  /** -100..+100 (gölge detay açma / koyulaştırma) */
  shadows: number
  /** -100..+100 (soğuk <-> sıcak) */
  temperature: number
  /** -100..+100 (yeşil <-> macenta) */
  tint: number
  /** -100..+100 (cilt tonlarını koruyarak soluk renkleri canlandırma) */
  vibrance: number
  /** 0..200 (%) */
  saturation: number
  /** 0..100 (%) kenar karartma (Vignette) */
  vignette: number
  /** 0..100 (%) organik 35mm sinema greni (Film Grain) */
  filmGrain: number
  /** Özel RGB & Luma Eğrileri */
  curves: ColorCurves
  /** Hue vs Saturation (-100..+100, 6 bant) */
  hueVsSat: HueBandArray
  /** Hue vs Hue (-100..+100, 6 bant) */
  hueVsHue: HueBandArray
  /** Seçili dahili veya içe aktarılmış LUT id'si (yoksa null) */
  lutId: string | null
  /** 0..100 (%) */
  lutIntensity: number
  /** NoirFilm sinematik görünüm, film emülasyonu, gren ve ışık efektleri */
  noirFilm?: NoirFilmConfig
}

export const neutralWheel = (): WheelValue => ({ x: 0, y: 0, l: 0 })

export const defaultCurvePoints = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]

export const defaultColorCurves = (): ColorCurves => ({
  master: defaultCurvePoints(),
  red: defaultCurvePoints(),
  green: defaultCurvePoints(),
  blue: defaultCurvePoints()
})

export const defaultHueBands = (): HueBandArray => [0, 0, 0, 0, 0, 0]

export function defaultColorGrade(): ColorGrade {
  return {
    cameraProfile: 'rec709',
    halation: 0,
    mist: 0,
    lift: neutralWheel(),
    gamma: neutralWheel(),
    gain: neutralWheel(),
    offset: neutralWheel(),
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 100,
    vignette: 0,
    filmGrain: 0,
    curves: defaultColorCurves(),
    hueVsSat: defaultHueBands(),
    hueVsHue: defaultHueBands(),
    lutId: null,
    lutIntensity: 100
  }
}

export function cloneColorGrade(g?: ColorGrade): ColorGrade {
  if (!g) return defaultColorGrade()
  const base = defaultColorGrade()
  const clonePts = (pts?: CurvePoint[]) =>
    pts && pts.length >= 2 ? pts.map((p) => ({ x: p.x, y: p.y })) : defaultCurvePoints()
  return {
    ...base,
    ...g,
    lift: { ...(g.lift ?? base.lift) },
    gamma: { ...(g.gamma ?? base.gamma) },
    gain: { ...(g.gain ?? base.gain) },
    offset: { ...(g.offset ?? base.offset) },
    curves: {
      master: clonePts(g.curves?.master),
      red: clonePts(g.curves?.red),
      green: clonePts(g.curves?.green),
      blue: clonePts(g.curves?.blue)
    },
    hueVsSat: g.hueVsSat ? ([...g.hueVsSat] as HueBandArray) : defaultHueBands(),
    hueVsHue: g.hueVsHue ? ([...g.hueVsHue] as HueBandArray) : defaultHueBands(),
    noirFilm: g.noirFilm ? cloneNoirFilmConfig(g.noirFilm) : undefined
  }
}

export function isCurveChannelNeutral(pts?: CurvePoint[]): boolean {
  if (!pts || pts.length <= 2) {
    if (!pts || pts.length < 2) return true
    return (
      Math.abs(pts[0].x) < 1e-3 &&
      Math.abs(pts[0].y) < 1e-3 &&
      Math.abs(pts[pts.length - 1].x - 1) < 1e-3 &&
      Math.abs(pts[pts.length - 1].y - 1) < 1e-3
    )
  }
  return pts.every((p) => Math.abs(p.x - p.y) < 1e-3)
}

export function areCurvesNeutral(curves?: ColorCurves): boolean {
  if (!curves) return true
  return (
    isCurveChannelNeutral(curves.master) &&
    isCurveChannelNeutral(curves.red) &&
    isCurveChannelNeutral(curves.green) &&
    isCurveChannelNeutral(curves.blue)
  )
}

export function areHueBandsNeutral(arr?: HueBandArray): boolean {
  if (!arr) return true
  return arr.every((v) => Math.abs(v) < 1e-3)
}

export function isNeutralGrade(g?: ColorGrade): boolean {
  if (!g) return true
  const isZeroW = (w?: WheelValue) =>
    !w || (Math.abs(w.x) < 1e-4 && Math.abs(w.y) < 1e-4 && Math.abs(w.l) < 1e-4)
  return (
    (!g.cameraProfile || g.cameraProfile === 'rec709') &&
    Math.abs(g.halation ?? 0) < 1e-3 &&
    Math.abs(g.mist ?? 0) < 1e-3 &&
    isZeroW(g.lift) &&
    isZeroW(g.gamma) &&
    isZeroW(g.gain) &&
    isZeroW(g.offset) &&
    Math.abs(g.exposure) < 1e-4 &&
    Math.abs(g.contrast) < 1e-4 &&
    Math.abs(g.highlights ?? 0) < 1e-4 &&
    Math.abs(g.shadows ?? 0) < 1e-4 &&
    Math.abs(g.temperature) < 1e-4 &&
    Math.abs(g.tint) < 1e-4 &&
    Math.abs(g.vibrance ?? 0) < 1e-4 &&
    Math.abs(g.saturation - 100) < 1e-3 &&
    Math.abs(g.vignette ?? 0) < 1e-3 &&
    Math.abs(g.filmGrain ?? 0) < 1e-3 &&
    areCurvesNeutral(g.curves) &&
    areHueBandsNeutral(g.hueVsSat) &&
    areHueBandsNeutral(g.hueVsHue) &&
    (!g.lutId || g.lutIntensity <= 0.01) &&
    isNeutralNoirFilm(g.noirFilm)
  )
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const clampWb = (v: number): number => Math.max(-100, Math.min(100, Math.round(v)))

/**
 * Monoton Kübik Hermite (Fritsch-Carlson) spline ile 0..1 aralığında eğri değerlendirmesi.
 */
export function evaluateCurvePoints(points: CurvePoint[] | undefined, xIn: number): number {
  const x = clamp01(xIn)
  if (!points || points.length === 0) return x
  if (points.length === 1) return clamp01(points[0].y)

  const pts = [...points].sort((a, b) => a.x - b.x)
  const n = pts.length
  if (x <= pts[0].x) return clamp01(pts[0].y)
  if (x >= pts[n - 1].x) return clamp01(pts[n - 1].y)

  if (n === 2) {
    const dx = Math.max(1e-5, pts[1].x - pts[0].x)
    const t = (x - pts[0].x) / dx
    return clamp01(pts[0].y + t * (pts[1].y - pts[0].y))
  }

  // Sekant eğimleri
  const d: number[] = new Array(n - 1)
  const h: number[] = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(1e-5, pts[i + 1].x - pts[i].x)
    d[i] = (pts[i + 1].y - pts[i].y) / h[i]
  }

  // Teğetler
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0
    } else {
      m[i] = (d[i - 1] + d[i]) * 0.5
    }
  }

  // Hedef segmenti bul
  let seg = 0
  for (let i = 0; i < n - 1; i++) {
    if (x >= pts[i].x && x <= pts[i + 1].x) {
      seg = i
      break
    }
  }

  const hi = h[seg]
  const t = (x - pts[seg].x) / hi
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2

  return clamp01(h00 * pts[seg].y + h10 * hi * m[seg] + h01 * pts[seg + 1].y + h11 * hi * m[seg + 1])
}

/**
 * WebGL2 256x1 RGBA dokusu ve hızlı CPU örneklemesi için 256 elemanlı R, G, B, Master eğri tablosu üretir.
 */
export function buildCurveLut256(curves?: ColorCurves): Uint8Array {
  const out = new Uint8Array(256 * 4)
  const c = curves ?? defaultColorCurves()
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    const r = evaluateCurvePoints(c.red, x)
    const g = evaluateCurvePoints(c.green, x)
    const b = evaluateCurvePoints(c.blue, x)
    const m = evaluateCurvePoints(c.master, x)
    out[i * 4] = Math.round(r * 255)
    out[i * 4 + 1] = Math.round(g * 255)
    out[i * 4 + 2] = Math.round(b * 255)
    out[i * 4 + 3] = Math.round(m * 255)
  }
  return out
}

/**
 * RGB (0..1) -> HSV (hDeg: 0..360, s: 0..1, v: 0..1)
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const s = max <= 1e-5 ? 0 : d / max
  let h = 0
  if (d > 1e-5) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return [h % 360, s, max]
}

/**
 * HSV (hDeg: 0..360, s: 0..1, v: 0..1) -> RGB (0..1)
 */
export function hsvToRgb(hDeg: number, s: number, v: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 60
  const i = Math.floor(h)
  const f = h - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

/**
 * Seçici Renk Eğrileri (Hue vs Sat & Hue vs Hue) uygulaması.
 */
export function applySelectiveHueCurves(
  r: number,
  g: number,
  b: number,
  hueVsSat?: HueBandArray,
  hueVsHue?: HueBandArray
): [number, number, number] {
  const hsNeutral = areHueBandsNeutral(hueVsSat)
  const hhNeutral = areHueBandsNeutral(hueVsHue)
  if (hsNeutral && hhNeutral) return [r, g, b]

  const [hDeg, s, v] = rgbToHsv(r, g, b)
  if (s < 0.02 || v < 0.02) return [r, g, b]

  let satDelta = 0
  let hueDeltaDeg = 0

  for (let i = 0; i < 6; i++) {
    const center = HUE_BAND_CENTERS[i]
    const width = HUE_BAND_WIDTHS[i]
    let diff = Math.abs(hDeg - center)
    if (diff > 180) diff = 360 - diff
    if (diff >= width) continue
    // Yumuşak kosinüs çan eğrisi ağırlığı
    const t = diff / width
    const w = 0.5 * (1 + Math.cos(Math.PI * t))
    if (!hsNeutral && hueVsSat) {
      satDelta += w * (hueVsSat[i] / 100)
    }
    if (!hhNeutral && hueVsHue) {
      hueDeltaDeg += w * (hueVsHue[i] / 100) * 45
    }
  }

  const newH = (hDeg + hueDeltaDeg + 360) % 360
  const newS = clamp01(s * Math.max(0, 1 + satDelta))
  return hsvToRgb(newH, newS, v)
}

/**
 * ColorWheel (x, y, l) değerini RGB ofset vektörüne çevirir.
 * CSS conic-gradient(from 90deg, #ff4040, ...) ile aynı açı düzenini kullanır.
 */
export function wheelToRgbOffset(w: WheelValue, colorStrength: number, lumaStrength: number): [number, number, number] {
  const mag = Math.min(1, Math.hypot(w.x, w.y))
  let cr = 0
  let cg = 0
  let cb = 0
  if (mag > 1e-4) {
    const hue = ((Math.atan2(w.y, w.x) * 180) / Math.PI + 360) % 360
    const h = hue / 60
    const x = 1 - Math.abs((h % 2) - 1)
    let r1 = 0
    let g1 = 0
    let b1 = 0
    if (h < 1) [r1, g1, b1] = [1, x, 0]
    else if (h < 2) [r1, g1, b1] = [x, 1, 0]
    else if (h < 3) [r1, g1, b1] = [0, 1, x]
    else if (h < 4) [r1, g1, b1] = [0, x, 1]
    else if (h < 5) [r1, g1, b1] = [x, 0, 1]
    else [r1, g1, b1] = [1, 0, x]

    const mean = (r1 + g1 + b1) / 3
    cr = (r1 - mean) * mag * colorStrength
    cg = (g1 - mean) * mag * colorStrength
    cb = (b1 - mean) * mag * colorStrength
  }
  const lum = w.l * lumaStrength
  return [cr + lum, cg + lum, cb + lum]
}

/**
 * Tek bir referans pikselin (0..1 aralığında r,g,b) nötr gri/beyaz olması için
 * gereken Temperature (-100..+100) ve Tint (-100..+100) değerlerini hesaplar.
 */
export function computeWhiteBalanceFromRgb(
  rIn: number,
  gIn: number,
  bIn: number,
  exposure = 0
): { temperature: number; tint: number } {
  const exp = Math.pow(2, exposure)
  const r0 = clamp01(rIn * exp)
  const g0 = clamp01(gIn * exp)
  const b0 = clamp01(bIn * exp)

  const tempNorm = (b0 - r0) / 0.24
  const tintNorm = (g0 - 0.5 * (r0 + b0)) / 0.15

  return {
    temperature: clampWb(tempNorm * 100),
    tint: clampWb(tintNorm * 100)
  }
}

/**
 * Bir görüntü karesinin RGBA piksel dizisini (Uint8ClampedArray / Uint8Array)
 * Gray-World + Highlight-Neutral hibrit algoritmasıyla analiz ederek
 * otomatik Temperature (-100..+100) ve Tint (-100..+100) değerlerini hesaplar.
 */
export function computeAutoWhiteBalance(
  rgba: ArrayLike<number>,
  exposure = 0
): { temperature: number; tint: number } {
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumW = 0

  const len = rgba.length
  for (let i = 0; i + 3 < len; i += 4) {
    const a = rgba[i + 3]
    if (a < 32) continue

    const r = rgba[i] / 255
    const g = rgba[i + 1] / 255
    const b = rgba[i + 2] / 255

    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

    if (luma < 0.06 || maxC > 0.97) continue

    const chroma = maxC - minC
    if (chroma > 0.55) continue

    const neutralWeight = Math.pow(1 - chroma / 0.55, 2)
    const highlightWeight = 0.35 + 0.65 * Math.min(1, luma / 0.75)
    const w = neutralWeight * highlightWeight

    sumR += r * w
    sumG += g * w
    sumB += b * w
    sumW += w
  }

  if (sumW <= 1e-5) {
    return { temperature: 0, tint: 0 }
  }

  const avgR = sumR / sumW
  const avgG = sumG / sumW
  const avgB = sumB / sumW

  const raw = computeWhiteBalanceFromRgb(avgR, avgG, avgB, exposure)
  return {
    temperature: clampWb(raw.temperature * 0.85),
    tint: clampWb(raw.tint * 0.85)
  }
}

/** Tek bir RGB piksele tüm ColorGrade + Curves + HueVs + Offset + Vibrance + 3D LUT zincirini uygular (0..1 arası). */
export function evaluateColorGrade(
  rIn: number,
  gIn: number,
  bIn: number,
  grade: ColorGrade,
  lut: Lut3D | null
): [number, number, number] {
  let r = rIn
  let g = gIn
  let b = bIn

  // 0) Kamera Giriş Profili (Log → Rec.709)
  ;[r, g, b] = applyCameraProfile(grade.cameraProfile, r, g, b)

  // 1) Exposure
  if (Math.abs(grade.exposure) > 1e-4) {
    const exp = Math.pow(2, grade.exposure)
    r *= exp
    g *= exp
    b *= exp
  }

  // 2) Temperature & Tint
  const temp = grade.temperature / 100
  const tnt = grade.tint / 100
  r += temp * 0.12 + tnt * 0.05
  g -= tnt * 0.1
  b += -temp * 0.12 + tnt * 0.05

  // 3) Contrast
  const contrast = 1 + (grade.contrast / 100) * 0.65
  r = (r - 0.5) * contrast + 0.5
  g = (g - 0.5) * contrast + 0.5
  b = (b - 0.5) * contrast + 0.5

  // 3b) Shadows & Highlights
  const sh = (grade.shadows ?? 0) / 100
  const hi = (grade.highlights ?? 0) / 100
  if (Math.abs(sh) > 1e-4 || Math.abs(hi) > 1e-4) {
    const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const shadowMask = Math.pow(1 - l, 1.6)
    const highlightMask = Math.pow(l, 1.6)
    const delta = sh * 0.28 * shadowMask + hi * 0.28 * highlightMask
    r += delta
    g += delta
    b += delta
  }

  // 4) Lift (Gölgeler) / Gain (Parlaklar) / Gamma (Orta Tonlar) / Offset (Genel Kaydırma)
  const [lr, lg, lb] = wheelToRgbOffset(grade.lift, 0.55, 0.35)
  const [gr, gg, gb] = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
  const [hr, hg, hb] = wheelToRgbOffset(grade.gain, 0.75, 0.6)
  const [or, og, ob] = wheelToRgbOffset(grade.offset ?? neutralWheel(), 0.45, 0.35)

  r = clamp01(r)
  g = clamp01(g)
  b = clamp01(b)

  r = r + lr * (1 - r)
  g = g + lg * (1 - g)
  b = b + lb * (1 - b)

  r = clamp01(r * (1 + hr))
  g = clamp01(g * (1 + hg))
  b = clamp01(b * (1 + hb))

  r = Math.pow(clamp01(r), 1 / Math.max(0.2, 1 + gr))
  g = Math.pow(clamp01(g), 1 / Math.max(0.2, 1 + gg))
  b = Math.pow(clamp01(b), 1 / Math.max(0.2, 1 + gb))

  // 4b) Offset (Global Printer Lights / Genel Renk Kaydırma)
  r = clamp01(r + or)
  g = clamp01(g + og)
  b = clamp01(b + ob)

  // 4c) Özel RGB & Master Luma Eğrileri (Curves)
  if (grade.curves && !areCurvesNeutral(grade.curves)) {
    r = evaluateCurvePoints(grade.curves.red, r)
    g = evaluateCurvePoints(grade.curves.green, g)
    b = evaluateCurvePoints(grade.curves.blue, b)
    if (!isCurveChannelNeutral(grade.curves.master)) {
      r = evaluateCurvePoints(grade.curves.master, r)
      g = evaluateCurvePoints(grade.curves.master, g)
      b = evaluateCurvePoints(grade.curves.master, b)
    }
  }

  // 4d) Seçici Renk Eğrileri (Hue vs Sat & Hue vs Hue)
  if (!areHueBandsNeutral(grade.hueVsSat) || !areHueBandsNeutral(grade.hueVsHue)) {
    ;[r, g, b] = applySelectiveHueCurves(r, g, b, grade.hueVsSat, grade.hueVsHue)
  }

  // 5) Vibrance (Cilt Tonu Korumalı Canlılık) + Saturation
  const vib = (grade.vibrance ?? 0) / 100
  const sat = grade.saturation / 100
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

  let effectiveSat = sat
  if (Math.abs(vib) > 1e-4) {
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const chroma = maxC - minC
    // Cilt tonu (turuncu-kırmızı: r > g > b) koruma faktörü
    let skinProtect = 1.0
    if (vib > 0 && r > g && g > b && maxC > 0.08) {
      const [hDeg] = rgbToHsv(r, g, b)
      const dist = Math.abs(hDeg - 26)
      if (dist < 28) {
        skinProtect = 1.0 - 0.55 * (1.0 - dist / 28)
      }
    }
    const vibFactor = 1.0 + vib * (1.0 - chroma * chroma) * skinProtect
    effectiveSat *= Math.max(0, vibFactor)
  }

  r = clamp01(luma + (r - luma) * effectiveSat)
  g = clamp01(luma + (g - luma) * effectiveSat)
  b = clamp01(luma + (b - luma) * effectiveSat)

  // 6) 3D LUT + Intensity
  if (lut && grade.lutIntensity > 0) {
    const [lrOut, lgOut, lbOut] = sampleLut3D(lut, r, g, b)
    const amt = clamp01(grade.lutIntensity / 100)
    r = r + (lrOut - r) * amt
    g = g + (lgOut - g) * amt
    b = b + (lbOut - b) * amt
  }

  // 7) NoirFilm Dijital Film Emülasyonu
  if (grade.noirFilm?.filmEmulation?.enabled) {
    const nfAmt = clamp01((grade.noirFilm.lookIntensity ?? 100) / 100)
    ;[r, g, b] = evaluateFilmEmulationRgb(r, g, b, grade.noirFilm.filmEmulation, nfAmt)
  }

  return [clamp01(r), clamp01(g), clamp01(b)]
}

/**
 * FFmpeg lut3d filtresi için tüm ColorGrade + aktif LUT'u 33x33x33 .cube metnine dönüştürür.
 */
export function bakeColorGradeToCube(
  grade: ColorGrade,
  customLuts?: Record<string, Lut3D>,
  size = 33
): string {
  const lut = grade.lutId
    ? (customLuts?.[grade.lutId] ?? BUILTIN_LUTS.find((l) => l.id === grade.lutId) ?? null)
    : null

  const lines: string[] = [`TITLE "NoirCut Grade"`, `LUT_3D_SIZE ${size}`, '']
  const denom = size - 1
  for (let bi = 0; bi < size; bi++) {
    const b = bi / denom
    for (let gi = 0; gi < size; gi++) {
      const g = gi / denom
      for (let ri = 0; ri < size; ri++) {
        const r = ri / denom
        const [ro, go, bo] = evaluateColorGrade(r, g, b, grade, lut)
        lines.push(`${ro.toFixed(6)} ${go.toFixed(6)} ${bo.toFixed(6)}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * SVG <feComponentTransfer> + <feColorMatrix> için R/G/B tablo eğrilerini ve
 * LUT çapraz kanal matrisini hesaplar (WebGL2 yedeği ve sahne önizlemesi için).
 */
export function buildSvgGradeTables(
  grade: ColorGrade,
  lut: Lut3D | null,
  steps = 33
): {
  tableR: string
  tableG: string
  tableB: string
  saturation: number
  lutMatrix: string | null
} {
  const rVals: string[] = []
  const gVals: string[] = []
  const bVals: string[] = []

  const exp = Math.pow(2, grade.exposure)
  const temp = grade.temperature / 100
  const tnt = grade.tint / 100
  const contrast = 1 + (grade.contrast / 100) * 0.65
  const sh = (grade.shadows ?? 0) / 100
  const hi = (grade.highlights ?? 0) / 100
  const [lr, lg, lb] = wheelToRgbOffset(grade.lift, 0.55, 0.35)
  const [gr, gg, gb] = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
  const [hr, hg, hb] = wheelToRgbOffset(grade.gain, 0.75, 0.6)
  const [or, og, ob] = wheelToRgbOffset(grade.offset ?? neutralWheel(), 0.45, 0.35)
  const lutAmt = lut && grade.lutIntensity > 0 ? clamp01(grade.lutIntensity / 100) : 0

  const evalChannel = (
    vIn: number,
    tShift: number,
    liftC: number,
    gainC: number,
    gammaC: number,
    offsetC: number,
    curvePts?: CurvePoint[]
  ) => {
    let c = vIn * exp + tShift
    c = (c - 0.5) * contrast + 0.5
    c = clamp01(c)
    if (Math.abs(sh) > 1e-4 || Math.abs(hi) > 1e-4) {
      c = clamp01(c + sh * 0.28 * Math.pow(1 - c, 1.6) + hi * 0.28 * Math.pow(c, 1.6))
    }
    c = c + liftC * (1 - c)
    c = clamp01(c * (1 + gainC))
    c = Math.pow(clamp01(c), 1 / Math.max(0.2, 1 + gammaC))
    c = clamp01(c + offsetC)
    if (curvePts && !isCurveChannelNeutral(curvePts)) {
      c = evaluateCurvePoints(curvePts, c)
    }
    if (grade.curves?.master && !isCurveChannelNeutral(grade.curves.master)) {
      c = evaluateCurvePoints(grade.curves.master, c)
    }
    return clamp01(c)
  }

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    let r = evalChannel(t, temp * 0.12 + tnt * 0.05, lr, hr, gr, or, grade.curves?.red)
    let g = evalChannel(t, -tnt * 0.1, lg, hg, gg, og, grade.curves?.green)
    let b = evalChannel(t, -temp * 0.12 + tnt * 0.05, lb, hb, gb, ob, grade.curves?.blue)

    if (lut && lutAmt > 0) {
      const [ro] = sampleLut3D(lut, r, r, r)
      const [, go] = sampleLut3D(lut, g, g, g)
      const [, , bo] = sampleLut3D(lut, b, b, b)
      r = clamp01(r + (ro - r) * lutAmt)
      g = clamp01(g + (go - g) * lutAmt)
      b = clamp01(b + (bo - b) * lutAmt)
    }

    rVals.push(r.toFixed(4))
    gVals.push(g.toFixed(4))
    bVals.push(b.toFixed(4))
  }

  let lutMatrix: string | null = null
  if (lut && lutAmt > 0) {
    const [kR, kG, kB] = sampleLut3D(lut, 0, 0, 0)
    const [rR, rG, rB] = sampleLut3D(lut, 1, 0, 0)
    const [gR, gG, gB] = sampleLut3D(lut, 0, 1, 0)
    const [bR, bG, bB] = sampleLut3D(lut, 0, 0, 1)
    const mix = (id: number, target: number) => (id + (target - id) * lutAmt * 0.45).toFixed(4)
    lutMatrix = [
      mix(1, rR - kR), mix(0, gR - kR), mix(0, bR - kR), '0', (kR * lutAmt * 0.25).toFixed(4),
      mix(0, rG - kG), mix(1, gG - kG), mix(0, bG - kG), '0', (kG * lutAmt * 0.25).toFixed(4),
      mix(0, rB - kB), mix(0, gB - kB), mix(1, bB - kB), '0', (kB * lutAmt * 0.25).toFixed(4),
      '0', '0', '0', '1', '0'
    ].join(' ')
  }

  const vibBoost = 1 + ((grade.vibrance ?? 0) / 100) * 0.55
  return {
    tableR: rVals.join(' '),
    tableG: gVals.join(' '),
    tableB: bVals.join(' '),
    saturation: Math.max(0, (grade.saturation / 100) * vibBoost),
    lutMatrix
  }
}

export type GradePresetCategory =
  | 'Psikolojik Gerilim & Korku'
  | 'Neo-Noir & Gece Atmosferi'
  | '35mm Film Stokları'
  | 'Klasik & Stüdyo'

export const GRADE_PRESET_CATEGORIES: GradePresetCategory[] = [
  'Psikolojik Gerilim & Korku',
  'Neo-Noir & Gece Atmosferi',
  '35mm Film Stokları',
  'Klasik & Stüdyo'
]

export interface GradePreset {
  id: string
  name: string
  tag: string
  category: GradePresetCategory
  desc: string
  swatches: [string, string, string]
  patch: Partial<ColorGrade>
}

export const COLOR_GRADE_PRESETS: GradePreset[] = [
  // Psikolojik Gerilim & Korku
  {
    id: '70s-occult-warmth',
    name: '70s Occult Warmth',
    tag: '70s GERİLİM',
    category: 'Psikolojik Gerilim & Korku',
    desc: 'Sıcak kehribar alt tonlar, soluk gölgeler ve hafif kırmızı halation',
    swatches: ['#2b1a10', '#8c3d19', '#d97724'],
    patch: {
      lutId: '70s-occult-warmth',
      lutIntensity: 90,
      temperature: 14,
      tint: 4,
      contrast: 8,
      shadows: 10,
      highlights: -10,
      halation: 20,
      mist: 14,
      filmGrain: 20,
      vignette: 18
    }
  },
  {
    id: 'cold-morgue-cyan',
    name: 'Cold Morgue Cyan',
    tag: 'SOĞUK KORKU',
    category: 'Psikolojik Gerilim & Korku',
    desc: 'Doygunluğu alınmış çelik mavisi/camgöbeği gölgeler, steril yüksek ışıklar',
    swatches: ['#0b1f29', '#315d72', '#99d5e8'],
    patch: {
      lutId: 'cold-morgue-cyan',
      lutIntensity: 92,
      temperature: -20,
      tint: -6,
      contrast: 16,
      highlights: 8,
      shadows: -8,
      saturation: 72,
      vignette: 22
    }
  },
  {
    id: 'dread-desat',
    name: 'Dread Desat',
    tag: 'DESAT GERİLİM',
    category: 'Psikolojik Gerilim & Korku',
    desc: 'Yüksek kontrastlı, %60 doygunluğu çekilmiş ezilmiş derin siyahlar ve soluk ten',
    swatches: ['#090a0d', '#3e434a', '#9aa0a6'],
    patch: {
      lutId: 'dread-desat',
      lutIntensity: 92,
      contrast: 28,
      shadows: -24,
      highlights: -6,
      saturation: 40,
      vibrance: -15,
      filmGrain: 16,
      vignette: 30
    }
  },
  // Neo-Noir & Gece Atmosferi
  {
    id: 'sodium-vapor-street',
    name: 'Sodium Vapor Street',
    tag: 'GECE SOKAK',
    category: 'Neo-Noir & Gece Atmosferi',
    desc: 'Gece sokak lambası kehribar/yeşilimsi sarı kırılımı ve koyu gölgeler',
    swatches: ['#141913', '#657224', '#eab308'],
    patch: {
      lutId: 'sodium-vapor-street',
      lutIntensity: 90,
      temperature: 16,
      tint: -12,
      contrast: 18,
      shadows: -16,
      halation: 28,
      mist: 16,
      vignette: 24
    }
  },
  {
    id: 'rainy-neon-noir',
    name: 'Rainy Neon Noir',
    tag: 'NEON NOİR',
    category: 'Neo-Noir & Gece Atmosferi',
    desc: 'Derin mavi/mor gölgeler, parlak magenta/siyan vurgu tonları',
    swatches: ['#110c2e', '#0891b2', '#ec4899'],
    patch: {
      lutId: 'rainy-neon-noir',
      lutIntensity: 90,
      contrast: 20,
      vibrance: 26,
      halation: 34,
      mist: 22,
      vignette: 26
    }
  },
  {
    id: 'silver-nitrate-bw',
    name: 'Silver Nitrate B&W',
    tag: 'S&B 35MM',
    category: 'Neo-Noir & Gece Atmosferi',
    desc: 'Gümüş nitrat yüksek kontrastlı, zengin orta tonlu 35mm siyah-beyaz',
    swatches: ['#070709', '#52525b', '#d4d4d8'],
    patch: {
      lutId: 'silver-nitrate-bw',
      lutIntensity: 95,
      contrast: 26,
      shadows: -10,
      highlights: 12,
      saturation: 0,
      filmGrain: 26,
      vignette: 24
    }
  },
  // 35mm Film Stokları (Analog Emülasyon)
  {
    id: 'kodak-2383-print',
    name: 'Kodak 2383 Print',
    tag: 'KODAK 2383',
    category: '35mm Film Stokları',
    desc: 'Zengin sinema baskı kontrastı, sıcak cilt tonları ve yoğun gölge doygunluğu',
    swatches: ['#1d1512', '#9b4a26', '#e8b97e'],
    patch: {
      lutId: 'kodak-2383',
      lutIntensity: 90,
      contrast: 16,
      temperature: 6,
      shadows: -8,
      vibrance: 14,
      saturation: 108,
      filmGrain: 16,
      vignette: 18
    }
  },
  {
    id: 'cinestill-800t',
    name: 'CineStill 800T',
    tag: '800T HALE',
    category: '35mm Film Stokları',
    desc: 'Tungsten dengeli gece filmi, parlak noktalarda belirgin kırmızı halation',
    swatches: ['#0b1b2c', '#4b4052', '#ff5b3b'],
    patch: {
      lutId: 'cinestill-800t',
      lutIntensity: 90,
      temperature: -14,
      contrast: 12,
      halation: 68,
      mist: 14,
      filmGrain: 22,
      vignette: 16
    }
  },
  {
    id: 'fuji-eterna-soft',
    name: 'Fuji Eterna Soft',
    tag: 'ETERNA',
    category: '35mm Film Stokları',
    desc: 'Yumuşak kontrast, pastel yeşiller ve doğal sinematik geçişler',
    swatches: ['#1d2925', '#5d8a75', '#b9d8c2'],
    patch: {
      lutId: 'fuji-eterna-soft',
      lutIntensity: 88,
      contrast: -10,
      highlights: -14,
      shadows: 14,
      saturation: 92,
      vibrance: 10,
      mist: 14,
      filmGrain: 12
    }
  },
  {
    id: 'sepia-archive-1920',
    name: 'Sepia Archive 1920',
    tag: 'ARŞİV 1920',
    category: '35mm Film Stokları',
    desc: 'Eskitilmiş arşiv filmi tonu, ince gren ve yumuşak vignette',
    swatches: ['#261b12', '#825d3b', '#d6b48a'],
    patch: {
      lutId: 'sepia-archive-1920',
      lutIntensity: 92,
      temperature: 22,
      contrast: 10,
      shadows: 12,
      highlights: -10,
      filmGrain: 36,
      vignette: 42
    }
  },
  // Mevcut Klasik & Stüdyo Şablonları
  {
    id: 'noir-detective',
    name: 'Noir Dedektif',
    tag: 'S&B NOIR',
    category: 'Klasik & Stüdyo',
    desc: 'Yüksek kontrastlı siyah-beyaz, 35mm gren ve koyu vinyet',
    swatches: ['#09090b', '#52525b', '#e4e4e7'],
    patch: {
      lutId: 'noir-bw',
      lutIntensity: 95,
      contrast: 22,
      shadows: -18,
      highlights: 10,
      filmGrain: 28,
      vignette: 36,
      halation: 0,
      mist: 8
    }
  },
  {
    id: 'kodak-cinema',
    name: '35mm Kodak 2383',
    tag: '35MM',
    category: 'Klasik & Stüdyo',
    desc: 'Zengin sinema kırmızısı, sıcak halation ve hafif gren',
    swatches: ['#1c1411', '#9a4f2b', '#e8b97e'],
    patch: {
      lutId: 'kodak-2383',
      lutIntensity: 85,
      contrast: 12,
      temperature: 6,
      vibrance: 14,
      saturation: 106,
      halation: 24,
      mist: 10,
      filmGrain: 18,
      vignette: 18
    }
  },
  {
    id: 'golden-sunset',
    name: 'Altın Günbatımı',
    tag: 'SICAK',
    category: 'Klasik & Stüdyo',
    desc: 'Kehribar vurgular, yumuşak pus ve romantik ışık sızması',
    swatches: ['#3b1d0e', '#d97706', '#fde68a'],
    patch: {
      lutId: 'golden-hour',
      lutIntensity: 80,
      temperature: 22,
      tint: 6,
      highlights: -10,
      shadows: 12,
      vibrance: 20,
      halation: 26,
      mist: 28,
      vignette: 14
    }
  },
  {
    id: 'nordic-cold',
    name: 'Kuzey Gerilimi',
    tag: 'SOĞUK',
    category: 'Klasik & Stüdyo',
    desc: 'Desatüre çelik mavisi gölgeler ve sert kuzey atmosferi',
    swatches: ['#0c1520', '#475569', '#94a3b8'],
    patch: {
      lutId: 'nordic-thriller',
      lutIntensity: 90,
      temperature: -18,
      contrast: 18,
      shadows: -12,
      saturation: 84,
      filmGrain: 14,
      vignette: 26
    }
  },
  {
    id: 'neon-rain',
    name: 'Gece Neon & Yağmur',
    tag: 'GECE',
    category: 'Klasik & Stüdyo',
    desc: 'Mor-camgöbeği gece ışıkları, güçlü halation ve difüzyon',
    swatches: ['#150d2e', '#0891b2', '#e879f9'],
    patch: {
      lutId: 'cyber-neon',
      lutIntensity: 85,
      temperature: -10,
      tint: 10,
      contrast: 16,
      vibrance: 28,
      halation: 38,
      mist: 24,
      vignette: 30
    }
  },
  {
    id: 'teal-blockbuster',
    name: 'Gişe Sineması',
    tag: 'SİNEMA',
    category: 'Klasik & Stüdyo',
    desc: 'Camgöbeği gölgeler ve canlı sıcak ten dengesi',
    swatches: ['#0a2e38', '#0284c7', '#f59e0b'],
    patch: {
      lutId: 'teal-orange',
      lutIntensity: 78,
      contrast: 14,
      vibrance: 18,
      highlights: -8,
      shadows: 8,
      halation: 14,
      vignette: 20
    }
  },
  {
    id: 'bleach-action',
    name: 'Gümüş Nitrat (Bleach)',
    tag: 'SERT',
    category: 'Klasik & Stüdyo',
    desc: 'Metalik yüksek kontrast, düşük renk doygunluğu ve gren',
    swatches: ['#14161a', '#525866', '#d1d5db'],
    patch: {
      lutId: 'bleach-bypass',
      lutIntensity: 88,
      contrast: 24,
      shadows: -14,
      saturation: 78,
      filmGrain: 30,
      vignette: 24
    }
  },
  {
    id: 'dreamy-mist',
    name: 'Rüya & Yumuşak Pus',
    tag: 'ATMOSFER',
    category: 'Klasik & Stüdyo',
    desc: 'Yumuşatılmış dijital keskinlik ve parlayan ışık kaynakları',
    swatches: ['#2b2228', '#a88995', '#f5e1d8'],
    patch: {
      lutId: 'vintage-film',
      lutIntensity: 55,
      contrast: -8,
      shadows: 18,
      temperature: 8,
      saturation: 92,
      mist: 46,
      halation: 20,
      filmGrain: 12
    }
  }
]

/** Mevcut kamera giriş profilini koruyarak şablon renk ayarlarını uygular. */
export function applyGradePreset(
  preset: GradePreset,
  preserveCameraProfile?: CameraProfileId
): ColorGrade {
  const base = defaultColorGrade()
  return {
    ...base,
    ...preset.patch,
    cameraProfile: preserveCameraProfile ?? base.cameraProfile
  }
}
