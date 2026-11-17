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
  previewGradient?: string
  category?: string
  desc?: string
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
  category: string,
  desc: string,
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
  return { id, name, size, data, isBuiltIn: true, previewColors, category, desc }
}

const sCurve = (x: number, strength: number): number => {
  const c = clamp01(x)
  const s = c * c * (3 - 2 * c)
  return c + (s - c) * strength
}

export const BUILTIN_LUTS: Lut3D[] = [
  buildBuiltInLut(
    'noir-bw',
    'Noir High-Contrast B&W',
    ['#0c0c0e', '#e5e5e5'],
    'NOIR',
    'Sert siyah-beyaz dedektif kontrastı',
    (r, g, b) => {
      const luma = 0.25 * r + 0.62 * g + 0.13 * b
      const c = sCurve(luma, 0.78)
      const crisp = clamp01((c - 0.5) * 1.18 + 0.5)
      return [crisp, crisp, crisp]
    }
  ),
  buildBuiltInLut(
    'tungsten-night',
    'Tungsten Night',
    ['#0f2035', '#f5a623'],
    'GECE',
    'Soğuk mavi gölgeler, sıcak sokak lambası vurguları',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.5)
      const highW = Math.pow(luma, 1.2)
      const ro = sCurve(r, 0.35) + highW * 0.12 - shadowW * 0.06
      const go = sCurve(g, 0.35) + highW * 0.04 - shadowW * 0.02
      const bo = sCurve(b, 0.35) - highW * 0.12 + shadowW * 0.11
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'teal-orange',
    'Teal & Orange',
    ['#0d4a5a', '#f08a2b'],
    'SİNEMA',
    'Gişe sineması: camgöbeği gölge ve sıcak ten tonları',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = 1 - luma
      const highW = luma
      const ro = sCurve(r, 0.3) + highW * 0.14 - shadowW * 0.10
      const go = sCurve(g, 0.25) + highW * 0.02 + shadowW * 0.02
      const bo = sCurve(b, 0.3) - highW * 0.13 + shadowW * 0.14
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'kodak-2383',
    'Kodak 2383 Print',
    ['#1d1512', '#e8b97e'],
    '35mm Film Stokları',
    'Zengin sinema baskı kontrastı, sıcak cilt tonları ve yoğun gölge doygunluğu',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.8)
      const highW = Math.pow(luma, 1.4)
      const ro = sCurve(r * 1.04 - 0.015, 0.45) + highW * 0.06 - shadowW * 0.02
      const go = sCurve(g * 0.99, 0.42) + highW * 0.03
      const bo = sCurve(b * 0.94, 0.48) - highW * 0.08 + shadowW * 0.05
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'golden-hour',
    'Golden Hour',
    ['#4a2511', '#f6b95c'],
    'SICAK',
    'Altın saat: kehribar orta tonlar ve bal rengi vurgular',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const midW = 1 - Math.abs(luma - 0.5) * 1.8
      const ro = sCurve(r, 0.25) + Math.max(0, midW) * 0.11 + luma * 0.06
      const go = sCurve(g, 0.22) + Math.max(0, midW) * 0.05
      const bo = sCurve(b * 0.88, 0.2) - luma * 0.09
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'nordic-thriller',
    'Nordic Thriller',
    ['#101a24', '#8fb1c9'],
    'SOĞUK',
    'Buzul gerilimi: çelik mavisi gölgeler, mat gri tonlar',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const desat = 0.38
      const rm = r * (1 - desat) + luma * desat
      const gm = g * (1 - desat) + luma * desat
      const bm = b * (1 - desat) + luma * desat
      const shadowW = 1 - luma
      return [
        sCurve(rm - shadowW * 0.05, 0.4),
        sCurve(gm + shadowW * 0.01, 0.38),
        sCurve(bm + shadowW * 0.09 + 0.02, 0.4)
      ]
    }
  ),
  buildBuiltInLut(
    'cyber-neon',
    'Neon Noir',
    ['#1a1033', '#22d3ee'],
    'GECE',
    'Gece neonu: mor gölgeler, camgöbeği-macenta vurgular',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.5)
      const highW = Math.pow(luma, 1.3)
      const ro = sCurve(r, 0.42) + shadowW * 0.07 + highW * 0.05
      const go = sCurve(g, 0.38) - shadowW * 0.04 + highW * 0.07
      const bo = sCurve(b, 0.42) + shadowW * 0.13 + highW * 0.08
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'emerald-lab',
    'Emerald Lab',
    ['#0b221e', '#6ee7b7'],
    'GERİLİM',
    'Laboratuvar yeşili: koyu zümrüt gölgeler, soğuk vurgular',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const ro = sCurve(r * 0.88, 0.45)
      const go = sCurve(g * 1.03 + (1 - luma) * 0.04, 0.45)
      const bo = sCurve(b * 0.96 + (1 - luma) * 0.03, 0.42)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'vintage-film',
    'Vintage Film',
    ['#2c221b', '#dfc29d'],
    'RETRO',
    'Soluk siyahlar ve sıcak nostaljik pelikül dokusu',
    (r, g, b) => {
      const lift = 0.055
      const ro = lift + r * 0.92 + 0.03 * g
      const go = lift * 0.9 + g * 0.88 + 0.02 * r
      const bo = lift * 1.15 + b * 0.80
      return [sCurve(ro, 0.2), sCurve(go, 0.2), sCurve(bo, 0.15)]
    }
  ),
  buildBuiltInLut(
    'bleach-bypass',
    'Bleach Bypass',
    ['#1e2229', '#b9bcc2'],
    'SERT',
    'Gümüş tutma: düşük doygunluklu yüksek metalik kontrast',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const mixL = 0.55
      const ro = sCurve(r * (1 - mixL) + luma * mixL, 0.65)
      const go = sCurve(g * (1 - mixL) + luma * mixL, 0.65)
      const bo = sCurve(b * (1 - mixL) + luma * mixL, 0.65)
      return [ro, go, bo]
    }
  ),
  // Psikolojik Gerilim & Korku
  buildBuiltInLut(
    '70s-occult-warmth',
    '70s Occult Warmth',
    ['#2b1a10', '#d97724'],
    'Psikolojik Gerilim & Korku',
    'Sıcak kehribar alt tonlar ve soluk vintage gölgeler',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.6)
      const highW = Math.pow(luma, 1.3)
      const lift = 0.04
      const ro = sCurve(lift + r * 0.96 + highW * 0.09 + shadowW * 0.05, 0.28)
      const go = sCurve(lift * 0.8 + g * 0.91 + highW * 0.03 - shadowW * 0.01, 0.28)
      const bo = sCurve(lift * 0.5 + b * 0.76 - highW * 0.08 - shadowW * 0.03, 0.3)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'cold-morgue-cyan',
    'Cold Morgue Cyan',
    ['#0b1f29', '#99d5e8'],
    'Psikolojik Gerilim & Korku',
    'Doygunluğu alınmış çelik mavisi gölgeler, steril yüksek ışıklar',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const desat = 0.32
      const rm = r * (1 - desat) + luma * desat
      const gm = g * (1 - desat) + luma * desat
      const bm = b * (1 - desat) + luma * desat
      const shadowW = Math.pow(1 - luma, 1.4)
      const highW = Math.pow(luma, 1.5)
      return [
        sCurve(rm - shadowW * 0.08 + highW * 0.02, 0.36),
        sCurve(gm + shadowW * 0.02 + highW * 0.04, 0.34),
        sCurve(bm + shadowW * 0.09 + highW * 0.07, 0.36)
      ]
    }
  ),
  buildBuiltInLut(
    'dread-desat',
    'Dread Desat',
    ['#090a0d', '#9aa0a6'],
    'Psikolojik Gerilim & Korku',
    'Yüksek kontrastlı, %60 doygunluğu çekilmiş ezilmiş derin siyahlar',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const desat = 0.6
      const rm = r * (1 - desat) + luma * desat
      const gm = g * (1 - desat) + luma * desat
      const bm = b * (1 - desat) + luma * desat
      const crush = (v: number) => sCurve((v - 0.035) * 1.09, 0.62)
      return [crush(rm * 0.96), crush(gm * 0.99), crush(bm * 1.03)]
    }
  ),
  // Neo-Noir & Gece Atmosferi
  buildBuiltInLut(
    'sodium-vapor-street',
    'Sodium Vapor Street',
    ['#141913', '#eab308'],
    'Neo-Noir & Gece Atmosferi',
    'Gece sokak lambası kehribar-yeşilimsi sarı kırılımı',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const midW = Math.max(0, 1 - Math.abs(luma - 0.52) * 1.9)
      const shadowW = Math.pow(1 - luma, 1.7)
      const ro = sCurve(r * 0.94 + midW * 0.14 + luma * 0.06 - shadowW * 0.04, 0.44)
      const go = sCurve(g * 0.98 + midW * 0.12 - shadowW * 0.01, 0.44)
      const bo = sCurve(b * 0.68 - midW * 0.1 + shadowW * 0.02, 0.48)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'rainy-neon-noir',
    'Rainy Neon Noir',
    ['#110c2e', '#ec4899'],
    'Neo-Noir & Gece Atmosferi',
    'Derin mavi/mor gölgeler, parlak magenta/siyan vurgu tonları',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.5)
      const highW = Math.pow(luma, 1.35)
      const ro = sCurve(r + shadowW * 0.05 + highW * 0.14, 0.42)
      const go = sCurve(g - shadowW * 0.04 + highW * 0.04, 0.4)
      const bo = sCurve(b + shadowW * 0.15 + highW * 0.1, 0.42)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'silver-nitrate-bw',
    'Silver Nitrate B&W',
    ['#070709', '#d4d4d8'],
    'Neo-Noir & Gece Atmosferi',
    'Gümüş nitrat yüksek kontrastlı, zengin orta tonlu 35mm S&B',
    (r, g, b) => {
      const luma = 0.27 * r + 0.61 * g + 0.12 * b
      const tone = sCurve(Math.pow(clamp01(luma), 0.94), 0.72)
      const silver = clamp01((tone - 0.5) * 1.15 + 0.5)
      return [silver, silver, clamp01(silver * 1.015)]
    }
  ),
  // 35mm Film Stokları
  buildBuiltInLut(
    'cinestill-800t',
    'CineStill 800T',
    ['#0b1b2c', '#ff5b3b'],
    '35mm Film Stokları',
    'Tungsten dengeli gece filmi ve belirgin sıcak vurgular',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const shadowW = Math.pow(1 - luma, 1.45)
      const highW = Math.pow(luma, 1.55)
      const ro = sCurve(r * 0.96 - shadowW * 0.04 + highW * 0.09, 0.36)
      const go = sCurve(g * 0.99 + shadowW * 0.01, 0.36)
      const bo = sCurve(b * 1.05 + shadowW * 0.1 - highW * 0.04, 0.38)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'fuji-eterna-soft',
    'Fuji Eterna Soft',
    ['#1d2925', '#b9d8c2'],
    '35mm Film Stokları',
    'Yumuşak kontrast, pastel yeşiller ve doğal sinematik geçişler',
    (r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const lift = 0.035
      const soft = (v: number) => clamp01(lift + v * 0.9 + luma * 0.04)
      const ro = sCurve(soft(r * 0.97), 0.12)
      const go = sCurve(soft(g * 1.03 + (1 - luma) * 0.02), 0.12)
      const bo = sCurve(soft(b * 0.96), 0.14)
      return [ro, go, bo]
    }
  ),
  buildBuiltInLut(
    'sepia-archive-1920',
    'Sepia Archive 1920',
    ['#261b12', '#d6b48a'],
    '35mm Film Stokları',
    'Eskitilmiş arşiv filmi tonu ve sıcak monokrom patina',
    (r, g, b) => {
      const luma = 0.24 * r + 0.64 * g + 0.12 * b
      const t = sCurve(0.05 + luma * 0.88, 0.28)
      const ro = clamp01(t * 1.08 + 0.03)
      const go = clamp01(t * 0.94 + 0.01)
      const bo = clamp01(t * 0.72)
      return [ro, go, bo]
    }
  )
]
