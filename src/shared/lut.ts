/**
 * 3D LUT (.cube) ayrıştırıcı, trilineer enterpolasyon ve dahili sinematik görünümler.
 * Hem Renderer (WebGL) hem de Main (FFmpeg export) tarafından kullanılır.
 */

export interface Lut3D {
  id: string
  name: string
  size: number
  /** Düz RGB dizisi: [r, g, b, ...], uzunluk = size^3 * 3, değerler 0..1 */
  data: number[]
  isBuiltIn?: boolean
  previewColors?: [string, string]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Standart .cube 3D LUT dosyasını ayrıştırır.
 * R en hızlı, ardından G, ardından B ekseni artar.
 */
export function parseCubeLut(content: string, id: string, name: string): Lut3D {
  const lines = content.split(/\r?\n/)
  let size = 0
  let title = name
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const data: number[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('TITLE')) {
      const m = line.match(/TITLE\s+"?([^"]+)"?/)
      if (m?.[1]) title = m[1].trim()
      continue
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      const n = parseInt(line.split(/\s+/)[1] ?? '', 10)
      if (!Number.isFinite(n) || n < 2 || n > 128) {
        throw new Error('Geçersiz LUT_3D_SIZE değeri.')
      }
      size = n
      continue
    }
    if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUT dosyaları desteklenmiyor, lütfen 3D .cube LUT kullanın.')
    }
    if (line.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/).slice(1).map(Number)
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        domainMin = [parts[0], parts[1], parts[2]]
      }
      continue
    }
    if (line.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/).slice(1).map(Number)
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        domainMax = [parts[0], parts[1], parts[2]]
      }
      continue
    }
    if (/^[A-Z_]+/.test(line)) {
      // Diğer başlık anahtar kelimelerini (ör. LUT_3D_INPUT_RANGE) atla
      continue
    }

    const parts = line.split(/\s+/)
    if (parts.length >= 3) {
      const r = Number(parts[0])
      const g = Number(parts[1])
      const b = Number(parts[2])
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        const dr = domainMax[0] - domainMin[0] || 1
        const dg = domainMax[1] - domainMin[1] || 1
        const db = domainMax[2] - domainMin[2] || 1
        data.push(
          clamp01((r - domainMin[0]) / dr),
          clamp01((g - domainMin[1]) / dg),
          clamp01((b - domainMin[2]) / db)
        )
      }
    }
  }

  if (size === 0) {
    throw new Error('Dosyada LUT_3D_SIZE tanımı bulunamadı.')
  }
  const expected = size * size * size * 3
  if (data.length < expected) {
    throw new Error(`Eksik LUT verisi: ${data.length / 3} / ${size * size * size} satır.`)
  }

  return {
    id,
    name: title,
    size,
    data: data.slice(0, expected),
    isBuiltIn: false,
    previewColors: ['#3b4252', '#f5a623']
  }
}

/** Trilineer enterpolasyon ile 3D LUT örneklemesi */
export function sampleLut3D(
  lut: Lut3D,
  rIn: number,
  gIn: number,
  bIn: number
): [number, number, number] {
  const n = lut.size
  const maxIdx = n - 1
  const r = clamp01(rIn) * maxIdx
  const g = clamp01(gIn) * maxIdx
  const b = clamp01(bIn) * maxIdx

  const r0 = Math.floor(r)
  const g0 = Math.floor(g)
  const b0 = Math.floor(b)
  const r1 = Math.min(maxIdx, r0 + 1)
  const g1 = Math.min(maxIdx, g0 + 1)
  const b1 = Math.min(maxIdx, b0 + 1)

  const fr = r - r0
  const fg = g - g0
  const fb = b - b0

  const idx = (ri: number, gi: number, bi: number) => (bi * n * n + gi * n + ri) * 3
  const d = lut.data

  const lerp = (a: number, bVal: number, t: number) => a + (bVal - a) * t

  const out: [number, number, number] = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const c000 = d[idx(r0, g0, b0) + ch]
    const c100 = d[idx(r1, g0, b0) + ch]
    const c010 = d[idx(r0, g1, b0) + ch]
    const c110 = d[idx(r1, g1, b0) + ch]
    const c001 = d[idx(r0, g0, b1) + ch]
    const c101 = d[idx(r1, g0, b1) + ch]
    const c011 = d[idx(r0, g1, b1) + ch]
    const c111 = d[idx(r1, g1, b1) + ch]

    const c00 = lerp(c000, c100, fr)
    const c10 = lerp(c010, c110, fr)
    const c01 = lerp(c001, c101, fr)
    const c11 = lerp(c011, c111, fr)

    const c0 = lerp(c00, c10, fg)
    const c1 = lerp(c01, c11, fg)

    out[ch] = lerp(c0, c1, fb)
  }
  return out
}

