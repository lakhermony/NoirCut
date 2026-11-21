/**
 * NOIRFILM — Sinematik Görünüm & Dijital Film Emülasyon Sistemi
 * Hem WebGL2 önizleme (renderer) hem de FFmpeg export (main) tarafından paylaşılan veri modeli.
 */
import type { ColorGrade } from './color'

export type FilmFormat = '35mm' | '16mm' | '8mm'

export interface FilmEmulationConfig {
  enabled: boolean
  /** Dijital film esinli format profili */
  format: FilmFormat
  /** -100..+100 Film S-eğrisi kontrastı */
  contrast: number
  /** 0..100 Parlak alan yumuşak omuz (Highlight Roll-off) */
  highlightRolloff: number
  /** -100..+100 Gölge tepkisi / lift-toe dengesi */
  shadowResponse: number
  /** 0..200 (%) Film doygunluğu */
  saturation: number
  /** -100..+100 Renk yoğunluğu (zenginlik / subtractive density) */
  colorDensity: number
  /** -100..+100 Film renk sıcaklığı */
  temperature: number
  /** -100..+100 Film karakteristik tepki / orta ton eğrisi */
  filmResponse: number
  /** Parlak alan renk tonu (hex) */
  highlightTint: string
  /** Gölge renk tonu (hex) */
  shadowTint: string
}

export type FilmGrainProfile = '35mm' | '16mm' | '8mm' | 'fine' | 'heavy' | 'vintage'

export interface FilmTextureConfig {
  enabled: boolean
  /** Oynatma sırasında düşük maliyetli gren önizlemesi */
  playbackPreview: boolean
  profile: FilmGrainProfile
  /** 0..100 Genel gren miktarı */
  amount: number
  /** 0..100 Tane boyutu */
  size: number
  /** 0..100 Kontrast/şiddet */
  strength: number
  /** 0..100 Tane yumuşaklığı */
  softness: number
  /** 0..100 Gölge ↔ Parlak dağılım dengesi */
  distribution: number
  /** 0..100 Parlaklık (luma) greni */
  luminanceGrain: number
  /** 0..100 Renk (chroma) greni */
  colorGrain: number
}

export interface HalationEffectConfig {
  enabled: boolean
  intensity: number // 0..100
  threshold: number // 0..100
  radius: number // 0..100
  spread: number // 0..100
  color: string // hex
  blend: number // 0..100
}

export interface BloomEffectConfig {
  enabled: boolean
  intensity: number // 0..100
  threshold: number // 0..100
  radius: number // 0..100
  softness: number // 0..100
  highlightStrength: number // 0..100
}

export interface DiffusionEffectConfig {
  enabled: boolean
  strength: number // 0..100
  highlightDiffusion: number // 0..100
  softness: number // 0..100
  contrastPreservation: number // 0..100
}

export interface MistEffectConfig {
  enabled: boolean
  intensity: number // 0..100
  highlightSpread: number // 0..100
  atmosphericSoftness: number // 0..100
  contrastReduction: number // 0..100
}

export interface LightEffectsConfig {
  halation: HalationEffectConfig
  bloom: BloomEffectConfig
  diffusion: DiffusionEffectConfig
  mist: MistEffectConfig
}

export interface ChromaKeyConfig {
  enabled: boolean
  /** Hex anahtar rengi (varsayılan yeşil ekran: #00B140, mavi ekran: #0047BB) */
  keyColor: string
  /** 0..100 Renk toleransı / eşik */
  tolerance: number
  /** 0..100 Kenar yumuşatma (Edge Refinement / Softness) */
  edgeSoftness: number
  /** 0..100 Yeşil/Mavi taşma giderme (Spill Suppression) */
  spillSuppression: number
  /** 0..100 Opaklık / Arka plan şeffaflığı */
  opacity: number
  /** Matte (Siyah/Beyaz Alfa Maskesi) Önizlemesi */
  mattePreview: boolean
  /** Arka plan değiştirme rengi (hex) veya şeffaf (alt video kanalı) */
  bgMode: 'transparent' | 'color'
  bgColor: string
}

