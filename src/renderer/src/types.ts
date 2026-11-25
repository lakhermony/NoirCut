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

export const THEME_OPTIONS: {
  id: ThemeId
  label: string
  swatch: string
  swatches?: [string, string, string]
}[] = [
  { id: 'noir-green', label: 'NoirCut Lime', swatch: '#B7E36A' },
  { id: 'monochrome', label: 'Saf Monokrom', swatch: '#E5E5E5' },
  { id: 'midnight-blue', label: 'Gece Mavisi', swatch: '#38BDF8' },
  { id: 'tungsten', label: 'Sıcak Tungsten', swatch: '#D97706' },
  { id: 'noir-crimson', label: 'NoirCut Kırmızısı', swatch: '#E11D48' },
  {
    id: 'nordic-iris',
    label: 'Nordic Iris',
    swatch: '#748982',
    swatches: ['#748982', '#435453', '#8D947A']
  },
  {
    id: 'frosted-sage',
    label: 'Frosted Sage',
    swatch: '#A5CDBB',
    swatches: ['#A5CDBB', '#7C918D', '#586F79']
  }
]

export interface CreditsSettings {
  title: string
  style: 'Scroll' | 'Fade' | 'Cards'
  speed: number
  size: number
}
