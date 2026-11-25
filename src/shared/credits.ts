/**
 * Hazır Sinematik Jenerik ve Metin Şablonları (CREDITS) veri modeli.
 */

export type CreditTemplateId =
  | 'rolling-credits'
  | 'noir-opening'
  | 'lower-third'
  | 'chapter-card'
  | 'standard-text'

export interface CreditRow {
  id: string
  role: string
  name: string
}

export type CreditFont =
  | 'nosifer'
  | 'creepster'
  | 'butcherman'
  | 'eater'
  | 'metal-mania'
  | 'unifraktur'
  | 'six-caps'
  | 'bebas'
  | 'anton'
  | 'archivo-black'
  | 'black-ops'
  | 'abril-fatface'
  | 'cinzel-decorative'
  | 'playfair'
  | 'cormorant'
  | 'bodoni-moda'
  | 'syne'
  | 'special-elite'
  | 'courier-prime'
  | 'vt323'
  | 'custom'
  // Geriye dönük uyumluluk aliasları
  | 'cinzel'
  | 'oswald'
  | 'montserrat'
  | 'inter'
  | 'cinema'
  | 'sans'
  | 'serif'
  | 'mono'
  | 'condensed'
  | 'display'
  | 'editorial'
  | 'grotesque'
  | 'handwriting'
  | 'retro'

export type CreditFontCategory =
  | 'Horror, Slasher & Occult'
  | 'Noir, Pulp & Dedektif Afişleri'
  | 'Klasik Sinema & Sanatsal Başlıklar'
  | 'Senaryo, Daktilo & Analog Kayıt'

export interface CinematicFontMeta {
  id: CreditFont
  label: string
  role: string
  category: CreditFontCategory
  css: string
  trSupport: 'full' | 'ascii'
}

export interface CustomFontRef {
  id: string
  name: string
  dataUrl: string
  fileName?: string
}

export type CreditTextAlign = 'left' | 'center' | 'right'
export type CreditTextPosition = 'top' | 'center' | 'bottom'

export interface CreditConfig {
  templateId: CreditTemplateId
  /** Tekli başlık şablonları için ana başlık */
  title: string
  /** Tekli başlık şablonları için alt başlık / unvan */
  subtitle: string
  /** Rolling Credits için Rol / İsim satırları */
  rows: CreditRow[]
  font: CreditFont
  /** Yüklenen özel (.ttf/.otf/.woff2) font referansı */
  customFont?: CustomFontRef
  /** Yalnızca İngilizce glif içeren afiş fontları için TR -> EN karakter düzeltmesi */
  autoAscii?: boolean
  /** px (1280x720 referansında ölçeklenir) */
  fontSize: number
  /** px (Tracking / Harf aralığı) */
  letterSpacing: number
  /** Satır yüksekliği çarpanı (0.85 .. 2.40) */
  lineHeight?: number
  /** Sinematik metin gölgesi / glow yoğunluğu (0 .. 100%) */
  textShadow?: number
  /** Neon glow rengi (#000000 veya boş ise klasik sinematik koyu gölge) */
  glowColor?: string
  /** Hex renk (#FFFFFF) */
  color: string
  /** Toplam süre (saniye) */
  duration: number
  /** Daktilo efekti: karakter karakter yazım */
  typewriter: boolean
  /** Sinematik film titremesi (Gate Weave) & hafif ışık sızması */
  filmWeave: boolean
  /** Web Audio / Export Foley ses efektleri aktif mi? */
  sfxEnabled: boolean
  /** Foley ses seviyesi (0..100%) */
  sfxVolume: number
  /** Serbest Metin hizalama */
  textAlign?: CreditTextAlign
  /** Serbest Metin dikey konum */
  textPosition?: CreditTextPosition
  /** Serbest Metin tümü büyük harf */
  uppercase?: boolean
}

export interface CreditTemplateMeta {
  id: CreditTemplateId
  name: string
  description: string
  badge: string
}