export const defaultChromaKey = (): ChromaKeyConfig => ({
  enabled: false,
  keyColor: '#00B140',
  tolerance: 32,
  edgeSoftness: 18,
  spillSuppression: 45,
  opacity: 100,
  mattePreview: false,
  bgMode: 'transparent',
  bgColor: '#0B0D12'
})

export interface NoirFilmConfig {
  activeLookId: string | null
  /** 0..100 Tüm NoirFilm görünüm yoğunluğu */
  lookIntensity: number
  filmEmulation: FilmEmulationConfig
  texture: FilmTextureConfig
  lightEffects: LightEffectsConfig
  chromaKey?: ChromaKeyConfig
}

export const NOIR_LOOK_CATEGORIES = [
  'Hollywood Cinema',
  'Dark Cinema',
  'Horror & Thriller',
  'Vintage Cinema',
  'Film Noir',
  'Warm Cinema',
  'Cold Cinema',
  'Documentary',
  'Indie Film',
  'Desaturated Cinema',
  'Black & White',
  'Custom Looks'
] as const

export type NoirLookCategory = (typeof NOIR_LOOK_CATEGORIES)[number]

export interface NoirLookDefinition {
  id: string
  name: string
  category: NoirLookCategory
  description: string
  characteristics: string[]
  swatches: [string, string, string]
  /** Temel ColorGrade parametre yaması */
  gradePatch: Partial<ColorGrade>
  /** NoirFilm motor parametre yaması */
  noirFilm: {
    filmEmulation?: Partial<FilmEmulationConfig>
    texture?: Partial<FilmTextureConfig>
    lightEffects?: {
      halation?: Partial<HalationEffectConfig>
      bloom?: Partial<BloomEffectConfig>
      diffusion?: Partial<DiffusionEffectConfig>
      mist?: Partial<MistEffectConfig>
    }
  }
}

export interface NoirLookPreset {
  id: string
  name: string
  category: NoirLookCategory
  description: string
  createdAt: string
  updatedAt: string
  favorite?: boolean
  swatches: [string, string, string]
  grade: ColorGrade
}

export const defaultFilmEmulation = (): FilmEmulationConfig => ({
  enabled: false,
  format: '35mm',
  contrast: 0,
  highlightRolloff: 35,
  shadowResponse: 0,
  saturation: 100,
  colorDensity: 0,
  temperature: 0,
  filmResponse: 0,
  highlightTint: '#FFF8EE',
  shadowTint: '#0D141C'
})

export const defaultFilmTexture = (): FilmTextureConfig => ({
  enabled: false,
  playbackPreview: true,
  profile: '35mm',
  amount: 24,
  size: 38,
  strength: 45,
  softness: 35,
  distribution: 50,
  luminanceGrain: 75,
  colorGrain: 25
})

export const defaultHalationEffect = (): HalationEffectConfig => ({
  enabled: false,
  intensity: 24,
  threshold: 62,
  radius: 45,
  spread: 50,
  color: '#FF4B1F',
  blend: 65
})

export const defaultBloomEffect = (): BloomEffectConfig => ({
  enabled: false,
  intensity: 20,
  threshold: 65,
  radius: 50,
  softness: 55,
  highlightStrength: 60
})

export const defaultDiffusionEffect = (): DiffusionEffectConfig => ({
  enabled: false,
  strength: 22,
  highlightDiffusion: 55,
  softness: 50,
  contrastPreservation: 70
})

export const defaultMistEffect = (): MistEffectConfig => ({
  enabled: false,
  intensity: 20,
  highlightSpread: 55,
  atmosphericSoftness: 50,
  contrastReduction: 25
})

