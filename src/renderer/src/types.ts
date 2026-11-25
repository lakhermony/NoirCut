export type Tab = 'CUT' | 'GRADE' | 'AUDIO' | 'SUBTITLES' | 'EXPORT' | 'CREDITS'

export type EditingTool = 'select' | 'blade' | 'trim' | 'slip' | 'roll'

export type ProxyPlaybackMode = 'auto' | 'proxy' | 'original'
export type ProxyResolutionScale = '1/2' | '1/4' | '1/8'

export type ThemeId =
  | 'noir-green'
  | 'monochrome'
  | 'midnight-blue'
  | 'tungsten'
  | 'noir-crimson'
  | 'nordic-iris'
  | 'frosted-sage'
  | 'arctic-blue'
  | 'bloodline'
  | 'obsidian-gold'
  | 'deep-forest'
  | 'ultraviolet'
  | 'vintage-cinema'

export interface ThemeOption {
  id: ThemeId
  label: string
  category: 'Dark' | 'Signature'
  subtitle?: string
  swatch: string
  swatches?: string[]
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'noir-green', label: 'NoirCut Lime', category: 'Dark', swatch: '#B7E36A' },
  { id: 'monochrome', label: 'Saf Monokrom', category: 'Dark', swatch: '#E5E5E5' },
  { id: 'midnight-blue', label: 'Gece Mavisi', category: 'Dark', swatch: '#38BDF8' },
  { id: 'tungsten', label: 'Sıcak Tungsten', category: 'Dark', swatch: '#D97706' },
  { id: 'noir-crimson', label: 'NoirCut Kırmızısı', category: 'Dark', swatch: '#E11D48' },
  {
    id: 'nordic-iris',
    label: 'Nordic Iris',
    category: 'Dark',
    swatch: '#748982',
    swatches: ['#748982', '#435453', '#8D947A']
  },
  {
    id: 'frosted-sage',
    label: 'Frosted Sage',
    category: 'Dark',
    swatch: '#A5CDBB',
    swatches: ['#7C918D', '#586F79', '#899A83', '#A5CDBB']
  },
  {
    id: 'arctic-blue',
    label: 'Arctic Blue',
    category: 'Signature',
    subtitle: 'Buz mavisi · Soğuk',
    swatch: '#8FAFCF',
    swatches: ['#8FAFCF', '#B8D8F2', '#628DB8']
  },
  {
    id: 'bloodline',
    label: 'Bloodline',
    category: 'Signature',
    subtitle: 'Bordo · Obsidyen',
    swatch: '#B83245',
    swatches: ['#B83245', '#D65365', '#8F2639']
  },
  {
    id: 'obsidian-gold',
    label: 'Obsidian Gold',
    category: 'Signature',
    subtitle: 'Bronz · Eskitilmiş Altın',
    swatch: '#C7A66A',
    swatches: ['#C7A66A', '#DEC18A', '#A8874D']
  },
  {
    id: 'deep-forest',
    label: 'Deep Forest',
    category: 'Signature',
    subtitle: 'Orman Yeşili · Zümrüt',
    swatch: '#36A783',
    swatches: ['#36A783', '#55C59F', '#278566']
  },
  {
    id: 'ultraviolet',
    label: 'Ultraviolet',
    category: 'Signature',
    subtitle: 'Mor · Elektrik Mavisi',
    swatch: '#9B7BDA',
    swatches: ['#9B7BDA', '#B69AEF', '#7859B7']
  },
  {
    id: 'vintage-cinema',
    label: 'Vintage Cinema',
    category: 'Signature',
    subtitle: 'Analog Film · Sepya',
    swatch: '#D9CFB8',
    swatches: ['#D9CFB8', '#EEE3CA', '#BBA987']
  }
]

export interface CreditsSettings {
  title: string
  style: 'Scroll' | 'Fade' | 'Cards'
  speed: number
  size: number
}
