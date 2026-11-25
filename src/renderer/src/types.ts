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

export interface ThemeOption {
  id: ThemeId
  label: string
  category: 'Dark'
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
  }
]

export interface CreditsSettings {
  title: string
  style: 'Scroll' | 'Fade' | 'Cards'
  speed: number
  size: number
}