export const defaultLightEffects = (): LightEffectsConfig => ({
  halation: defaultHalationEffect(),
  bloom: defaultBloomEffect(),
  diffusion: defaultDiffusionEffect(),
  mist: defaultMistEffect()
})

export function defaultNoirFilmConfig(): NoirFilmConfig {
  return {
    activeLookId: null,
    lookIntensity: 100,
    filmEmulation: defaultFilmEmulation(),
    texture: defaultFilmTexture(),
    lightEffects: defaultLightEffects(),
    chromaKey: defaultChromaKey()
  }
}

export function cloneNoirFilmConfig(nf?: NoirFilmConfig): NoirFilmConfig {
  const base = defaultNoirFilmConfig()
  if (!nf) return base
  return {
    activeLookId: nf.activeLookId ?? null,
    lookIntensity: nf.lookIntensity ?? 100,
    filmEmulation: { ...base.filmEmulation, ...(nf.filmEmulation ?? {}) },
    texture: { ...base.texture, ...(nf.texture ?? {}) },
    lightEffects: {
      halation: { ...base.lightEffects.halation, ...(nf.lightEffects?.halation ?? {}) },
      bloom: { ...base.lightEffects.bloom, ...(nf.lightEffects?.bloom ?? {}) },
      diffusion: { ...base.lightEffects.diffusion, ...(nf.lightEffects?.diffusion ?? {}) },
      mist: { ...base.lightEffects.mist, ...(nf.lightEffects?.mist ?? {}) }
    },
    chromaKey: { ...(base.chromaKey ?? defaultChromaKey()), ...(nf.chromaKey ?? {}) }
  }
}

export function isNeutralNoirFilm(nf?: NoirFilmConfig): boolean {
  if (!nf) return true
  if (nf.chromaKey?.enabled) return false
  if ((nf.lookIntensity ?? 100) <= 0.01) return true
  const emu = nf.filmEmulation
  const tex = nf.texture
  const le = nf.lightEffects
  const emuActive = emu?.enabled
  const texActive = tex?.enabled && (tex.amount ?? 0) > 0.5
  const lightActive =
    (le?.halation?.enabled && (le.halation.intensity ?? 0) > 0.5) ||
    (le?.bloom?.enabled && (le.bloom.intensity ?? 0) > 0.5) ||
    (le?.diffusion?.enabled && (le.diffusion.strength ?? 0) > 0.5) ||
    (le?.mist?.enabled && (le.mist.intensity ?? 0) > 0.5)
  return !emuActive && !texActive && !lightActive
}

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255
    const g = parseInt(clean[1] + clean[1], 16) / 255
    const b = parseInt(clean[2] + clean[2], 16) / 255
    return Number.isFinite(r) ? [r, g, b] : [1, 1, 1]
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255
    const g = parseInt(clean.slice(2, 4), 16) / 255
    const b = parseInt(clean.slice(4, 6), 16) / 255
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : [1, 1, 1]
  }
  return [1, 1, 1]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Dijital Film Emülasyonu piksel dönüşümü (WebGL2 shader ile birebir eşleşir).
 */
