/**
 * Hazır Sinematik Jenerik ve Metin Şablonları (CREDITS) veri modeli.
 */

export type CreditTemplateId =
  | 'rolling-credits'
  | 'noir-opening'
  | 'lower-third'
  | 'chapter-card'

export interface CreditRow {
  id: string
  role: string
  name: string
}

export type CreditFont = 'sans' | 'serif' | 'mono' | 'cinema'

export interface CreditConfig {
  templateId: CreditTemplateId
  /** Tekli başlık şablonları için ana başlık */
  title: string
  /** Tekli başlık şablonları için alt başlık / unvan */
  subtitle: string
  /** Rolling Credits için Rol / İsim satırları */
  rows: CreditRow[]
  font: CreditFont
  /** px (1280x720 referansında ölçeklenir) */
  fontSize: number
  /** px */
  letterSpacing: number
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
  }
]

export const FONT_MAP: Record<CreditFont, { label: string; css: string }> = {
  cinema: { label: 'Sinema Serif', css: 'Georgia, "Times New Roman", serif' },
  sans: { label: 'Modern Sans', css: 'Inter, system-ui, -apple-system, sans-serif' },
  serif: { label: 'Klasik Serif', css: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  mono: { label: 'Daktilo Mono', css: '"JetBrains Mono", ui-monospace, monospace' }
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
        font: 'sans',
        fontSize: 32,
        letterSpacing: 3,
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
        font: 'sans',
        fontSize: 34,
        letterSpacing: 2,
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
        font: 'cinema',
        fontSize: 52,
        letterSpacing: 8,
        color: '#F5A623',
        duration: 4,
        typewriter: false,
        filmWeave: true,
        sfxEnabled: true,
        sfxVolume: 65
      }
    case 'noir-opening':
    default:
      return {
        templateId: 'noir-opening',
        title: 'GECE YARISI',
        subtitle: 'BİR NOIRCUT FİLMİ',
        rows: baseRows,
        font: 'cinema',
        fontSize: 64,
        letterSpacing: 10,
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
    rows: c.rows.map((r) => ({ ...r }))
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
