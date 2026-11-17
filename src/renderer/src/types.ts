export type Tab = 'CUT' | 'GRADE' | 'AUDIO' | 'EXPORT' | 'CREDITS'

export type ThemeId = 'noir-green' | 'monochrome' | 'midnight-blue' | 'tungsten' | 'noir-crimson'

export const THEME_OPTIONS: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'noir-green', label: 'NoirCut Lime', swatch: '#B7E36A' },
  { id: 'monochrome', label: 'Saf Monokrom', swatch: '#E5E5E5' },
  { id: 'midnight-blue', label: 'Gece Mavisi', swatch: '#38BDF8' },
  { id: 'tungsten', label: 'Sıcak Tungsten', swatch: '#D97706' },
  { id: 'noir-crimson', label: 'NoirCut Kırmızısı', swatch: '#E11D48' }
]

export interface CreditsSettings {
  title: string
  style: 'Scroll' | 'Fade' | 'Cards'
  speed: number
  size: number
}
