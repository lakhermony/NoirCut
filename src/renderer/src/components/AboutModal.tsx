import { useEffect, useState } from 'react'
import logoUrl from '../assets/noircut-logo.png'

interface AboutModalProps {
  open: boolean
  onClose: () => void
}

type LicenseTab = 'gpl' | 'third-party'

export default function AboutModal({ open, onClose }: AboutModalProps): React.ReactElement | null {
  const [version, setVersion] = useState('1.0.6')
  const [tab, setTab] = useState<LicenseTab>('gpl')
  const [gplText, setGplText] = useState('')
  const [thirdPartyText, setThirdPartyText] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setCopied(false)
    void (async () => {
      try {
        const [ver, lic] = await Promise.all([
          window.noircut?.getAppVersion?.().catch(() => '1.0.6'),
          window.noircut?.getLicenseInfo?.().catch(() => null)
        ])
        if (cancelled) return
        if (ver) setVersion(ver)
        if (lic) {
          setGplText(lic.gplText)
          setThirdPartyText(lic.thirdPartyText)
        } else {
          setGplText('Lisans bilgisi yüklenemedi.')
          setThirdPartyText('Üçüncü parti bildirimleri yüklenemedi.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const activeText = tab === 'gpl' ? gplText : thirdPartyText

  const handleCopy = async () => {
    if (!activeText) return
    try {
      await navigator.clipboard.writeText(activeText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // yoksay
    }
  }

  return (
    <div
      data-testid="about-modal"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]/95 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
      >
        {/* Üst Bilgi: Logo, Sürüm, GPLv3 Özeti */}
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border-subtle)] px-6 py-5">
          <div className="flex items-center gap-4">
            <img
              src={logoUrl}
              alt="NoirCut Logo"
              className="h-14 w-14 rounded-xl border border-white/10 bg-black/50 object-contain p-1.5"
            />
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold tracking-wide text-white">NoirCut Studio</h2>
                <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]">
                  v{version}
                </span>
                <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-white/80">
                  GNU GPL v3 (GPL-3.0-only)
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Copyright © 2026 NoirCut Studio · Cinema Darkroom NLE Video Editor
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-white/65">
                Kaynak kodu <strong>GNU GPL v3</strong> ile lisanslıdır. Paketlenen FFmpeg/FFprobe
                ikilileri GPLv3 (<code className="text-white/80">--enable-gpl --enable-version3</code>)
                kapsamındadır. <strong>NoirCut</strong> adı ve özel logo/marka varlıkları yazarın
                münhasır mülkiyetindedir.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="about-close-btn"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 transition hover:border-white/25 hover:text-white"
          >
            Kapat
          </button>
        </div>

        {/* Sekme Çubuğu + Kopyala */}
        <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] bg-black/30 px-6 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="about-tab-gpl"
              onClick={() => {
                setTab('gpl')
                setCopied(false)
              }}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                tab === 'gpl'
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              GNU GPL v3 License
            </button>
            <button
              type="button"
              data-testid="about-tab-third-party"
              onClick={() => {
                setTab('third-party')
                setCopied(false)
              }}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                tab === 'third-party'
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              Third-Party &amp; FFmpeg Notices
            </button>
          </div>
          <button
            type="button"
            data-testid="about-copy-btn"
            onClick={() => void handleCopy()}
            disabled={loading || !activeText}
            className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 font-mono text-[11px] font-medium text-white/85 transition hover:border-[var(--accent)]/60 hover:text-white disabled:opacity-40"
          >
            {copied ? 'Kopyalandı ✓' : 'Kopyala'}
          </button>
        </div>

        {/* Kaydırılabilir Monospace Lisans Metni */}
        <div className="flex-1 overflow-y-auto bg-[#07080A] p-5">
          {loading ? (
            <div className="py-12 text-center font-mono text-xs text-white/50">
              Lisans metni yükleniyor...
            </div>
          ) : (
            <pre
              data-testid="about-license-viewer"
              className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/80 selection:bg-[var(--accent)]/30"
            >
              {activeText}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
