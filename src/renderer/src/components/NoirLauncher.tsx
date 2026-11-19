import { useEffect, useMemo, useState } from 'react'
import noircutLogo from '../assets/noircut-logo.png'
import type {
  AutosaveStatus,
  EngineInfo,
  RecentProjectEntry,
  UpdateStatus
} from '../../../shared/types'

const DEFAULT_CHANGELOG = [
  'Kesintisiz Çift Tamponlu Oynatma (Gapless Dual-Video Pre-roll): 1.5sn önceden gizli tampona kare hazırlama, sıfır siyah kare ile kesintisiz WebGL2 geçişi ve 12px hassas mıknatıs / sağ tık Boşluğu Kapat (Ripple Delete Gap).',
  'Çoklu Video & Ses Kanalları (V1..Vn, A1..An): kanallar arası sürükle-bırak geçişi, +V / +A dinamik kanal ekleme ve eşzamanlı üst video kompozisyonu.',
  'NoirCut Kırmızısı (NoirCut Crimson): karanlık oda safelight estetiğine uygun 5. stüdyo teması.',
  'NoirFilm Studio: 12 kategoride sinematik LUT kütüphanesi, 35mm/16mm/8mm dijital film emülasyonu, organik film greni ve yığılabilir Halation / Bloom / Diffusion / Mist ışık motorları.'
]

function detectWebGL2(): { ok: boolean; renderer: string } {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return { ok: false, renderer: 'Devre dışı' }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL2 GPU'
    return { ok: true, renderer }
  } catch {
    return { ok: false, renderer: 'Kullanılamıyor' }
  }
}

