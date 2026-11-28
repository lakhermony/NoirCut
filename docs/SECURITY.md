# NoirCut Güvenlik Modeli

## Electron `webPreferences`

`src/main/index.ts` içindeki ana `BrowserWindow` aşağıdaki güvenlik ayarlarıyla oluşturulur:

- `sandbox: true` — Preload betiği (`src/preload/index.ts`) yalnızca `contextBridge` ve `ipcRenderer` API'lerini kullanır; doğrudan Node.js yerleşik modüllerine (`fs`, `path`, `child_process`) ihtiyaç duymadığı için Chromium renderer sandbox'ı etkindir.
- `contextIsolation: true` — Renderer JavaScript bağlamı preload bağlamından izoledir; yalnızca `window.noircut` köprüsü üzerinden tanımlı IPC metotları açılır.
- `nodeIntegration: false` — Renderer tarafında Node.js erişimi kapalıdır.
- `webSecurity: true` — Varsayılan Electron/Chromium eş-köken (same-origin) koruması etkindir (`webSecurity: false` kullanılmaz).

## Chromium Süreç Sandbox'ı (Linux Paketleri ve Masaüstü)

- **Windows, macOS, Linux `.deb` ve `.rpm`:** Chromium süreç sandbox'ı **etkindir** (`package.json` içindeki genel `--no-sandbox` argümanı kaldırılmıştır). `electron-builder` Linux kurulum sonrası betiği (`after-install.tpl`) unprivileged user namespace desteği olmayan sistemlerde `/opt/NoirCut/chrome-sandbox` için `chmod 4755` (SUID), destekleyen sistemlerde `0755` uygular.
- **Linux `AppImage`:** AppImage tek dosya konteyneri SUID (`4755`) `chrome-sandbox` taşıyamadığı ve bazı dağıtımlar unprivileged user namespace'leri kısıtladığı için yalnızca `APPIMAGE` ortam değişkeni varken `no-sandbox` ve `disable-gpu-sandbox` uygulanır (`NOIRCUT_FORCE_SANDBOX=1` ile sandbox zorlanabilir).
- **Kabul edilen risk:** `AppImage` çalıştırılırken renderer veya GPU sürecinde bir güvenlik açığı bulunması halinde süreç izolasyonu zayıflar; bu nedenle güvenilmeyen uzak içerik yüklenmez (`will-navigate` ve `setWindowOpenHandler` ile dış gezinmeler engellenir).
- **GPU Sandbox:** `.deb`/`.rpm`/Windows/macOS'ta GPU sandbox etkindir; yalnızca AppImage'da veya `NOIRCUT_DISABLE_GPU_SANDBOX=1` (NVIDIA donanım video çözme uyumluluğu gerektiğinde) ile devre dışı bırakılır.

## Özel Medya Protokolü (`noircut-media://`)

- Yalnızca kullanıcının açıkça içe aktardığı veya uygulamanın ürettiği `approvedPaths` kümesindeki dosyalar sunulur; diğer tüm yollar `403 Forbidden` döndürür.
- `Access-Control-Allow-Origin` başlığı `*` yerine yalnızca uygulamanın kendi origin'iyle (geliştirmede `ELECTRON_RENDERER_URL` origin'i, üretimde `file://` / `null` veya `noircut-media://media`) sınırlandırılmıştır.

## IPC Girdi Doğrulaması

- `media:transcribe`: `mediaId` boş olmayan metin olmalı ve yalnızca `mediaRegistry` içindeki kayıtlı öğeler üzerinden çözümlenir.
- `project:archive`: `project` nesnesi doğrulanır; `mediaRefs` içindeki kaynak yollarının mutlak olması ve kopyalanan dosya adlarının hedef arşiv `media/` klasörü dışına çıkmaması (`basename` + `resolve` sınırı) denetlenir.
- `snapshot:save`: `dataUrl` yalnızca `data:image/png;base64,` önekiyle kabul edilir; `defaultName` dosya adı `basename` ve güvenli karakter filtresiyle temizlenir.
- `updater:check`, `updater:download`, `updater:quit-and-install`: renderer'dan herhangi bir argüman veya kaynak URL parametresi kabul edilmez (`assertNoUpdaterArgs`).

## Otomatik Güncelleyici Güvenlik Modeli (`electron-updater`)

- **Güncelleme kaynağı:** `lakhermony/NoirCut` GitHub Releases (`package.json` `build.publish` ve `src/main/updater-state.ts`).
- **Kullanıcı onayı:** `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowDowngrade = false`, `allowPrerelease = false`. İndirilen güncelleme uygulama kapanırken sessizce kurulmaz; yalnızca kullanıcının açıkça **"Yeniden Başlat ve Kur"** düğmesine basmasıyla kurulur.
- **Bütünlük ve İmza Sınırı:** Güncellemeler GitHub Releases'tan çekilir; bütünlük `latest*.yml` içindeki `sha512` özeti ile doğrulanır. Windows paketi şu an **kod imzalı değildir** (`signExecutable: false`); bu nedenle yayıncı doğrulaması yoktur.