export const CREDIT_TEMPLATES: CreditTemplateMeta[] = [
  {
    id: 'rolling-credits',
    name: 'Classic Rolling Credits',
    description: 'Sinema sonu aşağıdan yukarıya pürüzsüz kayan jenerik',
    badge: 'SON JENERİK'
  },
  {
    id: 'noir-opening',
    name: 'Noir Opening Title',
    description: 'Karanlık fonda yavaşça belirip kaybolan film adı',
    badge: 'AÇILIŞ'
  },
  {
    id: 'lower-third',
    name: 'Minimalist Lower Third',
    description: 'Sahne alt köşesinde beliren isim ve unvan bandı',
    badge: 'ALT BANT'
  },
  {
    id: 'chapter-card',
    name: 'Chapter / Act Card',
    description: 'Bölüm ve perde başlığı kartı',
    badge: 'BÖLÜM'
  },
  {
    id: 'standard-text',
    name: 'Serbest Metin (Text)',
    description: 'Şablon dışı standart tek veya çok satırlı metin katmanı',
    badge: 'TEXT'
  }
]

export const CREDIT_FONT_CATEGORIES: CreditFontCategory[] = [
  'Horror, Slasher & Occult',
  'Noir, Pulp & Dedektif Afişleri',
  'Klasik Sinema & Sanatsal Başlıklar',
  'Senaryo, Daktilo & Analog Kayıt'
]

export const CINEMATIC_FONTS: CinematicFontMeta[] = [
  // 1. Horror, Slasher & Occult
  {
    id: 'nosifer',
    label: 'Nosifer',
    role: 'Kan / Erime Efekti',
    category: 'Horror, Slasher & Occult',
    css: '"Nosifer", Impact, "Liberation Sans", fantasy, sans-serif',
    trSupport: 'ascii'
  },
  {
    id: 'creepster',
    label: 'Creepster',
    role: 'Klasik Slasher',
    category: 'Horror, Slasher & Occult',
    css: '"Creepster", Impact, "Liberation Sans", fantasy, sans-serif',
    trSupport: 'ascii'
  },
  {
    id: 'butcherman',
    label: 'Butcherman',
    role: 'Parçalanmış Korku',
    category: 'Horror, Slasher & Occult',
    css: '"Butcherman", Impact, "Liberation Sans", fantasy, sans-serif',
    trSupport: 'ascii'
  },
  {
    id: 'eater',
    label: 'Eater',
    role: 'Okült / Çürümüş',
    category: 'Horror, Slasher & Occult',
    css: '"Eater", Impact, Georgia, fantasy, serif',
    trSupport: 'ascii'
  },
  {
    id: 'metal-mania',
    label: 'Metal Mania',
    role: 'Brütal / Karanlık',
    category: 'Horror, Slasher & Occult',
    css: '"Metal Mania", Impact, "Arial Black", fantasy, sans-serif',
    trSupport: 'full'
  },
  {
    id: 'unifraktur',
    label: 'UnifrakturMaguntia',
    role: 'Gotik Siyah Harf',
    category: 'Horror, Slasher & Occult',
    css: '"UnifrakturMaguntia", "Cinzel Decorative", Georgia, serif',
    trSupport: 'ascii'
  },

  // 2. Noir, Pulp & Dedektif Afişleri
  {
    id: 'six-caps',
    label: 'Six Caps',
    role: 'Dar Noir Film Afişi',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Six Caps", "Bebas Neue", "Arial Narrow", sans-serif',
    trSupport: 'ascii'
  },
  {
    id: 'bebas',
    label: 'Bebas Neue',
    role: 'Modern Gerilim Afiş',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Bebas Neue", Impact, "Arial Narrow", "Liberation Sans Narrow", sans-serif',
    trSupport: 'full'
  },
  {
    id: 'anton',
    label: 'Anton',
    role: 'Sert Darbeli Manşet',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Anton", Impact, "Arial Black", "Liberation Sans", sans-serif',
    trSupport: 'full'
  },
  {
    id: 'archivo-black',
    label: 'Archivo Black',
    role: 'Kalın Pulp Başlık',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Archivo Black", "Arial Black", "Liberation Sans", sans-serif',
    trSupport: 'full'
  },
  {
    id: 'black-ops',
    label: 'Black Ops One',
    role: 'Askeri / Soruşturma',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Black Ops One", Impact, "Arial Black", sans-serif',
    trSupport: 'full'
  },
  {
    id: 'abril-fatface',
    label: 'Abril Fatface',
    role: 'Pulp Tırnaklı Afiş',
    category: 'Noir, Pulp & Dedektif Afişleri',
    css: '"Abril Fatface", "Playfair Display", Georgia, serif',
    trSupport: 'full'
  },

  // 3. Klasik Sinema & Sanatsal Başlıklar
  {
    id: 'cinzel-decorative',
    label: 'Cinzel Decorative',
    role: 'Epik / Okült Roma',
    category: 'Klasik Sinema & Sanatsal Başlıklar',
    css: '"Cinzel Decorative", "Cinzel", Georgia, serif',
    trSupport: 'ascii'
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    role: 'Klasik Sinema',
    category: 'Klasik Sinema & Sanatsal Başlıklar',
    css: '"Playfair Display", Georgia, "Liberation Serif", serif',
    trSupport: 'full'
  },
  {
    id: 'cormorant',
    label: 'Cormorant Garamond',
    role: 'Sanat Filmi',
    category: 'Klasik Sinema & Sanatsal Başlıklar',
    css: '"Cormorant Garamond", "Palatino Linotype", "Liberation Serif", Georgia, serif',
    trSupport: 'full'
  },
  {
    id: 'bodoni-moda',
    label: 'Bodoni Moda',
    role: 'Lüks / Moda Noir',
    category: 'Klasik Sinema & Sanatsal Başlıklar',
    css: '"Bodoni Moda", "Playfair Display", Georgia, serif',
    trSupport: 'full'
  },
  {
    id: 'syne',
    label: 'Syne',
    role: 'Avangart Indie',
    category: 'Klasik Sinema & Sanatsal Başlıklar',
    css: '"Syne", "Montserrat", "Liberation Sans", sans-serif',
    trSupport: 'full'
  },

  // 4. Senaryo, Daktilo & Analog Kayıt
  {
    id: 'special-elite',
    label: 'Special Elite',
    role: 'Eskitilmiş Daktilo',
    category: 'Senaryo, Daktilo & Analog Kayıt',
    css: '"Special Elite", "Courier Prime", "Courier New", monospace',
    trSupport: 'full'
  },
  {
    id: 'courier-prime',
    label: 'Courier Prime',
    role: '35mm Senaryo',
    category: 'Senaryo, Daktilo & Analog Kayıt',
    css: '"Courier Prime", "Courier New", "Liberation Mono", monospace',
    trSupport: 'full'
  },
  {
    id: 'vt323',
    label: 'VT323',
    role: 'VHS / Güvenlik OSD',
    category: 'Senaryo, Daktilo & Analog Kayıt',
    css: '"VT323", "JetBrains Mono", "Liberation Mono", ui-monospace, monospace',
    trSupport: 'full'
  }
]