export function evaluateFilmEmulationRgb(
  rIn: number,
  gIn: number,
  bIn: number,
  emu: FilmEmulationConfig,
  lookIntensity01 = 1
): [number, number, number] {
  if (!emu.enabled || lookIntensity01 <= 0.001) return [rIn, gIn, bIn]

  let r = rIn
  let g = gIn
  let b = bIn

  // Format karakteristik ön-denge (dijital film esinli simülasyon)
  const formatContrastBoost =
    emu.format === '8mm' ? 0.14 : emu.format === '16mm' ? 0.08 : 0.04
  const formatRollBoost =
    emu.format === '35mm' ? 0.12 : emu.format === '16mm' ? 0.18 : 0.22

  // 1) Film Temperature
  const temp = (emu.temperature / 100) * 0.14
  r = clamp01(r + temp)
  b = clamp01(b - temp)

  // 2) Shadow Response (toe) & Film Response (midtone curve)
  const sh = emu.shadowResponse / 100
  const resp = emu.filmResponse / 100
  const shadowCurve = (v: number) => {
    const toe = sh * 0.12 * (1 - v) * (1 - v)
    const mid = resp * 0.14 * v * (1 - v) * (v - 0.5) * -4.0
    return clamp01(v + toe + mid)
  }
  r = shadowCurve(r)
  g = shadowCurve(g)
  b = shadowCurve(b)

  // 3) Film Contrast (S-curve)
  const k = 1 + (emu.contrast / 100) * 0.7 + formatContrastBoost
  const sCurve = (v: number) => {
    const x = clamp01(v)
    return clamp01((x - 0.5) * k + 0.5)
  }
  r = sCurve(r)
  g = sCurve(g)
  b = sCurve(b)

  // 4) Highlight Roll-off (filmic shoulder compression)
  const roll = clamp01(emu.highlightRolloff / 100 + formatRollBoost)
  if (roll > 0.001) {
    const knee = 0.62 - roll * 0.18
    const rollChannel = (v: number) => {
      if (v <= knee) return v
      const t = (v - knee) / Math.max(0.001, 1 - knee)
      const compressed = knee + (1 - knee) * (1 - Math.exp(-t * (1 + roll * 1.4))) / (1 - Math.exp(-(1 + roll * 1.4)))
      return clamp01(v + (compressed - v) * roll)
    }
    r = rollChannel(r)
    g = rollChannel(g)
    b = rollChannel(b)
  }

  // 5) Subtractive Color Density & Film Saturation
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const density = emu.colorDensity / 100
  const sat = emu.saturation / 100
  if (Math.abs(density) > 0.001) {
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const chroma = maxC - minC
    const darkFactor = 1 - density * 0.24 * chroma
    r = clamp01(r * darkFactor)
    g = clamp01(g * darkFactor)
    b = clamp01(b * darkFactor)
  }
  const luma2 = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const effSat = Math.max(0, sat * (1 + density * 0.22))
  r = clamp01(luma2 + (r - luma2) * effSat)
  g = clamp01(luma2 + (g - luma2) * effSat)
  b = clamp01(luma2 + (b - luma2) * effSat)

  // 6) Highlight & Shadow Split Tint
  const [hr, hg, hb] = hexToRgb01(emu.highlightTint)
  const [sr, sg, sb] = hexToRgb01(emu.shadowTint)
  const hiW = Math.pow(clamp01(luma), 1.6) * 0.22
  const shW = Math.pow(clamp01(1 - luma), 1.8) * 0.24
  r = clamp01(r + (hr - 0.95) * hiW + (sr - 0.08) * shW)
  g = clamp01(g + (hg - 0.95) * hiW + (sg - 0.08) * shW)
  b = clamp01(b + (hb - 0.95) * hiW + (sb - 0.08) * shW)

  if (lookIntensity01 < 0.999) {
    r = rIn + (r - rIn) * lookIntensity01
    g = gIn + (g - gIn) * lookIntensity01
    b = bIn + (b - bIn) * lookIntensity01
  }
  return [clamp01(r), clamp01(g), clamp01(b)]
}

/** Film Grain profiline göre önerilen başlangıç değerleri */
export const FILM_GRAIN_PRESETS: Record<
  FilmGrainProfile,
  Pick<FilmTextureConfig, 'amount' | 'size' | 'strength' | 'softness' | 'distribution' | 'luminanceGrain' | 'colorGrain'>
