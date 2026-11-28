export interface ChromiumFlagInput {
  platform: NodeJS.Platform
  isAppImage: boolean
  env: Record<string, string | undefined>
}

export interface ChromiumSwitch {
  name: string
  value?: string
}

export interface ChromiumFlagResolution {
  switches: ChromiumSwitch[]
  sandboxDisabledReason: string | null
}

/**
 * Chromium süreç sandbox ve GPU donanım çözme bayraklarını platform ve paket türüne göre belirler.
 *
 * - `.deb` / `.rpm` paketlerinde `electron-builder` (`after-install.tpl`) `chrome-sandbox` için
 *   gerektiğinde SUID (4755) ayarladığından `--no-sandbox` eklenmez; Chromium sandbox aktiftir.
 * - `AppImage` paketleri SUID binary taşıyamadığı ve bazı Linux dağıtımları unprivileged user
 *   namespace'leri kısıtladığı için yalnızca `APPIMAGE` ortamında `--no-sandbox` uygulanır
 *   (`NOIRCUT_FORCE_SANDBOX=1` ile zorla kapatılabilir).
 * - `disable-gpu-sandbox` yalnızca AppImage veya `NOIRCUT_DISABLE_GPU_SANDBOX=1` (NVIDIA
 *   donanım decode uyumluluğu) durumunda eklenir.
 */
export function resolveChromiumFlags(input: ChromiumFlagInput): ChromiumFlagResolution {
  const switches: ChromiumSwitch[] = []
  let sandboxDisabledReason: string | null = null

  if (input.platform === 'linux' && input.isAppImage) {
    if (input.env['NOIRCUT_FORCE_SANDBOX'] !== '1') {
      switches.push({ name: 'no-sandbox' })
      sandboxDisabledReason =
        'AppImage ortamında SUID chrome-sandbox bulunmadığı için Chromium sandbox devre dışı bırakıldı (NOIRCUT_FORCE_SANDBOX=1 ile etkinleştirilebilir).'
    }
    switches.push({ name: 'disable-gpu-sandbox' })
  } else if (input.platform === 'linux' && input.env['NOIRCUT_DISABLE_GPU_SANDBOX'] === '1') {
    switches.push({ name: 'disable-gpu-sandbox' })
  }

  switches.push({ name: 'ignore-gpu-blocklist' })
  switches.push({ name: 'enable-gpu-rasterization' })
  if (!input.env['NOIRCUT_SAFE_GPU']) {
    switches.push({ name: 'enable-zero-copy' })
  }
  switches.push({
    name: 'enable-features',
    value: 'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,UseChromeOSDirectVideoDecoder'
  })

  return { switches, sandboxDisabledReason }
}
