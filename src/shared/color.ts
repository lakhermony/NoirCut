/**
 * Renk düzenleme (Color Grading) veri modeli ve matematiği.
 * Hem WebGL önizleme (renderer) hem de FFmpeg export (main) tarafından kullanılır.
 */
import { BUILTIN_LUTS, sampleLut3D, type Lut3D } from './lut'

export interface WheelValue {
  /** -1..1 renk tekerleği X kayması */
  x: number
  /** -1..1 renk tekerleği Y kayması */
  y: number
  /** -1..1 parlaklık (master luminance) kayması */
  l: number
}

export interface ColorGrade {
  lift: WheelValue
  gamma: WheelValue
  gain: WheelValue
  /** -2..+2 stop */
  exposure: number
  /** -100..+100 */
  contrast: number
  /** -100..+100 (soğuk <-> sıcak) */
  temperature: number
  /** -100..+100 (yeşil <-> macenta) */
  tint: number
  /** 0..200 (%) */
  saturation: number
  /** Seçili dahili veya içe aktarılmış LUT id'si (yoksa null) */
  lutId: string | null
  /** 0..100 (%) */
  lutIntensity: number
}

export const neutralWheel = (): WheelValue => ({ x: 0, y: 0, l: 0 })

export function defaultColorGrade(): ColorGrade {
  return {
    lift: neutralWheel(),
    gamma: neutralWheel(),
    gain: neutralWheel(),
    exposure: 0,
    contrast: 0,
    temperature: 0,
    tint: 0,
    saturation: 100,
    lutId: null,
    lutIntensity: 100
  }
}

export function cloneColorGrade(g?: ColorGrade): ColorGrade {
  if (!g) return defaultColorGrade()
  return {
    ...g,
    lift: { ...g.lift },
    gamma: { ...g.gamma },
    gain: { ...g.gain }
  }
}

export function isNeutralGrade(g?: ColorGrade): boolean {
  if (!g) return true
  const isZeroW = (w: WheelValue) =>
    Math.abs(w.x) < 1e-4 && Math.abs(w.y) < 1e-4 && Math.abs(w.l) < 1e-4
  return (
    isZeroW(g.lift) &&
    isZeroW(g.gamma) &&
    isZeroW(g.gain) &&
    Math.abs(g.exposure) < 1e-4 &&
    Math.abs(g.contrast) < 1e-4 &&
    Math.abs(g.temperature) < 1e-4 &&
    Math.abs(g.tint) < 1e-4 &&
    Math.abs(g.saturation - 100) < 1e-3 &&
    (!g.lutId || g.lutIntensity <= 0.01)
  )
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
    // 0 rad = sağ (3 yönü = kırmızı), saat yönünde +90° = sarı/yeşil
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

    // Ortalama parlaklığı nötrle (0 toplamlı renk kayması)
    const mean = (r1 + g1 + b1) / 3
    cr = (r1 - mean) * mag * colorStrength
    cg = (g1 - mean) * mag * colorStrength
    cb = (b1 - mean) * mag * colorStrength
  }
  const lum = w.l * lumaStrength
  return [cr + lum, cg + lum, cb + lum]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Tek bir RGB piksele tüm ColorGrade + 3D LUT zincirini uygular (0..1 arası). */
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

  // 4) Lift (Gölgeler) / Gain (Parlaklar) / Gamma (Orta Tonlar)
  const [lr, lg, lb] = wheelToRgbOffset(grade.lift, 0.55, 0.35)
  const [gr, gg, gb] = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
  const [hr, hg, hb] = wheelToRgbOffset(grade.gain, 0.75, 0.6)

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

  // 5) Saturation
  const sat = grade.saturation / 100
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  r = clamp01(luma + (r - luma) * sat)
  g = clamp01(luma + (g - luma) * sat)
  b = clamp01(luma + (b - luma) * sat)

  // 6) 3D LUT + Intensity
  if (lut && grade.lutIntensity > 0) {
    const [lrOut, lgOut, lbOut] = sampleLut3D(lut, r, g, b)
    const amt = clamp01(grade.lutIntensity / 100)
    r = r + (lrOut - r) * amt
    g = g + (lgOut - g) * amt
    b = b + (lbOut - b) * amt
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
  const [lr, lg, lb] = wheelToRgbOffset(grade.lift, 0.55, 0.35)
  const [gr, gg, gb] = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
  const [hr, hg, hb] = wheelToRgbOffset(grade.gain, 0.75, 0.6)
  const lutAmt = lut && grade.lutIntensity > 0 ? clamp01(grade.lutIntensity / 100) : 0

  const evalChannel = (vIn: number, tShift: number, liftC: number, gainC: number, gammaC: number) => {
    let c = vIn * exp + tShift
    c = (c - 0.5) * contrast + 0.5
    c = clamp01(c)
    c = c + liftC * (1 - c)
    c = clamp01(c * (1 + gainC))
    c = Math.pow(clamp01(c), 1 / Math.max(0.2, 1 + gammaC))
    return clamp01(c)
  }

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    let r = evalChannel(t, temp * 0.12 + tnt * 0.05, lr, hr, gr)
    let g = evalChannel(t, -tnt * 0.1, lg, hg, gg)
    let b = evalChannel(t, -temp * 0.12 + tnt * 0.05, lb, hb, gb)

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
    // 3D LUT'un çapraz kanal renk karakterini yakalayan doğrusal matris düzeltmesi
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

  return {
    tableR: rVals.join(' '),
    tableG: gVals.join(' '),
    tableB: bVals.join(' '),
    saturation: Math.max(0, grade.saturation / 100),
    lutMatrix
  }
}
