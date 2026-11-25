export const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
export const MAX_ZOOM = 8

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-md bg-white/[0.09] px-1.5 py-px font-mono text-[8px] font-semibold leading-tight text-white/70 shadow-[inset_0_-1px_0_rgba(0,0,0,0.45)]">
      {children}
    </kbd>
  )
}

export const SHORTCUT_GUIDE: { group: string; items: [string, string][] }[] = [
  {
    group: 'Oynatma',
    items: [
      ['Space', 'Oynat / Durdur'],
      ['J', 'Geri sar (1x → 2x)'],
      ['K', 'Durdur'],
      ['L', 'İleri oynat (1x → 2x → 4x)']
    ]
  },
  {
    group: 'Kurgu',
    items: [
      ['Ctrl+A', 'Tüm klipleri seç'],
      ['Esc', 'Seçimi temizle'],
      ['Boş Alanda Sürükle', 'Seçim kutusu (Marquee)'],
      ['Shift / Ctrl + Tık', 'Çoklu klip seç / çıkar'],
      ['C', "Playhead'den kes (Razor)"],
      ['Del', 'Seçili klip(ler)i sil'],
      ['Shift+Del', 'Ripple sil (boşluğu kapat)'],
      ['Klip Sürükle', 'Tekli veya grup taşı / Kenar trim'],
      ['M', 'Sahne işaretçisi ekle'],
      ['I / O', 'Giriş / Çıkış noktası'],
      ['Ctrl + Tekerlek', 'Timeline yakınlaştır / uzaklaştır'],
      ['Tekerlek / Alt + Tekerlek', "Timeline'ı sağa / sola kaydır"]
    ]
  },
  {
    group: 'Proje',
    items: [
      ['Ctrl+Z', 'Geri al'],
      ['Ctrl+Shift+Z', 'Yinele'],
      ['Ctrl+S', 'Projeyi kaydet'],
      ['Ctrl+O', 'Proje aç']
    ]
  }
]

export function shuttleLabel(rate: number, playing: boolean): string | null {
  if (!playing || rate === 0) return null
  if (rate < 0) return `<< ${Math.abs(rate)}x`
  return rate === 1 ? '1x' : `${rate}x >>`
}