/** Analitik renk dönüşüm fonksiyonundan 17x17x17 dahili 3D LUT üretir */
function buildBuiltInLut(
  id: string,
  name: string,
  previewColors: [string, string],
  fn: (r: number, g: number, b: number) => [number, number, number]
): Lut3D {
  const size = 17
  const data: number[] = []
  for (let bi = 0; bi < size; bi++) {
    const b = bi / (size - 1)
    for (let gi = 0; gi < size; gi++) {
      const g = gi / (size - 1)
      for (let ri = 0; ri < size; ri++) {
        const r = ri / (size - 1)
        const [ro, go, bo] = fn(r, g, b)
        data.push(clamp01(ro), clamp01(go), clamp01(bo))
      }
    }
  }
  return { id, name, size, data, isBuiltIn: true, previewColors }
}

const sCurve = (x: number, strength: number): number => {
  const c = clamp01(x)
  const s = c * c * (3 - 2 * c)
  return c + (s - c) * strength
}

export const BUILTIN_LUTS: Lut3D[] = [
  buildBuiltInLut('noir-bw', 'Noir High-Contrast B&W', ['#0c0c0e', '#e5e5e5'], (r, g, b) => {
    const luma = 0.25 * r + 0.62 * g + 0.13 * b
    const c = sCurve(luma, 0.78)
    const crisp = clamp01((c - 0.5) * 1.18 + 0.5)
    return [crisp, crisp, crisp]
  }),
  buildBuiltInLut('tungsten-night', 'Tungsten Night', ['#0f2035', '#f5a623'], (r, g, b) => {
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const shadowW = Math.pow(1 - luma, 1.5)
    const highW = Math.pow(luma, 1.2)
    const ro = sCurve(r, 0.35) + highW * 0.12 - shadowW * 0.06
    const go = sCurve(g, 0.35) + highW * 0.04 - shadowW * 0.02
    const bo = sCurve(b, 0.35) - highW * 0.12 + shadowW * 0.11
    return [ro, go, bo]
  }),
  buildBuiltInLut('teal-orange', 'Teal & Orange', ['#0d4a5a', '#f08a2b'], (r, g, b) => {
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const shadowW = 1 - luma
    const highW = luma
    const ro = sCurve(r, 0.3) + highW * 0.14 - shadowW * 0.10
    const go = sCurve(g, 0.25) + highW * 0.02 + shadowW * 0.02
    const bo = sCurve(b, 0.3) - highW * 0.13 + shadowW * 0.14
    return [ro, go, bo]
  }),
  buildBuiltInLut('vintage-film', 'Vintage Film', ['#2c221b', '#dfc29d'], (r, g, b) => {
    const lift = 0.055
    const ro = lift + r * 0.92 + 0.03 * g
    const go = lift * 0.9 + g * 0.88 + 0.02 * r
    const bo = lift * 1.15 + b * 0.80
    return [sCurve(ro, 0.2), sCurve(go, 0.2), sCurve(bo, 0.15)]
  }),
  buildBuiltInLut('bleach-bypass', 'Bleach Bypass', ['#1e2229', '#b9bcc2'], (r, g, b) => {
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const mixL = 0.55
    const ro = sCurve(r * (1 - mixL) + luma * mixL, 0.65)
    const go = sCurve(g * (1 - mixL) + luma * mixL, 0.65)
    const bo = sCurve(b * (1 - mixL) + luma * mixL, 0.65)
    return [ro, go, bo]
  })
]