> = {
  '35mm': { amount: 24, size: 36, strength: 45, softness: 35, distribution: 50, luminanceGrain: 78, colorGrain: 22 },
  '16mm': { amount: 42, size: 58, strength: 62, softness: 42, distribution: 46, luminanceGrain: 72, colorGrain: 32 },
  '8mm': { amount: 64, size: 78, strength: 78, softness: 48, distribution: 42, luminanceGrain: 68, colorGrain: 42 },
  fine: { amount: 14, size: 22, strength: 30, softness: 25, distribution: 55, luminanceGrain: 90, colorGrain: 10 },
  heavy: { amount: 72, size: 68, strength: 82, softness: 38, distribution: 45, luminanceGrain: 70, colorGrain: 38 },
  vintage: { amount: 48, size: 62, strength: 58, softness: 55, distribution: 40, luminanceGrain: 64, colorGrain: 44 }
}

/**
 * 12 Kategoride Kurumsal NoirFilm Sinematik Görünüm Kütüphanesi.
 */
export const NOIR_LOOKS: NoirLookDefinition[] = [
  {
    id: 'nf-hollywood-teal-orange',
    name: 'Hollywood Blockbuster',
    category: 'Hollywood Cinema',
    description: 'Zengin sıcak cilt tonları, derin camgöbeği gölgeler ve geniş sinematik dinamik aralık.',
    characteristics: ['Teal & Orange', 'Yüksek Dinamik', '35mm Omuz'],
    swatches: ['#0B2430', '#1E5B6B', '#F4A261'],
    gradePatch: {
      lutId: 'teal-orange',
      lutIntensity: 78,
      contrast: 14,
      highlights: -14,
      shadows: 6,
      saturation: 108,
      vibrance: 12
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 12,
        highlightRolloff: 55,
        shadowResponse: -6,
        colorDensity: 18,
        highlightTint: '#FFF1DF',
        shadowTint: '#091E28'
      },
      texture: { enabled: true, profile: '35mm', amount: 18, size: 32 },
      lightEffects: {
        halation: { enabled: true, intensity: 16, threshold: 68, radius: 42 },
        bloom: { enabled: true, intensity: 14, threshold: 70 }
      }
    }
  },
  {
    id: 'nf-dark-obsidian',
    name: 'Obsidian Nocturne',
    category: 'Dark Cinema',
    description: 'Düşük anahtarlı karanlık sinema; derin siyahlar, kontrollü ışıklar ve soğuk metalik alt tonlar.',
    characteristics: ['Low-Key', 'Derin Siyahlar', 'Kontrollü Parlama'],
    swatches: ['#0B0D12', '#1F2937', '#7F95A8'],
    gradePatch: {
      lutId: 'bleach-bypass',
      lutIntensity: 55,
      exposure: -0.18,
      contrast: 22,
      shadows: -16,
      saturation: 84,
      vignette: 24
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 20,
        highlightRolloff: 62,
        shadowResponse: -18,
        colorDensity: 24,
        temperature: -10,
        highlightTint: '#E8EFF5',
        shadowTint: '#090D14'
      },
      texture: { enabled: true, profile: '35mm', amount: 26, size: 38 },
      lightEffects: {
        mist: { enabled: true, intensity: 14, atmosphericSoftness: 55 }
      }
    }
  },
  {
    id: 'nf-horror-asylum',
    name: 'Shadow Thriller',
    category: 'Horror & Thriller',
    description: 'Gerilim ve korku sahneleri için yeşil-çelik gölgeler, keskin mikro kontrast ve gergin atmosfer.',
    characteristics: ['Soğuk Yeşil Gölge', 'Sert Kontrast', '16mm Doku'],
    swatches: ['#0A1412', '#263B35', '#9CA89C'],
    gradePatch: {
      lutId: 'matrix-noir',
      lutIntensity: 62,
      contrast: 26,
      temperature: -18,
      tint: -14,
      saturation: 72,
      vignette: 32
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '16mm',
        contrast: 24,
        highlightRolloff: 48,
        shadowResponse: -22,
        colorDensity: 15,
        highlightTint: '#DCE6DF',
        shadowTint: '#081713'
      },
      texture: { enabled: true, profile: '16mm', amount: 36, size: 54 },
      lightEffects: {
        diffusion: { enabled: true, strength: 18, contrastPreservation: 78 }
      }
    }
  },
  {
    id: 'nf-vintage-kodak74',
    name: 'Vintage 1974',
    category: 'Vintage Cinema',
    description: '70\'ler analog film estetiği: yumuşak siyahlar, altın orta tonlar ve sıcak halation parıltısı.',
    characteristics: ['Sıcak Orta Ton', 'Yumuşak Omuz', 'Halation'],
    swatches: ['#2E2118', '#A66E38', '#F2C572'],
    gradePatch: {
      lutId: 'kodak-2383',
      lutIntensity: 72,
      temperature: 14,
      highlights: -18,
      shadows: 10,
      saturation: 94
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '16mm',
        contrast: 8,
        highlightRolloff: 70,
        shadowResponse: 14,
        colorDensity: 12,
        temperature: 12,
        highlightTint: '#FFE8BD',
        shadowTint: '#1F160E'
      },
      texture: { enabled: true, profile: 'vintage', amount: 44, size: 60 },
      lightEffects: {
        halation: { enabled: true, intensity: 32, threshold: 58, radius: 52 },
        mist: { enabled: true, intensity: 16 }
      }
    }
  },
  {
    id: 'nf-classic-noir',
    name: 'Midnight Silver Noir',
    category: 'Film Noir',
    description: 'Klasik kara film ruhu: gümüş halojenür kontrastı, dramatik gölge düşüşü ve ince gren.',
    characteristics: ['Gümüş Kontrast', 'Dramatik Işık', 'Klasik Gren'],
    swatches: ['#050506', '#4A4E57', '#ECEFF2'],
    gradePatch: {
      lutId: 'noir-bw',
      lutIntensity: 95,
      contrast: 30,
      highlights: 8,
      shadows: -14,
      saturation: 10,
      vignette: 34
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 28,
        highlightRolloff: 55,
        shadowResponse: -16,
        saturation: 0,
        highlightTint: '#F5F7FA',
        shadowTint: '#08090C'
      },
      texture: { enabled: true, profile: '35mm', amount: 34, size: 42, colorGrain: 5 },
      lightEffects: {
        bloom: { enabled: true, intensity: 22, threshold: 62, radius: 48 }
      }
    }
  },
  {
    id: 'nf-warm-golden',
    name: 'Golden Sunset',
    category: 'Warm Cinema',
    description: 'Altın saat sıcaklığı, kadife ten tonları ve parlak ışık kaynaklarında organik bloom.',
    characteristics: ['Altın Işık', 'Kadife Cilt', 'Yumuşak Bloom'],
    swatches: ['#2C1810', '#C96D3B', '#FFD59E'],
    gradePatch: {
      lutId: 'golden-hour',
      lutIntensity: 74,
      temperature: 20,
      tint: 4,
      contrast: 8,
      vibrance: 16
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 6,
        highlightRolloff: 64,
        shadowResponse: 8,
        colorDensity: 14,
        temperature: 16,
        highlightTint: '#FFE5C2',
        shadowTint: '#1F120B'
      },
      texture: { enabled: true, profile: 'fine', amount: 14, size: 24 },
      lightEffects: {
        bloom: { enabled: true, intensity: 28, threshold: 58, radius: 55 },
        halation: { enabled: true, intensity: 18 }
      }
    }
  },
  {
    id: 'nf-cold-nordic',
    name: 'Nordic Slate',
    category: 'Cold Cinema',
    description: 'Kuzey sineması: temiz buz mavisi vurgular, nötr cilt koruması ve sakin atmosfer.',
    characteristics: ['Buz Mavisi', 'Temiz Beyazlar', 'Sakin Atmosfer'],
    swatches: ['#0E1726', '#334E68', '#BCCCDC'],
    gradePatch: {
      lutId: 'arctic-blue',
      lutIntensity: 68,
      temperature: -22,
      contrast: 10,
      highlights: -10,
      saturation: 88
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 10,
        highlightRolloff: 52,
        temperature: -18,
        colorDensity: 10,
        highlightTint: '#E3F0FF',
        shadowTint: '#091321'
      },
      texture: { enabled: true, profile: 'fine', amount: 16, size: 28 },
      lightEffects: {
        mist: { enabled: true, intensity: 22, atmosphericSoftness: 60 }
      }
    }
  },
  {
    id: 'nf-docu-natural',
    name: 'Verite Natural',
    category: 'Documentary',
    description: 'Belgesel ve gerçekçi çekimler için nötr renk doğruluğu, doğal kontrast ve hafif film omuzu.',
    characteristics: ['Doğal Renk', 'Temiz Cilt', 'Hafif Roll-off'],
    swatches: ['#1F2421', '#5C6B61', '#DCE3DE'],
    gradePatch: {
      contrast: 6,
      highlights: -12,
      shadows: 8,
      vibrance: 8,
      saturation: 100
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 4,
        highlightRolloff: 45,
        shadowResponse: 4,
        colorDensity: 6,
        highlightTint: '#FFFDF8',
        shadowTint: '#111413'
      },
      texture: { enabled: true, profile: 'fine', amount: 10, size: 20 },
      lightEffects: {}
    }
  },
  {
    id: 'nf-indie-pastel',
    name: 'Indie 16mm Daylight',
    category: 'Indie Film',
    description: 'Bağımsız festival sineması: hafif soluk siyahlar, doğal 16mm dokusu ve yumuşak difüzyon.',
    characteristics: ['16mm Karakter', 'Pastel Ton', 'Yumuşak Difüzyon'],
    swatches: ['#252A30', '#6E8878', '#E9D8B8'],
    gradePatch: {
      lutId: 'fuji-eterna',
      lutIntensity: 64,
      contrast: -4,
      shadows: 14,
      highlights: -14,
      saturation: 92
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '16mm',
        contrast: 4,
        highlightRolloff: 66,
        shadowResponse: 12,
        colorDensity: 8,
        highlightTint: '#FFF3DA',
        shadowTint: '#18201E'
      },
      texture: { enabled: true, profile: '16mm', amount: 34, size: 52 },
      lightEffects: {
        diffusion: { enabled: true, strength: 24, softness: 55 },
        halation: { enabled: true, intensity: 14 }
      }
    }
  },
  {
    id: 'nf-desat-war',
    name: 'Bleach Steel',
    category: 'Desaturated Cinema',
    description: 'Ağartılmış banyo (bleach bypass) etkisiyle düşük doygunluk ve güçlü orta ton ağırlığı.',
    characteristics: ['Düşük Doygunluk', 'Metalik Vurgu', 'Ağır Gölge'],
    swatches: ['#141619', '#495057', '#ADB5BD'],
    gradePatch: {
      lutId: 'bleach-bypass',
      lutIntensity: 80,
      contrast: 22,
      saturation: 62,
      vibrance: -10
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '35mm',
        contrast: 22,
        highlightRolloff: 50,
        saturation: 68,
        colorDensity: 20,
        highlightTint: '#EEF2F5',
        shadowTint: '#101418'
      },
      texture: { enabled: true, profile: 'heavy', amount: 38, size: 50 },
      lightEffects: {}
    }
  },
  {
    id: 'nf-bw-tri-x',
    name: 'Tri-X 400 Monochrome',
    category: 'Black & White',
    description: 'Klasik yüksek hızlı siyah-beyaz fotoğraf filmi hissiyatı, net tane yapısı ve zengin gri tonlar.',
    characteristics: ['Monokrom', 'Klasik Gri Ton', 'Organik Tane'],
    swatches: ['#0A0A0A', '#666666', '#EAEAEA'],
    gradePatch: {
      lutId: 'noir-bw',
      lutIntensity: 100,
      contrast: 18,
      saturation: 0,
      vignette: 18
    },
    noirFilm: {
      filmEmulation: {
        enabled: true,
        format: '16mm',
        contrast: 18,
        highlightRolloff: 58,
        saturation: 0,
        highlightTint: '#FFFFFF',
        shadowTint: '#0A0A0A'
      },
      texture: { enabled: true, profile: '16mm', amount: 46, size: 56, luminanceGrain: 95, colorGrain: 0 },
      lightEffects: {}
    }
  }
]