const FONT_BY_ID = new Map(CINEMATIC_FONTS.map((f) => [f.id, f]))

export const FONT_MAP: Record<CreditFont, { label: string; css: string }> = {
  nosifer: { label: 'Nosifer', css: FONT_BY_ID.get('nosifer')!.css },
  creepster: { label: 'Creepster', css: FONT_BY_ID.get('creepster')!.css },
  butcherman: { label: 'Butcherman', css: FONT_BY_ID.get('butcherman')!.css },
  eater: { label: 'Eater', css: FONT_BY_ID.get('eater')!.css },
  'metal-mania': { label: 'Metal Mania', css: FONT_BY_ID.get('metal-mania')!.css },
  unifraktur: { label: 'UnifrakturMaguntia', css: FONT_BY_ID.get('unifraktur')!.css },
  'six-caps': { label: 'Six Caps', css: FONT_BY_ID.get('six-caps')!.css },
  bebas: { label: 'Bebas Neue', css: FONT_BY_ID.get('bebas')!.css },
  anton: { label: 'Anton', css: FONT_BY_ID.get('anton')!.css },
  'archivo-black': { label: 'Archivo Black', css: FONT_BY_ID.get('archivo-black')!.css },
  'black-ops': { label: 'Black Ops One', css: FONT_BY_ID.get('black-ops')!.css },
  'abril-fatface': { label: 'Abril Fatface', css: FONT_BY_ID.get('abril-fatface')!.css },
  'cinzel-decorative': {
    label: 'Cinzel Decorative',
    css: FONT_BY_ID.get('cinzel-decorative')!.css
  },
  playfair: { label: 'Playfair Display', css: FONT_BY_ID.get('playfair')!.css },
  cormorant: { label: 'Cormorant Garamond', css: FONT_BY_ID.get('cormorant')!.css },
  'bodoni-moda': { label: 'Bodoni Moda', css: FONT_BY_ID.get('bodoni-moda')!.css },
  syne: { label: 'Syne', css: FONT_BY_ID.get('syne')!.css },
  'special-elite': { label: 'Special Elite', css: FONT_BY_ID.get('special-elite')!.css },
  'courier-prime': { label: 'Courier Prime', css: FONT_BY_ID.get('courier-prime')!.css },
  vt323: { label: 'VT323', css: FONT_BY_ID.get('vt323')!.css },
  custom: { label: 'Özel Yüklenen Font', css: '"Inter", system-ui, sans-serif' },
  // Geriye dönük uyumluluk aliasları
  cinzel: { label: 'Cinzel', css: '"Cinzel", "Cinzel Decorative", Georgia, serif' },
  oswald: { label: 'Oswald', css: '"Oswald", "Six Caps", "Arial Narrow", sans-serif' },
  montserrat: { label: 'Montserrat', css: '"Montserrat", "Liberation Sans", sans-serif' },
  inter: { label: 'Inter', css: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
  cinema: { label: 'Sinema Serif', css: '"Cinzel", "Cinzel Decorative", Georgia, serif' },
  sans: { label: 'Modern Sans', css: '"Inter", system-ui, -apple-system, sans-serif' },
  serif: { label: 'Klasik Serif', css: FONT_BY_ID.get('playfair')!.css },
  mono: { label: 'Daktilo Mono', css: FONT_BY_ID.get('vt323')!.css },
  condensed: { label: 'Poster Condensed', css: FONT_BY_ID.get('bebas')!.css },
  display: { label: 'Manşet Display', css: FONT_BY_ID.get('anton')!.css },
  editorial: { label: 'Editoryal Serif', css: FONT_BY_ID.get('cormorant')!.css },
  grotesque: { label: 'Temiz Grotesque', css: '"Montserrat", "Liberation Sans", sans-serif' },
  handwriting: {
    label: 'El Yazısı Script',
    css: '"Brush Script MT", "Segoe Script", "URW Chancery L", cursive'
  },
  retro: { label: 'Retro Courier', css: FONT_BY_ID.get('courier-prime')!.css }
}

const TR_TO_ASCII_MAP: Record<string, string> = {
  Ğ: 'G',
  ğ: 'g',
  Ü: 'U',
  ü: 'u',
  Ş: 'S',
  ş: 's',
  İ: 'I',
  ı: 'i',
  Ö: 'O',
  ö: 'o',
  Ç: 'C',
  ç: 'c'
}

/** Türkçe özel harfleri (Ğ, Ü, Ş, İ, ı, Ö, Ç) ASCII karşılıklarına dönüştürür. */
export function toAsciiTurkish(text: string): string {
  return text.replace(/[ĞğÜüŞşİıÖöÇç]/g, (ch) => TR_TO_ASCII_MAP[ch] ?? ch)
}

/** Kredi metnini `autoAscii` ve büyük harf tercihine göre güvenli biçimde hazırlar. */
export function formatCreditText(text: string, autoAscii?: boolean, uppercase?: boolean): string {
  const step1 = autoAscii ? toAsciiTurkish(text) : text
  const step2 = uppercase ? (autoAscii ? step1.toUpperCase() : step1.toLocaleUpperCase('tr-TR')) : step1
  return autoAscii ? toAsciiTurkish(step2) : step2
}

/** Yüklenen özel font varsa öncelikli CSS `font-family` dizesini döndürür. */
export function resolveCreditFontCss(credit: Pick<CreditConfig, 'font' | 'customFont'>): string {
  if (credit.font === 'custom' && credit.customFont?.name) {
    const safeName = credit.customFont.name.replace(/["\\]/g, '')
    return `"${safeName}", "Inter", system-ui, sans-serif`
  }
  return FONT_MAP[credit.font]?.css ?? FONT_MAP.sans.css
}

/** Seçili fontun yalnızca İngilizce/ASCII glif ağırlıklı olup olmadığını döndürür. */
export function isAsciiRecommendedFont(font: CreditFont): boolean {
  return FONT_BY_ID.get(font)?.trSupport === 'ascii'
}

export function defaultCreditConfig(templateId: CreditTemplateId = 'noir-opening'): CreditConfig {
  const baseRows: CreditRow[] = [
    { id: 'r1', role: 'YÖNETMEN', name: 'Mehmet Ali' },
    { id: 'r2', role: 'GÖRÜNTÜ YÖNETMENİ', name: 'Deniz Kaya' },
    { id: 'r3', role: 'KURGU & RENK', name: 'NoirCut Studio' }
  ]

  switch (templateId) {
    case 'rolling-credits':
      return {
        templateId,
        title: 'NOIRCUT SUNAR',
        subtitle: '',
        rows: baseRows,
        font: 'montserrat',
        fontSize: 32,
        letterSpacing: 3,
        lineHeight: 1.3,
        textShadow: 35,
        color: '#F5F5F5',
        duration: 8,
        typewriter: false,
        filmWeave: false,
        sfxEnabled: true,
        sfxVolume: 65
      }
    case 'lower-third':
      return {
        templateId,
        title: 'MEHMET ALİ',
        subtitle: 'Yönetmen & Kurgucu',
        rows: baseRows,
        font: 'inter',
        fontSize: 34,
        letterSpacing: 2,
        lineHeight: 1.2,
        textShadow: 30,
        color: '#FFFFFF',
        duration: 5,
        typewriter: true,
        filmWeave: false,
        sfxEnabled: true,
        sfxVolume: 65
      }
    case 'chapter-card':
      return {
        templateId,
        title: 'BÖLÜM I',
        subtitle: 'Gecenin Başlangıcı',
        rows: baseRows,
        font: 'cinzel',
        fontSize: 52,
        letterSpacing: 8,
        lineHeight: 1.25,
        textShadow: 45,
        color: '#F5A623',
        duration: 4,
        typewriter: false,
        filmWeave: true,
        sfxEnabled: true,
        sfxVolume: 65
      }
    case 'standard-text':
      return {
        templateId,
        title: 'Buraya standart metninizi yazın',
        subtitle: '',
        rows: baseRows,
        font: 'inter',
        fontSize: 40,
        letterSpacing: 1,
        lineHeight: 1.25,
        textShadow: 45,
        color: '#FFFFFF',
        duration: 5,
        typewriter: false,
        filmWeave: false,
        sfxEnabled: false,
        sfxVolume: 65,
        textAlign: 'center',
        textPosition: 'center',
        uppercase: false
      }
    case 'noir-opening':
    default:
      return {
        templateId: 'noir-opening',
        title: 'GECE YARISI',
        subtitle: 'BİR NOIRCUT FİLMİ',
        rows: baseRows,
        font: 'cinzel',
        fontSize: 64,
        letterSpacing: 10,
        lineHeight: 1.2,
        textShadow: 50,
        color: '#FFFFFF',
        duration: 5,
        typewriter: false,
        filmWeave: true,
        sfxEnabled: true,
        sfxVolume: 65
      }
  }
}

export function cloneCreditConfig(c: CreditConfig): CreditConfig {
  return {
    ...c,
    rows: c.rows.map((r) => ({ ...r })),
    customFont: c.customFont ? { ...c.customFont } : undefined
  }
}

/** Daktilo efekti için toplam karakter sayısı ve belirli bir andaki görünür karakter sayısı */
export function creditTypewriterInfo(
  c: CreditConfig,
  localTime: number,
  duration: number
): { totalChars: number; visibleChars: number; titleLen: number; subtitleLen: number } {
  const titleLen = c.title.length
  const subtitleLen = c.templateId === 'rolling-credits' ? 0 : c.subtitle.length
  const totalChars = titleLen + subtitleLen
  if (!c.typewriter || totalChars === 0) {
    return { totalChars, visibleChars: totalChars, titleLen, subtitleLen }
  }
  const dur = Math.max(0.2, duration || c.duration)
  const writeWindow = dur * 0.7
  const p = Math.max(0, Math.min(1, localTime / writeWindow))
  const visibleChars = Math.min(totalChars, Math.floor(p * totalChars + 0.0001))
  return { totalChars, visibleChars, titleLen, subtitleLen }
}

/**
 * Kayan jenerik (Rolling Credits) için alt-piksel dikey titremesini (judder) ortadan kaldıran
 * tam sayı piksel-adım (integer pixel-per-frame) dikey kaydırma hesaplayıcısı.
 */
export function computeRollingCreditOffsetPx(
  localTime: number,
  duration: number,
  fps: number,
  totalDistancePx: number
): number {
  const safeFps = Math.max(1, Math.round(fps || 24))
  const totalFrames = Math.max(1, Math.round(Math.max(0.1, duration) * safeFps))
  const frameIndex = Math.max(0, Math.min(totalFrames, Math.round(localTime * safeFps)))
  const pixelsPerFrame = Math.max(1, Math.round(totalDistancePx / totalFrames))
  return Math.round(frameIndex * pixelsPerFrame)
}