export default function NoirLauncher({
  open,
  engine,
  appVersion,
  recentProjects,
  hasActiveWork,
  onEnterStudio,
  onStartFreshStudio,
  onOpenProjectDialog,
  onOpenRecentProject,
  autosaveStatus = null,
  onRestoreAutosave,
  onDismissAutosave
}: {
  open: boolean
  engine: EngineInfo | null
  appVersion: string
  recentProjects: RecentProjectEntry[]
  hasActiveWork: boolean
  onEnterStudio: () => void
  onStartFreshStudio: () => void
  onOpenProjectDialog: () => void
  onOpenRecentProject: (path: string) => void
  autosaveStatus?: AutosaveStatus | null
  onRestoreAutosave?: (snapshotId: string) => void
  onDismissAutosave?: () => void
}) {
  const gpu = useMemo(() => detectWebGL2(), [])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    currentVersion: appVersion || '1.0.3',
    message: `NoirCut v${appVersion || '1.0.3'} — En güncel sürümü kullanıyorsunuz`
  })

  useEffect(() => {
    setUpdateStatus((prev) => ({
      ...prev,
      currentVersion: appVersion || prev.currentVersion
    }))
  }, [appVersion])

  useEffect(() => {
    if (!window.noircut?.onUpdateStatus) return
    return window.noircut.onUpdateStatus((status) => {
      setUpdateStatus(status)
    })
  }, [])

  if (!open) return null

  const versionLabel = `v${updateStatus.currentVersion || appVersion || '1.0.3'} Studio`
  const ffmpegReady = engine && engine.source !== 'missing'

  const handleCheckUpdates = async () => {
    if (!window.noircut?.checkForUpdates) return
    setUpdateStatus((prev) => ({
      ...prev,
      state: 'checking',
      message: 'Güncellemeler denetleniyor…'
    }))
    const res = await window.noircut.checkForUpdates()
    setUpdateStatus(res)
  }

  const handleDownloadAndInstall = async () => {
    if (updateStatus.state === 'downloaded') {
      await window.noircut?.quitAndInstallUpdate?.()
      return
    }
    if (!window.noircut?.downloadUpdate) return
    setUpdateStatus((prev) => ({ ...prev, state: 'downloading', progress: 0 }))
    const res = await window.noircut.downloadUpdate()
    if (!res.ok && res.error) {
      setUpdateStatus((prev) => ({
        ...prev,
        state: 'error',
        message: res.error
      }))
    }
  }

  const formattedCheckTime = updateStatus.lastCheckedAt
    ? new Date(updateStatus.lastCheckedAt).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'Henüz denetlenmedi'

  return (
    <div
      data-testid="noir-launcher-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#08090C]/92 p-6 backdrop-blur-xl"
    >
      <div className="glass relative grid w-full max-w-[1060px] grid-cols-12 gap-5 overflow-hidden rounded-[24px] border border-[color:var(--border-subtle)] bg-[#101114]/98 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.75)]">
        {/* SOL KOLON: Kimlik + Donanım Kontrolü + Güncelleme Merkezi */}
        <div className="col-span-12 flex flex-col justify-between gap-4 lg:col-span-5">
          {/* Kimlik */}
          <div className="soft-card flex flex-col gap-4 rounded-[20px] bg-[#1B1E24] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={noircutLogo}
                  alt="NoirCut Logo"
                  className="h-12 w-12 shrink-0 rounded-[12px] object-contain shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-[18px] font-bold tracking-[0.22em] text-[#F1F2EE]">
                      NOIRCUT
                    </h1>
                  </div>
                  <p className="text-[11px] text-[#9298A3]">
                    Cinema Darkroom · Edit, Grade & NoirFilm Lab
                  </p>
                </div>
              </div>
              <span
                data-testid="launcher-version-badge"
                className="rounded-full bg-[#242830] px-3 py-1 font-mono text-[10px] font-semibold text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
              >
                {versionLabel}
              </span>
            </div>

            {/* Sistem Donanım Kontrolü */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="inner-card rounded-[13px] bg-[#242830] px-3 py-2.5">
                <div className="flex items-center justify-between text-[9px] font-semibold tracking-wider text-[#9298A3]">
                  <span>WEBGL2 GPU</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      gpu.ok ? 'bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)]' : 'bg-rose-400'
                    }`}
                  />
                </div>
                <div
                  data-testid="launcher-gpu-status"
                  className="mt-1 text-[11px] font-semibold text-[#F1F2EE]"
                >
                  WebGL2 GPU: {gpu.ok ? 'Aktif' : 'Kapalı'}
                </div>
                <div className="truncate text-[9px] text-[#9298A3]" title={gpu.renderer}>
                  {gpu.renderer}
                </div>
              </div>

              <div className="inner-card rounded-[13px] bg-[#242830] px-3 py-2.5">
                <div className="flex items-center justify-between text-[9px] font-semibold tracking-wider text-[#9298A3]">
                  <span>FFMPEG MOTORU</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      ffmpegReady ? 'bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)]' : 'bg-amber-400'
                    }`}
                  />
                </div>
                <div
                  data-testid="launcher-ffmpeg-status"
                  className="mt-1 text-[11px] font-semibold text-[#F1F2EE]"
                >
                  FFmpeg Motoru: {ffmpegReady ? 'Hazır' : 'Kontrol Ediliyor'}
                </div>
                <div className="truncate text-[9px] text-[#9298A3]">
                  {engine?.version ? `v${engine.version} (${engine.source})` : 'Gömülü / Sistem'}
                </div>
              </div>
            </div>
          </div>

          {/* Güncelleme Denetimi (Update Center) */}
          <div
            data-testid="launcher-update-center"
            className="soft-card flex flex-1 flex-col justify-between gap-3 rounded-[20px] bg-[#1B1E24] p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                <span className="text-[11px] font-semibold tracking-wider text-[#F1F2EE] uppercase">
                  Güncelleme Merkezi
                </span>
              </div>
              <span className="font-mono text-[9px] text-[#9298A3]">
                Son Kontrol: {formattedCheckTime}
              </span>
            </div>

            <div className="rounded-[13px] bg-[#242830] px-3.5 py-2.5 text-[10.5px] text-[#F1F2EE]">
              {updateStatus.message || `NoirCut ${versionLabel} — En güncel sürümü kullanıyorsunuz`}
            </div>

            {(updateStatus.state === 'downloading' || updateStatus.state === 'downloaded') && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[9.5px] font-mono text-[#9298A3]">
                  <span>
                    {updateStatus.state === 'downloaded'
                      ? 'Güncelleme indirildi, kuruluma hazır'
                      : 'Güncelleme indiriliyor…'}
                  </span>
                  <span className="text-[var(--accent)]">
                    {Math.round(updateStatus.progress ?? 0)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#101114]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
                    style={{ width: `${Math.min(100, Math.max(0, updateStatus.progress ?? 0))}%` }}
                  />
                </div>
              </div>
            )}

            {/* Sürüm Notları (Changelog) */}
            <div className="inner-card flex-1 rounded-[13px] bg-[#101114]/70 p-3">
              <div className="mb-1.5 text-[9.5px] font-semibold tracking-wider text-[#9298A3] uppercase">
                Sürüm Notları ({updateStatus.latestVersion ? `v${updateStatus.latestVersion}` : versionLabel})
              </div>
              {updateStatus.releaseNotes ? (
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-[#9298A3]">
                  {updateStatus.releaseNotes}
                </p>
              ) : (
                <ul className="max-h-24 space-y-1 overflow-y-auto text-[10px] leading-snug text-[#9298A3]">
                  {DEFAULT_CHANGELOG.map((item, idx) => (
                    <li key={idx} className="flex gap-1.5">
                      <span className="text-[var(--accent)]">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="launcher-check-updates-btn"
                disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
                onClick={handleCheckUpdates}
                className="flex-1 rounded-full bg-[#242830] px-4 py-2 text-[10.5px] font-semibold text-[#F1F2EE] transition-all hover:bg-[#292E36] hover:text-[var(--accent)] disabled:opacity-45"
              >
                {updateStatus.state === 'checking'
                  ? 'Denetleniyor…'
                  : 'Güncellemeleri Denetle'}
              </button>

              {(updateStatus.state === 'available' ||
                updateStatus.state === 'downloading' ||
                updateStatus.state === 'downloaded') && (
                <button
                  type="button"
                  data-testid="launcher-download-install-btn"
                  disabled={updateStatus.state === 'downloading'}
                  onClick={handleDownloadAndInstall}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-[10.5px] font-semibold text-[var(--accent-fg)] shadow-[0_0_14px_var(--accent-glow)] transition-transform hover:scale-[1.02] disabled:opacity-50"
                >
                  {updateStatus.state === 'downloaded'
                    ? 'Yeniden Başlat ve Kur'
                    : 'İndir ve Yeniden Başlat'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SAĞ KOLON: Hızlı Başlangıç & Son Projeler */}
        <div className="soft-card col-span-12 flex flex-col justify-between gap-4 rounded-[20px] bg-[#1B1E24] p-5 lg:col-span-7">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                <span className="text-[11px] font-semibold tracking-wider text-[#F1F2EE] uppercase">
                  Hızlı Başlangıç
                </span>
              </div>
              {hasActiveWork && (
                <button
                  type="button"
                  onClick={onEnterStudio}
                  className="rounded-full bg-[#242830] px-3 py-1 text-[10px] font-medium text-[#9298A3] transition-colors hover:bg-[#292E36] hover:text-[#F1F2EE]"
                >
                  Stüdyoya Dön →
                </button>
              )}
            </div>

            {/* Çökme Kurtarma & Otomatik Yedek Bannerı */}
            {autosaveStatus?.hasUncleanExit && autosaveStatus.latest && onRestoreAutosave && (
              <div
                data-testid="autosave-recovery-banner"
                className="flex flex-wrap items-center justify-between gap-2.5 rounded-[16px] border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[var(--accent)]">
                    Kurtarılacak Oturum Bulundu
                  </div>
                  <div className="truncate text-[9.5px] text-white/80">
                    {autosaveStatus.latest.clipCount} klip · {autosaveStatus.latest.duration}s ·{' '}
                    {new Date(autosaveStatus.latest.savedAt).toLocaleTimeString('tr-TR')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onDismissAutosave && (
                    <button
                      type="button"
                      onClick={onDismissAutosave}
                      className="rounded-full border border-white/15 px-2.5 py-1 text-[9.5px] text-white/70 hover:text-white"
                    >
                      Yoksay
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="restore-autosave-btn"
                    onClick={() => onRestoreAutosave(autosaveStatus.latest!.id)}
                    className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-[var(--accent-fg)]"
                  >
                    Oturumu Kurtar
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                data-testid="launcher-enter-studio-btn"
                onClick={hasActiveWork ? onStartFreshStudio : onEnterStudio}
                className="group flex flex-col items-start justify-between gap-3 rounded-[16px] bg-[var(--accent)] p-4 text-left text-[var(--accent-fg)] shadow-[0_10px_30px_var(--accent-glow)] transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="rounded-full bg-[#101114]/15 px-2.5 py-0.5 font-mono text-[9px] font-bold">
                    STUDIO
                  </span>
                  <span className="text-[14px] transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
                <div>
                  <div className="text-[13px] font-bold">
                    {hasActiveWork ? 'Yeni Kurgu Başlat (Sıfırla)' : 'Yeni Kurgu Başlat (Enter Studio)'}
                  </div>
                  <div className="text-[10px] opacity-80">
                    EDIT, GRADE, AUDIO ve NoirFilm çalışma alanına geçin
                  </div>
                </div>
              </button>

              <button
                type="button"
                data-testid="launcher-open-project-btn"
                onClick={onOpenProjectDialog}
                className="group flex flex-col items-start justify-between gap-3 rounded-[16px] border border-[#343943] bg-[#242830] p-4 text-left text-[#F1F2EE] transition-all duration-150 hover:border-[var(--accent)]/60 hover:bg-[#292E36]"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="rounded-full bg-[#1B1E24] px-2.5 py-0.5 font-mono text-[9px] text-[#9298A3]">
                    .NOIRCUT
                  </span>
                  <span className="text-[14px] text-[#9298A3] group-hover:text-[var(--accent)]">
                    ↗
                  </span>
                </div>
                <div>
                  <div className="text-[13px] font-bold">.noircut Proje Dosyası Aç</div>
                  <div className="text-[10px] text-[#9298A3]">
                    Kayıtlı timeline, renk derecelendirme ve klipleri yükleyin
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Son Projeler Hızlı Erişim Kartları */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold tracking-wider text-[#9298A3] uppercase">
                Son Kaydedilen / Açılan Projeler
              </span>
              <span className="font-mono text-[9px] text-[#9298A3]">
                {recentProjects.length} Proje
              </span>
            </div>

            <div
              data-testid="launcher-recent-projects"
              className="grid flex-1 grid-cols-1 content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-2"
            >
              {recentProjects.length === 0 ? (
                <div className="col-span-2 flex h-36 flex-col items-center justify-center gap-1.5 rounded-[16px] border border-dashed border-[#343943] bg-[#101114]/45 px-4 text-center">
                  <span className="text-[11px] font-medium text-[#F1F2EE]">
                    Henüz son açılan proje kaydı yok
                  </span>
                  <span className="text-[9.5px] text-[#9298A3]">
                    Kaydettiğiniz veya açtığınız .noircut projeleri burada hızlı erişim kartı olarak görünür.
                  </span>
                </div>
              ) : (
                recentProjects.map((rp) => (
                  <button
                    key={rp.path}
                    type="button"
                    data-testid={`recent-project-${rp.name}`}
                    onClick={() => onOpenRecentProject(rp.path)}
                    className="inner-card group flex flex-col justify-between gap-2 rounded-[13px] border border-[#343943]/70 bg-[#242830] p-3 text-left transition-all duration-150 hover:border-[var(--accent)] hover:bg-[#292E36]"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-[11.5px] font-semibold text-[#F1F2EE] group-hover:text-[var(--accent)]">
                        {rp.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-[#1B1E24] px-2 py-0.5 font-mono text-[8px] text-[#9298A3]">
                        .noircut
                      </span>
                    </div>
                    <div className="truncate font-mono text-[9px] text-[#9298A3]" title={rp.path}>
                      {rp.path}
                    </div>
                    <div className="text-[8.5px] text-[#9298A3]/80">
                      {new Date(rp.openedAt).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </button>
                ))
              )}
            </div>

            {autosaveStatus && autosaveStatus.snapshots.length > 0 && onRestoreAutosave && (
              <div className="mt-1 space-y-1.5 border-t border-[#343943]/40 pt-2">
                <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-wider text-[#9298A3]">
                  <span>Otomatik Yedek Anlık Görüntüleri</span>
                  <span className="font-mono text-[8.5px]">{autosaveStatus.snapshots.length} kayıt</span>
                </div>
                <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
                  {autosaveStatus.snapshots.slice(0, 5).map((snap) => (
                    <button
                      key={snap.id}
                      type="button"
                      onClick={() => onRestoreAutosave(snap.id)}
                      className="rounded-full border border-[#343943] bg-[#242830] px-2.5 py-1 font-mono text-[8.5px] text-white/80 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {new Date(snap.savedAt).toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}{' '}
                      · {snap.clipCount} klip ({snap.duration}s)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[#343943]/50 pt-3 text-[9.5px] text-[#9298A3]">
            <span>Ctrl+O ile proje açın · Ctrl+S ile kaydedin</span>
            {hasActiveWork && (
              <button
                type="button"
                onClick={onEnterStudio}
                className="font-semibold text-[var(--accent)] hover:underline"
              >
                Aktif Çalışmaya Devam Et →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
