# NoirCut Güvenlik Modeli

## Electron `webPreferences`

`src/main/index.ts` içindeki ana `BrowserWindow` aşağıdaki güvenlik ayarlarıyla oluşturulur:

- `sandbox: true` — Preload betiği (`src/preload/index.ts`) yalnızca `contextBridge` ve `ipcRenderer` API'lerini kullanır; doğrudan Node.js yerleşik modüllerine (`fs`, `path`, `child_process`) ihtiyaç duymadığı için Chromium renderer sandbox'ı etkindir.
- `contextIsolation: true` — Renderer JavaScript bağlamı preload bağlamından izoledir; yalnızca `window.noircut` köprüsü üzerinden tanımlı IPC metotları açılır.
- `nodeIntegration: false` — Renderer tarafında Node.js erişimi kapalıdır.

## Özel Medya Protokolü (`noircut-media://`)

- Yalnızca kullanıcının açıkça içe aktardığı veya uygulamanın ürettiği `approvedPaths` kümesindeki dosyalar sunulur; diğer tüm yollar `403 Forbidden` döndürür.
- `Access-Control-Allow-Origin` başlığı `*` yerine yalnızca uygulamanın kendi origin'iyle (geliştirmede `ELECTRON_RENDERER_URL` origin'i, üretimde `file://` / `null` veya `noircut-media://media`) sınırlandırılmıştır.

## IPC Girdi Doğrulaması

- `media:transcribe`: `mediaId` boş olmayan metin olmalı ve yalnızca `mediaRegistry` içindeki kayıtlı öğeler üzerinden çözümlenir.
- `project:archive`: `project` nesnesi doğrulanır; `mediaRefs` içindeki kaynak yollarının mutlak olması ve kopyalanan dosya adlarının hedef arşiv `media/` klasörü dışına çıkmaması (`basename` + `resolve` sınırı) denetlenir.
- `snapshot:save`: `dataUrl` yalnızca `data:image/png;base64,` önekiyle kabul edilir; `defaultName` dosya adı `basename` ve güvenli karakter filtresiyle temizlenir.