/**
 * Bir NoirLookDefinition'ı (veya NoirLookPreset'i) mevcut ColorGrade üzerine uygular.
 */
export function applyNoirLookToGrade(
  current: ColorGrade,
  look: NoirLookDefinition,
  intensity = 100
): ColorGrade {
  const baseNf = defaultNoirFilmConfig()
  const nfPatch = look.noirFilm
  const nextNf: NoirFilmConfig = {
    activeLookId: look.id,
    lookIntensity: Math.max(0, Math.min(100, intensity)),
    filmEmulation: {
      ...baseNf.filmEmulation,
      ...(nfPatch.filmEmulation ?? {})
    },
    texture: {
      ...baseNf.texture,
      ...(nfPatch.texture ?? {})
    },
    lightEffects: {
      halation: { ...baseNf.lightEffects.halation, ...(nfPatch.lightEffects?.halation ?? {}) },
      bloom: { ...baseNf.lightEffects.bloom, ...(nfPatch.lightEffects?.bloom ?? {}) },
      diffusion: { ...baseNf.lightEffects.diffusion, ...(nfPatch.lightEffects?.diffusion ?? {}) },
      mist: { ...baseNf.lightEffects.mist, ...(nfPatch.lightEffects?.mist ?? {}) }
    }
  }

  return {
    ...current,
    exposure: look.gradePatch.exposure ?? 0,
    contrast: look.gradePatch.contrast ?? 0,
    highlights: look.gradePatch.highlights ?? 0,
    shadows: look.gradePatch.shadows ?? 0,
    temperature: look.gradePatch.temperature ?? 0,
    tint: look.gradePatch.tint ?? 0,
    vibrance: look.gradePatch.vibrance ?? 0,
    saturation: look.gradePatch.saturation ?? 100,
    vignette: look.gradePatch.vignette ?? 0,
    lutId: look.gradePatch.lutId ?? null,
    lutIntensity: look.gradePatch.lutIntensity ?? 100,
    noirFilm: nextNf
  }
}

export interface NoirLookFilePayload {
  format: 'noircut-noirlook-v1'
  preset: NoirLookPreset
}

export function serializeNoirLookFile(preset: NoirLookPreset): string {
  const payload: NoirLookFilePayload = {
    format: 'noircut-noirlook-v1',
    preset
  }
  return JSON.stringify(payload, null, 2)
}

export function parseNoirLookFile(raw: string): NoirLookPreset {
  const parsed = JSON.parse(raw) as Partial<NoirLookFilePayload> & Partial<NoirLookPreset>
  const p = parsed.format === 'noircut-noirlook-v1' && parsed.preset ? parsed.preset : parsed
  if (!p || !p.name || !p.grade) {
    throw new Error('Geçersiz .noirlook dosyası.')
  }
  const now = new Date().toISOString()
  return {
    id: p.id || `custom-look-${Date.now().toString(36)}`,
    name: p.name,
    category: p.category || 'Custom Looks',
    description: p.description || 'İçe aktarılan sinematik görünüm',
    createdAt: p.createdAt || now,
    updatedAt: now,
    favorite: Boolean(p.favorite),
    swatches: Array.isArray(p.swatches) && p.swatches.length === 3 ? (p.swatches as [string, string, string]) : ['#1B1E24', '#5A6577', '#B7E36A'],
    grade: p.grade
  }
}
