# NoirCut Kodbase İnceleme, Güvenlik Denetimi ve Geliştirme Yol Haritası

**Tarih:** 16 Kasım 2026  
**Sürüm:** `1.0.0` (`noircut`)  
**Kapsam:** Yalnızca okuma ve statik/diagnostik analiz (kod değişikliği yapılmadı).

---

## 1. Teknoloji Yığını ve Mimari Özeti

### 1.1 Tespit Edilen Teknoloji Yığını
`package.json`, `tsconfig.json`, `electron.vite.config.ts` ve `src/` incelemesinden doğrudan doğrulanan yığın:

- **Uygulama Kabuğu ve Otomatik Güncelleme:**
  - `electron` (`^45.3.2`)
  - `electron-updater` (`^6.8.11`)
- **Arayüz (Renderer) Framework ve Stil:**
  - **React** (`^19.3.1`, `react-dom ^19.3.1`), **TypeScript** (`^7.0.2`, `tsconfig.json` içinde `strict: true`).
  - **Tailwind CSS** (`^3.4.19`), **PostCSS** (`^8.5.33`), **Autoprefixer** (`^10.6.2`).
  - **Durum Yönetimi:** Harici durum kütüphanesi (Redux/Zustand vb.) yok; tüm uygulama durumu `src/renderer/src/App.tsx` içindeki React `useState` / `useRef` / `useCallback` kancaları ve prop aktarımı ile yönetiliyor. Yerel ayar/geçmiş kalıcılığı `window.localStorage` üzerinden (`noircut-theme`, `noircut-timeline-height`, `noircut.recentProjects.v1`, `noircut.noirfilm.mylooks.v1`, `noircut.noirfilm.favorites.v1`) yapılıyor.
- **Video / Ses İşleme ve Grafik Motoru:**
  - **Önizleme (Renderer):**
    - Chromium yerleşik `<video>` ve `<audio>` öğeleri (`src/renderer/src/hooks/usePlayer.ts`), ana süreçteki özel `noircut-media://` protokolü üzerinden `net.fetch` ile stream edilir (`src/main/media/media-service.ts`).
    - Gerçek zamanlı renk düzenleme için özel **WebGL2 GLSL ES 3.00** shader boru hattı (`src/renderer/src/lib/webgl-grade.ts`, `WebGLColorEngine`), WebGL2 başarısız olursa SVG `<feComponentTransfer>` / `<feColorMatrix>` yedeği (`src/renderer/src/components/Monitor.tsx`).
    - Dalga formu (`WaveformCanvas.tsx`), video skopları (`VideoScopes.tsx`), NoirFilm küçük önizlemeleri (`LookThumbnailCanvas.tsx`) ve jenerik dışa aktarma PNG kareleri (`credit-export.ts`) için **HTML5 2D Canvas**.
    - Jenerik sahnelerinde daktilo/projektör Foley sentezi için **Web Audio API** (`src/renderer/src/lib/foley-audio.ts`).
    - `ffmpeg.wasm` veya `WebCodecs` **kullanılmıyor**.
  - **Analiz, Proxy ve Dışa Aktarma (Main):**
    - Native **FFmpeg** ve **FFprobe**: Linux'ta `ffmpeg-static` (`^5.3.0`) ve `ffprobe-static` (`^3.1.0`), Windows'ta paketlenmiş `resources/bin/win/ffmpeg.exe`, yoksa sistem `PATH` (`src/main/engine/ffmpeg-engine.ts`, `src/main/export/export-service.ts`).
    - `fluent-ffmpeg` (`^2.1.3`) yalnızca probe (`probe`) ve küçük resim (`makeThumbnail`) için; dalga formu PCM çıkarımı (`extractPeaks`), proxy üretimi (`startProxyGeneration`) ve proje dışa aktarımı (`exportTimeline`) doğrudan `child_process.spawn` ile çalıştırılır.
- **Derleme ve Paketleme:**
  - **Derleme:** `electron-vite` (`^6.0.0`) + `vite` (`^8.3.8`) + `@vitejs/plugin-react` (`^6.3.0`). (`main`, `preload` ve `renderer` ayrı Vite hedefleri olarak `out/` altına derlenir.)
  - **Paketleme (`electron-builder ^26.18.0`):**
    - **Linux (`x64`):** `AppImage` (`build/icon.png`).
    - **Windows (`x64`):** `portable` ve `nsis` (`build/icon.ico`, `toolsets.nsis: "1.2.1"`, `signAndEditExecutable: false`, `extraResources` ile `resources/bin/win/ffmpeg.exe`).
    - **macOS (`darwin`):** `package.json` içinde `mac` hedefi tanımlı değil; yalnızca `src/main/index.ts:273-275` satırında standart `window-all-closed` kontrolü var (macOS derlemesi doğrulanmadı).

### 1.2 Mimari Özeti ve Süreç Sorumlulukları

| Süreç / Katman | Dosyalar | Sorumluluklar |
|---|---|---|
| **Main Process** | `src/main/index.ts`, `engine/ffmpeg-engine.ts`, `media/media-service.ts`, `media/media-probe.ts`, `export/export-service.ts`, `updater.ts` | Pencere yaşam döngüsü (`BrowserWindow`), 17 `ipcMain.handle` kanalı, `noircut-media://` protokolü ve `approvedPaths` erişim kontrolü, `ffprobe` analizi, thumbnail/PCM peak/H.264 proxy üretimi, `.noircut`/`.cube`/`.noirlook` dosya G/Ç, FFmpeg `-filter_complex` export, `electron-updater` yönetimi. |
| **Preload** | `src/preload/index.ts` | `contextBridge.exposeInMainWorld('noircut', api)` üzerinden 17 invoke metodu ve 4 main→renderer olay dinleyicisi (`media:opened`, `media:proxy-update`, `export:progress`, `updater:status`). |
| **Shared** | `src/shared/{timeline,color,noirfilm,credits,lut,foley-wav,project,types}.ts` | Main ve Renderer arasında paylaşılan veri tipleri, `evaluateColorGrade` / `bakeColorGradeToCube`, `evaluateFilmEmulationRgb`, `parseCubeLut`, `evaluateClipTransformAt` / `buildFfmpegKeyframeExpr`, `computeAutoDuckMultiplierAt`, WAV/Foley PCM sentezleyicisi. |
| **Renderer Process** | `src/renderer/src/{App,main}.tsx`, `hooks/`, `lib/`, `components/` | Başlatıcı (`NoirLauncher`), üst gezinme (`CommandIsland`), medya/LUT/şablon paneli (`LeftPanel`), WebGL2 monitör (`Monitor`), kurgu/renk/jenerik denetçisi (`RightPanel`), çok kanallı zaman çizelgesi (`Timeline`), renk stüdyosu (`GradeWorkspace` + `noirfilm/*` + `VideoScopes` + `ColorCurvesEditor` + `ColorWheel`), ses stüdyosu (`AudioWorkspace`), export (`ExportWorkspace` / `ExportModal`). |

**Proje Veri Modeli & Timeline Yapısı:**
- `.noircut` JSON formatı (`src/shared/project.ts`): `version: 1`, `mediaRefs`, `clips`, `lanes`, `customLuts`, `draftCredit`, `fallbackGrade`, `exportSettings`, `markers`, `stills`, `autoDucking`.
- 4 sabit kanal (`LANES` = `['V2', 'V1', 'A1', 'A2']`, `src/shared/timeline.ts:13-14`): `V2` jenerik/metin kaplaması, `V1` ana video (+ opsiyonel ayrılmamış gömülü ses), `A1` ve `A2` ses kanalları.
- **Önizleme → Export Hattı:** Önizleme gerçek zamanlı HTML `<video>` karesini WebGL2'ye yüklerken, export aşaması her klibin `ColorGrade`+`LUT`+`FilmEmulation` zincirini `bakeColorGradeToCube` ile 33³/65³ `.cube` LUT'a çevirip FFmpeg `lut3d` + ışık (`gblur`/`blend`), `scale`/`crop`/`pad`/`rotate`/`overlay`, `fade`, `amix` ve ses filtreleriyle tek komutta MP4/MOV'a işler.

### 1.3 Diagnostik Çalıştırma Sonuçları
- **`npm run typecheck` (`tsc --noEmit -p tsconfig.json`):** Başarılı (çıkış kodu `0`). `src/` altında `as any`, `: any` veya `@ts-*` baskılaması **yok**.
- **`npm audit`:** Toplam `478` paket (`43` prod, `436` dev). **6 orta (`moderate`)** düzey zafiyet bulundu; tamamı `devDependencies` içindeki `electron-builder` zincirindeki `minimatch` (`7.0.0 - 11.0.0` globparts amplified ReDoS) paketinden kaynaklanıyor (`@electron/universal`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows`). Üretim (`dependencies`) paketlerinde bilinen açık bildirilmedi.
- **Lint & Test Kapsamı:** `package.json` içinde `lint` veya `test` betiği ve repo içinde birim/entegrasyon/E2E testi **yoktur** (`src/` altında test dosyası bulunmadı). Çalışma zamanı GUI/FFmpeg export senaryoları kod incelemesi ve statik derleme üzerinden değerlendirilmiştir; canlı yürütme gerektiren yerler *"doğrulanmadı"* olarak işaretlenmiştir.

---

## 2. Güvenlik Bulguları

| # | Başlık | Konum | Açıklama | Etki | Önerilen Çözüm | Önem | Efor |
|---|---|---|---|---|---|---|---|
| S1 | Renderer sürecinde Chromium Sandbox kapalı | `src/main/index.ts:39` | `BrowserWindow` `webPreferences` içinde `sandbox: false` ayarlı (`contextIsolation: true`, `nodeIntegration: false` olsa da OS seviyesi Chromium sandbox devre dışı). | Renderer sürecinde olası bir motor/XSS açığında saldırganın sistem yüzeyine erişim bariyeri zayıflar. | `preload` zaten yalnızca `contextBridge` + IPC kullandığı için `sandbox: true` yapıp tüm preload işlevlerini test etmek. | Yüksek | S |
| S2 | IPC yol doğrulama eksikliği (`project:load-path`, `shell:reveal`, `file:saveText`) | `src/main/index.ts:143-145`, `148-170`, `254-257` | `project:load-path`, renderer'dan gelen herhangi bir dosya yolunu `.noircut` uzantısı veya izin listesi olmadan okuyup içindeki `mediaRefs` yollarını `importPaths()` ile `approvedPaths`'e ekleyebiliyor. `shell:reveal` de herhangi bir yolu `shell.showItemInFolder`'a iletiyor; `file:saveText` `args.extension` ve `defaultName`'i doğrulamıyor. | Ele geçirilmiş bir renderer (veya kötü niyetli `.noircut` projesi) diskteki keyfi dosyaları `approvedPaths` içine alıp protokol üzerinden okuyabilir veya dosya yöneticisini tetikleyebilir. | `project:load-path` için yalnızca `.noircut` uzantısı + son açılanlar listesi/varlık kontrolü; `mediaRefs` yüklenirken uzantı (`VIDEO_EXTENSIONS`/ses) kontrolü ve kullanıcı onayı; `shell:reveal` için `approvedPaths`/kayıtlı çıktı kontrolü; `file:saveText` için izinli uzantı beyaz listesi (`['noirlook', 'cube']`). | Yüksek | S |
| S3 | `noircut-media://` protokolünde `bypassCSP: true` ve `CORS *` | `src/main/media/media-service.ts:46-53`, `60-75` | `registerMediaScheme()` `bypassCSP: true` veriyor ve yanıtta `Access-Control-Allow-Origin: *` dönüyor. Ayrıca `protocol.handle` içinde `try/catch` ve dosya varlık kontrolü yok. | CSP zaten `media-src 'self' blob: noircut-media:` içerdiğinden `bypassCSP` gereksiz bir gevşetmedir; bozuk/silinmiş dosyada yakalanmayan protokol hatası oluşabilir. | `bypassCSP: false` yapmak, `CORS *` başlığını kaldırmak (veya origin ile sınırlamak), `protocol.handle` içinde `existsSync`/normalizasyon ve `try/catch` ile `404`/`500` yanıtı dönmek. | Orta | S |
| S4 | Doğrulanmamış JSON ayrıştırma (`.noircut` ve `.noirlook`) | `src/main/index.ts:214-227`, `src/shared/noirfilm.ts:820-837`, `src/renderer/src/App.tsx:1129-1142` | Proje ve look JSON'ları yalnızca `version === 1` ve `Array.isArray(clips)` kontrolüyle yükleniyor; `customLuts` boyut/dizi uzunluğu, sayısal sınırlar veya `__proto__` anahtarları doğrulanmıyor. | Bozuk veya manipüle edilmiş bir `.noircut`/`.noirlook` dosyası uygulamayı çökertebilir, bellek taşmasına (çok büyük LUT) veya UI hatalarına yol açabilir. | Şema doğrulayıcı (örn. `zod` veya sıkı manuel doğrulama) ekleyip tüm sayısal alanları (`duration`, `speed`, `lut.size`) sınırlamak. | Orta | S |
| S5 | CSP içinde `style-src 'unsafe-inline'` | `src/renderer/index.html:7` | `<meta http-equiv="Content-Security-Policy">` kuralında `style-src 'self' 'unsafe-inline'` tanımlı. | Olası bir DOM enjeksiyonunda satır içi stil enjeksiyonuna izin verir (ancak dinamik inline `style={{...}}` kullanımı nedeniyle pratik zorunluluk mevcut). | Mümkün olan stilleri CSS sınıflarına/CSS değişkenlerine taşıyıp CSP'yi sıkılaştırmak (orta/uzun vadede nonce veya CSP iyileştirmesi). | Düşük | M |
| S6 | Ortam değişkeni enjeksiyon/baypas kancaları | `src/main/index.ts:94-101`, `src/main/export/export-service.ts:81-83` | `NOIRCUT_EXPORT_OUT` kullanıcı kaydetme penceresini atlayıp verilen yola `-y` (üzerine yazma) ile çıktı yazar; `NOIRCUT_OPEN` açılışta onay olmadan medya yükler. | Yanlışlıkla veya harici bir betik tarafından tanımlı kalırsa onay olmadan dosya üzerine yazabilir. | Yalnızca geliştirme/test modunda (`!app.isPackaged` veya CLI flag) etkinleştirmek. | Düşük | S |
| S7 | `npm audit` bulguları (`minimatch`) ve FFmpeg GPL-3.0 lisans uyumu | `package.json:106-110, 121`, `node_modules/ffmpeg-static/package.json` | Build-time bağımlılıklarda 6 `moderate` `minimatch` zafiyeti mevcut. Üretimde paketlenen `ffmpeg-static` (`5.3.0`) ve Windows `resources/bin/win/ffmpeg.exe` GPL-3.0 (`libx264` dahil) lisanslıdır; paket içinde GPL lisans metni ve kaynak sunum bildirimi yoktur. | `minimatch` çalışma zamanını etkilemese de CI güvenlik taramalarında uyarı üretir; FFmpeg GPL-3.0 dağıtım kurallarına uyumsuzluk ticari/dağıtım hukuki riski doğurur. | `electron-builder` güncellemelerini takip edip `npm audit` temizlemek; dağıtım paketine (`extraResources`) FFmpeg/x264 `LICENSE` ve kaynak kodu bildirimlerini eklemek veya LGPL FFmpeg + harici/dinamik kodlayıcı stratejisini değerlendirmek. | Orta | M |

---

## 3. Sorun Listesi

### 3.1 Hatalar ve Mantık Sorunları

| # | Başlık | Konum | Açıklama | Etki | Önerilen Çözüm | Önem | Efor |
|---|---|---|---|---|---|---|---|
| B1 | Medya seçiminde tüm timeline'ın silinmesi | `src/renderer/src/App.tsx:323-331` | `useEffect` (`[lib.active, makeClip]`), `lib.active` değiştiğinde (`LeftPanel`'den başka bir medyaya tıklandığında) `setClips(m ? [makeClip(m, 'V1', 0)] : [])` çalıştırıyor. | Çok kanallı kurguda sol panelden başka bir videoya tıklamak tüm V1/V2/A1/A2 timeline'ını geri alınamaz biçimde (Undo'ya da yazmadan) siler. | Otomatik yerleştirmeyi yalnızca timeline boşken (`clips.length === 0`) ve ilk import'ta yapmak; mevcut medyaya tıklamayı ayrı "Kaynak Önizleme" veya sadece çift tık / "+ Timeline'a Ekle" eylemine bağlamak. | Kritik | S |
| B2 | Export'ta V1 çakışan kliplerde A/V senkron kayması | `src/main/export/export-service.ts:133-143`, `408`, `547-550` | V1 video klipleri `concat` filtresiyle arka arkaya ekleniyor: iki V1 klibi üst üste bindiğinde (`c.start < cursor`) ikinci klip kendi `c.start` anında başlamak yerine `cursor` sonuna itiliyor. Ses tarafı ise `adelay=${Math.round(c.start * 1000)}` kullanıyor. | Üst üste binen V1 kliplerinde (veya yanlışlıkla çakışan kesimlerde) görüntüler kayar, ses ile görüntü senkronu bozulur. | Zaman çizelgesi modelinde V1 çakışmasını baştan engellemek veya export'ta `trim` / `overlay` ile `c.start` hizalamasını korumak. | Kritik | M |
| B3 | Hızlı/Ters kliplerde Razor (`cut`) yanlış `in` noktası hesaplıyor | `src/renderer/src/App.tsx:479-509` | `cut()` sağ klip için `in: c.in + leftDur` yazıyor. Klibin `speed` değeri `%200` ise `leftDur` timeline saniyesi kaynak videoda `2 * leftDur` saniyeye karşılık gelir; `reverse: true` ise sol/sağ kaynak dilimleri ters olmalıdır. | Hızlandırılmış/yavaşlatılmış veya ters çevrilmiş klibi kesince sağ parça yanlış sahneden devam eder. | `speedFactor = Math.max(0.25, Math.min(4.0, (c.speed ?? 100) / 100))` ile `right.in = c.in + leftDur * speedFactor` hesaplamak; `reverse` açıkken `left.in = c.in + rightDur * speedFactor`, `right.in = c.in` uygulamak. | Kritik | S |
| B4 | `WaveformCanvas` klip `speed` ve `reverse` ayarlarını yoksayıyor | `src/renderer/src/components/WaveformCanvas.tsx:67-70` | `const srcSec = clip.in + localSec` hesaplanırken `clip.speed` ve `clip.reverse` kullanılmıyor. | Hızı değiştirilmiş veya ters çevrilmiş kliplerde dalga formu görseli sesle eşleşmez. | `localSec * speedFactor` kullanmak, `clip.reverse` iken kaynak penceresini sondan başa örneklemek. | Yüksek | S |
| B5 | NoirFilm görünümlerinde var olmayan `lutId` referansları | `src/shared/noirfilm.ts:482, 616, 677` vs `src/shared/lut.ts:191-347` | `NOIR_LOOKS` içindeki `'nf-horror-asylum'` (`matrix-noir`), `'nf-cold-nordic'` (`arctic-blue`) ve `'nf-indie-pastel'` (`fuji-eterna`) kimlikleri `BUILTIN_LUTS` içinde mevcut değil. | Kullanıcı bu 3 Noir Look şablonunu seçtiğinde 3D LUT aşaması sessizce `null` olur ve beklenen renk profili oluşmaz. | Eksik 3 LUT'u `BUILTIN_LUTS`'a eklemek veya mevcut eşleşen `BUILTIN_LUTS` ID'leriyle (`emerald-lab`, `nordic-thriller`, `vintage-film`) düzeltmek. | Yüksek | S |
| B6 | `cross-dissolve` geçişi export'ta Dip-to-Black olarak çıkıyor | `src/main/export/export-service.ts:396-403` vs `src/renderer/src/components/Monitor.tsx:145-160` | `cross-dissolve` seçildiğinde dahi export `fade=t=in:color=black` ve `fade=t=out:color=black` uyguluyor; önizleme de CSS `opacity` ile siyaha kararır. Gerçek iki klip arası `xfade` yok. | Kullanıcı "Cross Dissolve" seçtiğinde iki klip arasında erime yerine araya siyah kare girer. | Bitişik V1 klipleri arasında `xfade=transition=fade` (ve `acrossfade`) hattı kurmak ve önizlemede çift katmanlı opaklık harmanlaması yapmak. | Yüksek | M |
| B7 | `V1` veya `A1` Solo yapıldığında V2 jeneriklerin kaybolması | `src/main/export/export-service.ts:427`, `src/renderer/src/App.tsx:1328` | `isLaneAudible(lanes, 'V2')` kontrolü `lanes[id].solo` üzerinden çalışıyor; ses kanallarından (`A1`, `A2`, `V1`) biri `Solo` açıldığında `V2` görünmez oluyor. | Kurgucu ses dinlemek için `A1` kanalını Solo bırakıp export alırsa tüm başlıklar/jenerikler videodan silinir. | Görünürlük (`V2` için yalnız `!lanes.V2.muted`) ile ses işitilebilirliğini (`V1`/`A1`/`A2` için `isLaneAudible`) ayırmak. | Yüksek | S |
| B8 | Önizleme ile Export arasında renk, ışık, ses ve transform tutarsızlıkları | `webgl-grade.ts:136, 239`, `export-service.ts:173-285, 368-385, 524-559`, `usePlayer.ts:138-140`, `Monitor.tsx:163` | 1) WebGL Halation/Bloom/Mist efektleri ham `u_video`'dan (grade/LUT öncesi) örnek alırken FFmpeg export `lut3d` sonrası `gblur` uygular. 2) `pan` ve `audioPreset` (`denoise`, `bass-boost`) canlı önizlemede çalışmaz, sadece export'ta uygulanır. 3) Auto-Ducking export'ta `0.25s` rampa olmadan anlık kesme yapar. 4) V2 `typewriter` ve `filmWeave` titremesi export PNG'sinde statik son kare olarak çıkar. 5) `Monitor` transform yüzdesi kutu boyutuna, export çıktı boyutuna göre hesaplar. *(Tam piksel sapması canlı testle doğrulanmadı.)* | Önizlemede görülen/duyulan sonuç ile dışa aktarılan MP4/MOV arasında fark oluşur. | WebGL'i 2 geçişli (FBO) yapıp glow'u grade sonrası hesaplamak; Web Audio API ile canlı pan/filtre eklemek; export ducking ifadesine rampa ve `V2` için animasyonlu PNG/ASS desteği eklemek. | Yüksek | L |
| B9 | Proje yüklemede `nextId` sıfırlanması nedeniyle ID çakışması | `src/renderer/src/App.tsx:268`, `1123-1154` | `applyLoadedProjectResult` `nextId.current` sayacını güncellemeyip başlangıç değeri `100`'de bırakıyor. | Kayıtlı bir proje açılıp yeni klip/marker/still eklendiğinde `clip-100` gibi var olan bir ID yeniden üretilip mevcut klibi etkileyebilir. | Proje yüklendiğinde tüm `clips`, `markers`, `stills` ID'lerindeki en büyük sayısal soneki bulup `nextId.current = max + 1` yapmak veya `crypto.randomUUID()` kullanmak. | Orta | S |
| B10 | Undo/Redo geçmişinde eksik eylemler ve `stills` kaybı | `src/renderer/src/App.tsx:84-94, 593-663, 849-948` | `handleAddCreditToTimeline`, `handleSelectCreditTemplate`, `handleUpdateCredit`, `handleGrabStill`, `handleDeleteStill` `recordHistory` çağırmaz; `stills` `HistoryEntry` içinde tutulmaz. | V2 jenerik ekleme/düzenleme veya referans kare işlemleri `Ctrl+Z` ile geri alınamaz. | Tüm timeline/proje mutasyonlarını `recordHistory` kapsamına almak. | Orta | S |
| B11 | `applyNoirLookToGrade` önceki tekerlek/eğri/gren ayarlarını ezmiyor | `src/shared/noirfilm.ts:790-805` | `return { ...current, ... }` mevcut `lift`, `gamma`, `gain`, `offset`, `curves`, `hueVsSat`, `hueVsHue`, `halation`, `mist`, `filmGrain` alanlarını korur. | Bir look şablonundan diğerine geçerken önceki renk tekerleği veya klasik gren ayarı sızıp sonucu bozabilir. | Look uygularken `cameraProfile` (ve istenirse temel WB) hariç diğer renk katmanlarını sıfırlama veya "üzerine uygula / temiz uygula" seçeneği sunmak. | Orta | S |
| B12 | Tarih/zaman kodu formatında kare taşması riski ve `AudioWorkspace` imza uyumsuzluğu | `src/renderer/src/lib/format.ts:2-7`, `src/renderer/src/components/AudioWorkspace.tsx:338` vs `App.tsx:951` | `fmt(t, fps)` içinde `t` negatifse veya `t - Math.floor(t)` kayan nokta taşmasıyla `fps` değerine yakınsa `25` fps için `:25` basabilir. `AudioWorkspace` `onToggleAutoDucking(e.target.checked)` gönderirken `App.tsx` argümanı yoksayıp toggle yapıyor. | Zaman kodunda nadir kare taşması; `onToggleAutoDucking` imza tutarsızlığı. | `fmt`'yi `Math.round(Math.max(0, t) * fps)` toplam kare sayısından `floor`/mod ile hesaplamak; `handleToggleAutoDucking(next?: boolean)` imzasını hizalamak. | Düşük | S |

### 3.2 Performans ve Bellek

| # | Başlık | Konum | Açıklama | Etki | Önerilen Çözüm | Önem | Efor |
|---|---|---|---|---|---|---|---|
| P1 | Oynatma sırasında saniyede 60 kez tüm uygulama ağacının re-render edilmesi | `src/renderer/src/hooks/usePlayer.ts:171-221`, `src/renderer/src/App.tsx:273, 1414-1648` | `usePlayer` rAF döngüsünde her karede `setTime(nextT)` React state'i güncelliyor; bu tüm `App`, `Monitor`, `Timeline` (`1139` satır), `RightPanel` (`1217` satır) ve `VideoScopes` bileşenlerini 60Hz tetikler. | Uzun projelerde veya çok klipli timeline'da CPU kullanımı yükselir, UI takılır ve kare atlanır. | Playhead zamanını ref/store (dış abonelik) ile `20-30Hz` UI zaman kodu ve doğrudan DOM/Canvas (`playhead.style.transform`) güncellemesiyle ayırmak. | Yüksek | L |
| P2 | `VideoScopes` karesel CPU darboğazı ve çift tetiklenme | `src/renderer/src/components/VideoScopes.tsx:51-366` | `VideoScopes` hem `[time]` effect'i hem kendi rAF'ı ile aynı karede iki kez `96×54` (5.184 piksel) `getImageData` + JS `evaluateColorGrade` + binlerce `fillRect` + `setStats` çalıştırıyor; ayrıca skoplar WebGL efektlerini görmüyor. | Oynatma sırasında ana thread'i ciddi ölçüde meşgul eder; False Color / Halation / Vignette skopa yansımaz. | Skopları `10-15Hz` ile sınırlamak, `glCanvas` üzerinden örneklemek (veya WebGL histogram compute/downsample kullanmak), `ImageData` buffer ile tek `putImageData` çizimi yapmak ve `setStats`'ı throttle etmek. | Yüksek | M |
| P3 | Tek `<video>` / `<audio>` ile kesmelerde takılma, 350ms drift ve kaba ters oynatma | `src/renderer/src/hooks/usePlayer.ts:28-30, 89-92, 108-126` | Tek `<video>` elemanı `setAttribute('src') + load()` ile değiştiriliyor; wall-clock oynatma `drift > 0.35 * effectiveRate` olana dek video/ses ayrışmasına izin veriyor; `reverse` ve `J` modu her rAF'ta `el.currentTime` atıyor. | Klip geçişlerinde siyah kare/duraklama, 350ms'ye kadar ses-görüntü kayması ve geri sarmada dekoder kilitlenmesi yaşanır. | Çift `<video>` ön-tamponlama (A/B pre-roll), oynatma saati olarak birincil ses/video `currentTime` + Web Audio senkronu kullanmak; geri sarmayı keyframe aralıklı throttled seek ile sınırlamak. | Yüksek | L |
| P4 | WebGL2 shader maliyeti ve kare başı JS bellek tahsisleri | `src/renderer/src/lib/webgl-grade.ts:127-146, 231-247, 625, 674-698`, `Monitor.tsx:127` | Tüm ışık efektleri açıkken fragment shader piksel başına 120+ doku okuması yapar; `render()` her karede `JSON.stringify(grade.curves)` ve `new Float32Array(...)` tahsisi yapar; `Monitor.tsx` WebGL aktifken bile her grade değişiminde CPU'da `buildSvgGradeTables` hesaplar. | 4K videolarda GPU doluluk oranı yükselir, GC baskısı oluşur. | `Float32Array` buffer'ları sınıf alanında yeniden kullanmak; eğri değişimini referans/versiyon sayacıyla izlemek; WebGL aktifken `svgFilter` hesaplamasını atlamak; glow geçişini çeyrek/yarı çözünürlüklü FBO'da yapmak. | Orta | M |
| P5 | Sekme değişiminde WebGL2 motoru ve `<video>` öğesinin yok edilip baştan kurulması | `src/renderer/src/App.tsx:1414-1561`, `GradeWorkspace.tsx:215`, `Monitor.tsx:313-335` | `EDIT` ile `GRADE` arası geçişte `Monitor` unmount/remount olur; `WebGLColorEngine` shader'ı yeniden derlenir, LUT/Curve dokuları yeniden yüklenir ve `<video>` tekrar `load()` edilir. | Sekme geçişlerinde anlık kararma ve gecikme oluşur. | `Monitor` ve `<video>`/`WebGLColorEngine` katmanını ortak üst konteynerde sabit tutup yalnızca yan panelleri değiştirmek. | Orta | M |
| P6 | Timeline ve NoirLook küçük resim ölçeklenme maliyeti | `src/renderer/src/components/Timeline.tsx:902-1101`, `LookThumbnailCanvas.tsx:22-86` | Timeline tüm klipleri sanallaştırma olmadan DOM'a ve `WaveformCanvas`'a basar. `NoirLookLibrary` ilk açılışta 11+ look kartının her biri için `128×72` piksel CPU `evaluateColorGrade` döngüsü çalıştırır. | Yüzlerce klip içeren projelerde Timeline kaydırması ve 50+ özel look'ta GRADE sekmesi ağırlaşır. | Timeline için görünür zaman aralığına göre viewport clipping (`start + dur >= viewStart && start <= viewEnd`) uygulamak; look thumbnail üretimini Web Worker veya paylaşımlı WebGL pass + önbelleğe almak. | Orta | M |

### 3.3 Süreç Yönetimi ve Dayanıklılık

| # | Başlık | Konum | Açıklama | Etki | Önerilen Çözüm | Önem | Efor |
|---|---|---|---|---|---|---|---|
| R1 | Kayıtsız FFmpeg süreçleri, eşzamanlı export ve zombi süreç riski | `src/main/export/export-service.ts:49-62, 648-683`, `src/main/media/media-probe.ts:48-134`, `media-service.ts:145-240`, `index.ts:273-275` | `extractPeaks` ve `startProxyGeneration` süreçleri merkezi bir havuzda tutulmaz, iptal edilemez ve uygulama kapanırken (`before-quit`/`window-all-closed`) sonlandırılmaz. `exportTimeline` eşzamanlı çağrıyı kilitlemez; `cancelActiveExport()` Windows'ta `SIGTERM` sonrası exit beklemez. `makeThumbnail` hata durumunda `tmpdir()` JPEG dosyasını silmez. | Uzun/4K videolarda uygulama kapansa dahi arkada CPU/disk tüketen zombi `ffmpeg` süreçleri kalabilir; çift export tetiklenirse çıktı dosyası bozulur. | Main'de merkezi `ProcessRegistry` tutmak, `before-quit` sırasında tüm alt süreçleri (`SIGTERM` + Windows `taskkill` / `SIGKILL` timeout) temizlemek, `exportTimeline` için re-entrancy kilidi eklemek, `makeThumbnail` temizliğini `finally` bloğuna taşımak. | Yüksek | M |
| R2 | Bayat proxy önbelleği ve temizlenmeyen `tmpdir()` dizinleri | `src/main/media/media-service.ts:96-102, 151-163, 247` | Medya ID'si yalnızca dosya yolunun SHA-1 özetidir (`mtime`/`size` içermez). Aynı adla güncellenen video eski proxy'yi oynatır. `noircut-proxies` ve `noircut-soundscape` için boyut/yaş temizliği veya disk alanı kontrolü yoktur. | Güncellenen kaynak dosya eski önbellekten oynar; uzun kullanımda `/tmp` / `%TEMP%` şişer ve disk dolduğunda anlamlı hata verilmez. | Medya hash'ine `mtimeMs + size` (veya proxy dosya adına parmak izi) eklemek; başlangıçta eski geçici dosyaları temizlemek ve `statfs` ile boş disk alanı ön kontrolü eklemek. | Orta | S |
| R3 | Otomatik kayıt (Autosave) ve çökme kurtarma yok | `src/renderer/src/App.tsx:1082-1154`, `src/main/index.ts` | Yalnızca manuel `Ctrl+S` kaydı mevcut. Uygulama kapanırken kaydedilmemiş değişiklik uyarısı verilmiyor, geçici `.noircut` yedeği alınmıyor. | Ani kapanma veya çökmede tüm kurgu ve renk ayarları kaybolur. | `app.getPath('userData')` altına debounced autosave yazmak, pencere kapanışında kirli durum (`dirty`) kontrolü ve açılışta "Kurtarılsın mı?" akışı eklemek. | Yüksek | M |
| R4 | Çok uzun video / büyük medya belleğe ve UI'a yansıması | `src/main/media/media-probe.ts:74-134`, `src/main/export/export-service.ts:434-466` | 10 saatlik bir dosya için `extractPeaks` ~1.8 MB `Uint8Array` üretir (kabul edilebilir), ancak `export-service.ts` tüm V2 jenerik PNG'lerini `-loop 1 -t ${total}` ile tüm proje süresi boyunca decode edip zincirleme `overlay` uygular. Ayrıca V1 kesmelerde aynı kaynak `-i` ile tek sefer açılıp `split` olmadan birden fazla `trim` dalında kullanıldığında FFmpeg bellek tamponu büyüyebilir. | Çok uzun/çok V2 klipli projelerde export RAM tüketimi ve render süresi aşırı artar. | V2 jenerikleri için tüm proje süresi yerine yalnızca `[c.start, c.start+c.duration]` penceresi üretmek (`enable` ile) veya birden çok klibi tek katmanda birleştirmek. | Orta | M |

### 3.4 Platform, Paketleme, Kod Kalitesi ve Kullanılabilirlik

| # | Başlık | Konum | Açıklama | Etki | Önerilen Çözüm | Önem | Efor |
|---|---|---|---|---|---|---|---|
| K1 | Timeline klip taşıma ve kenar kırpma (trim) eksikliği | `src/renderer/src/components/Timeline.tsx:902-1101` | Klipler üzerinde yalnızca seçme ve Fade In/Out sürükleme tutamaçları var; kliplerin `start` veya `in`/`duration` değerleri timeline üzerinde sürüklenerek değiştirilemiyor. | Temel NLE kurgu akışı (boşluk kapatma, klip kaydırma, ince kesim) kısıtlı kalıyor. | Klip gövdesinde `start` sürükleme (snap destekli) ve sol/sağ kenarlarda `in`/`duration` trim tutamaçları eklemek. | Yüksek | L |
| K2 | Windows & Linux paketleme eksikleri (`signAndEditExecutable: false`, `desktopName`, ses import filtresi) | `package.json:46-95`, `src/main/media/media-service.ts:20, 304-307`, `src/main/updater.ts:93-104` | Windows'ta `wine` olmadan derleme için `signAndEditExecutable: false` seçilmiş; bu yüzden `win-unpacked/NoirCut.exe` kaynaklarında ikon/sürüm bilgisi ve kod imzası gömülmez. Linux'ta `desktopName` eksikliği uyarısı oluşuyor. Medya seçici yalnızca `mp4/mov/mkv` listeler (ayrı ses dosyaları varsayılan filtrede yok). `updater.ts` gerçek güncelleme hatasını yutup `isSimulated: true` ile "En güncel sürüm" gösterir. | Windows'ta imzasız executable SmartScreen uyarısı verir ve Explorer ikonunu gömmeyebilir; Linux'ta pencere-kısayol eşleşmesi zayıflar; kullanıcı WAV/MP3 müzik eklerken "Tüm Dosyalar"ı seçmek zorunda kalır; gerçek ağ hataları gizlenir. | Windows'ta gerçek imzalama + `signExecutable: false` (veya Windows CI runner'da `nsis` + `rcedit`), Linux'ta `desktopName`/`StartupWMClass` uyumu, dosya seçiciye ses uzantıları ekleme ve `updater.ts`'de simülasyonu gerçek ağ hatasından ayırma. | Orta | M |
| K3 | Kod tekrarları, dev bileşenler ve test eksikliği | `src/renderer/src/App.tsx` (1657 satır), `RightPanel.tsx` (1217 satır), `Timeline.tsx` (1139 satır), `ExportModal.tsx` vs `ExportWorkspace.tsx`, `RightPanel` vs `GradeWorkspace` vs `NoirControls` | Slider bileşeni 3 farklı yerde (`Slider`, `CompactSlider`, `NoirSlider`), Export UI 2 ayrı yerde (`ExportModal`, `ExportWorkspace`) tekrarlanıyor. `CreditsSettings` (`src/renderer/src/types.ts:12-17`) ölü tip olarak duruyor. `AudioWorkspace` statik VU metre kullanıyor. Linter ve test suite hiç yok. | Bakım maliyeti artar, düzeltilen bir hata ikiz bileşende kalır, regresyon yakalanmaz. | `App.tsx` durum mantığını özel hook/store'lara bölmek, ortak `UiSlider` ve tek `ExportPanel` bileşeninde birleştirmek, `eslint` + `vitest` (`shared/*` matematiği için unit testler) + Playwright Electron smoke testleri kurmak. | Orta | L |
| K4 | Kullanılabilirlik, yerelleştirme ve erişilebilirlik eksikleri | `src/renderer/src/App.tsx:455, 1105, 1126, 1148`, `Timeline.tsx:46-48, 915`, `NoirFilmPanel.tsx` | Hata bildirimlerinde engelleyici `window.alert()` kullanılıyor. Timeline kısayol rehberi `"Alt + Tekerlek"` derken tüm normal wheel olayları yatay kaydırma yapıyor; `Ctrl+Y` ve kare adım okları (`←`/`→`) eksik. Arayüz metinlerinde Türkçe ve İngilizce terimler karışık (`LOOK INTENSITY`, `Film Contrast`, `Ana Başlık`, `Stüdyo`). Timeline klipleri `<div>` olduğu için klavye odak/ARIA erişilebilirliği yok. | Ekran okuyucu ve klavye-yalnız kullanım zorlaşır, tutarsız kısayol/dil deneyimi oluşur. | `alert()` yerine uygulama içi modal/toast hatası koymak, kliplere `role="button"` + `tabIndex` + ok tuşlarıyla kare adım desteği eklemek ve i18n sözlüğüyle tutarlı dil sunmak. | Düşük | M |

---

## 4. Yeni Özellik Önerileri

### 4.1 Hızlı Kazanımlar (Quick Wins)

1. **Otomatik Kayıt (Autosave) ve Çökme Kurtarma** *(Efor: S-M)*
   - **Ne olduğu / Faydası:** Çalışma durumunu belirli aralıklarla arka planda diske kaydeder; elektrik/çökme sonrası tek tıkla kurtarma sağlar.
   - **Kodda nereye oturur:** `src/main/index.ts` (`app.getPath('userData')` altında `autosave.noircut` yaz/oku/sil IPC'leri), `src/preload/index.ts`, `src/renderer/src/App.tsx` (debounced `useEffect` + `beforeunload` kilidi + kurtarma modalı).
   - **Teknik yaklaşım:** Mevcut `NoirCutProject` JSON serileştirmesi yeniden kullanılır.
   - **Riskler:** Büyük `customLuts` dizileri disk I/O'yu yavaşlatabileceğinden yalnızca değişen durumda (`dirty` flag + 5 sn debounce) yazılmalıdır.

2. **Dışa Aktarma Ön Ayarları (Export Presets) ve İleri Codec Seçenekleri** *(Efor: S)*
   - **Ne olduğu / Faydası:** YouTube 4K, Reels/TikTok (9:16 60fps), Hafif Web/WhatsApp, Arşiv/ProRes (`.mov`), Yalnızca Ses (WAV/MP3) gibi tek tıkla profiller sunar.
   - **Kodda nereye oturur:** `src/shared/timeline.ts` (`ExportSettings` genişletmesi), `src/renderer/src/components/ExportWorkspace.tsx` & `ExportModal.tsx` (birleştirilebilir), `src/main/export/export-service.ts`.
   - **Teknik yaklaşım:** FFmpeg argüman eşlemesine (`prores_ks`, `libx264` CRF/bitrate, `-vn` ses-only) preset tablosu eklenir.
   - **Riskler:** `prores_ks` dosya boyutları çok büyük olacağından çıktı boyutu tahmini/uyarısı gösterilmelidir.

3. **In–Out Aralığını Dışa Aktarma (`Range Export`), Ripple Delete (`Shift+Del`) ve Kare Adımlama (`←`/`→`)** *(Efor: S)*
   - **Ne olduğu / Faydası:** Mevcut ama export'ta kullanılmayan `inPoint`/`outPoint` işaretleri (`App.tsx:222-223`) ile yalnızca seçili aralığı render almayı, boşluk bırakmadan klip silmeyi ve kare hassasiyetinde gezinmeyi sağlar.
   - **Kodda nereye oturur:** `src/renderer/src/App.tsx` (klavye kısayolları + ripple kaydırma), `src/shared/timeline.ts` (`ExportRequest.range`), `src/main/export/export-service.ts` (`-ss` / `-t` veya zaman kırpma).
   - **Teknik yaklaşım:** `deleteSelected` içine `ripple` parametresi eklenip aynı kanaldaki sonraki kliplerin `start` değerleri kaydırılır.
   - **Riskler:** Çoklu kanallı projede tek kanal ripple edilirken V1–A1/V2 senkronunun bozulmaması için senkron kilidi (Track Sync Lock) opsiyonu düşünülmelidir.

4. **Canlı Web Audio DSP & Gerçek Zamanlı VU / Loudness (LUFS) Ölçer** *(Efor: M)*
   - **Ne olduğu / Faydası:** `RightPanel` ve `AudioWorkspace`'teki `pan`, `denoise` ve `bass-boost` efektlerinin export beklenmeden canlı duyulmasını ve `AudioWorkspace`'teki statik VU çubuklarının gerçek ses seviyesini göstermesini sağlar.
   - **Kodda nereye oturur:** `src/renderer/src/hooks/usePlayer.ts`, `src/renderer/src/components/AudioWorkspace.tsx`.
   - **Teknik yaklaşım:** `videoRef`, `audioA1Ref`, `audioA2Ref` öğeleri `AudioContext.createMediaElementSource()` üzerinden `StereoPannerNode` → `BiquadFilterNode` (highpass/lowpass/lowshelf) → `GainNode` → `AnalyserNode` grafiğine bağlanır.
   - **Riskler:** Chromium'da `createMediaElementSource` her element için yaşamı boyunca yalnızca 1 kez çağrılabilir ve CORS gerekir (`noircut-media://` protokolü yerel akışta CORS uyumlu tutulmalıdır).

### 4.2 Orta Vadeli Hedefler

5. **Etkileşimli Timeline: Klip Sürükleme, Kenar Trim, Slip ve Sanallaştırma** *(Efor: L)*
   - **Ne olduğu / Faydası:** Kliplerin zaman çizelgesi üzerinde fareyle taşınması, başlangıç/bitiş kenarlarından kırpılması, mıknatıs (`snap`) hizalaması ve 500+ klipte akıcı kaydırma sağlar.
   - **Kodda nereye oturur:** `src/renderer/src/components/Timeline.tsx`, `src/renderer/src/App.tsx`.
   - **Teknik yaklaşım:** `PointerEvent` ile klip gövdesi (move) ve kenar (trim `in`/`duration`) sürükleme; sürükleme bitene kadar `recordHistory` coalescing; `scrollLeft` + `clientWidth` bazlı viewport sanallaştırma.
   - **Riskler:** `speedFactor` değişmiş kliplerin maksimum `duration` sınırı (`(media.duration - clip.in) / speedFactor`) doğru denetlenmelidir.

6. **Gerçek Çapraz Geçiş Motoru (`xfade` / `acrossfade` & Çift Katman WebGL Önizleme)** *(Efor: M)*
   - **Ne olduğu / Faydası:** `Cross Dissolve`, `Additive Dissolve`, `Wipe` gibi gerçek iki klip arası geçişleri hem canlı WebGL önizlemede hem export'ta birebir çalıştırır.
   - **Kodda nereye oturur:** `src/renderer/src/hooks/usePlayer.ts` (A/B `<video>`), `src/renderer/src/lib/webgl-grade.ts` (iki video dokusu harmanlayan geçiş shader'ı), `src/main/export/export-service.ts` (`xfade` & `acrossfade`).
   - **Teknik yaklaşım:** Geçiş bölgesinde önceki klibin sonu ile sonraki klibin başı WebGL2'de mix edilir; export'ta bitişik klipler `xfade` ile birleştirilir.
   - **Riskler:** `xfade` klibin toplam süresini geçiş süresi kadar kısalttığı için timeline zaman hesabı (`clip.start`/`duration`) ve ses `acrossfade` süreleri tutarlı tasarlanmalıdır.

7. **Genişletilmiş Keyframe Animasyonları (Renk + Ses + Metin) ve Görsel Grafik Editörü** *(Efor: M)*
   - **Ne olduğu / Faydası:** Şu anda yalnızca 5 Transform parametresinde (`scale`, `posX`, `posY`, `rotation`, `opacity`) bulunan keyframe sistemi; ses `gainDb`/`pan`, renk `exposure`/`saturation` ve V2 metin konumu için de animasyon eğrileri (Bezier/Ease) sunar.
   - **Kodda nereye oturur:** `src/shared/timeline.ts`, `src/renderer/src/components/RightPanel.tsx`, `src/renderer/src/hooks/usePlayer.ts`, `src/main/export/export-service.ts`.
   - **Teknik yaklaşım:** Mevcut `buildFfmpegKeyframeExpr` ve `evaluateTransformParamAt` mimarisi jenerik `KeyframeTrack<T>` yapısına genişletilir; ses için FFmpeg `volume=eval=frame` kullanılır.
   - **Riskler:** `lut3d` sabit bir küp olduğundan zamanla değişen renk parametreleri export'ta ek `eq`/`hue` veya kare-bazlı LUT değerlendirmesi gerektirir.

8. **Çok Kareli Filmstrip Önizleme, Akıllı Proxy Yönetimi ve Altyazı (SRT/VTT) Desteği** *(Efor: M)*
   - **Ne olduğu / Faydası:** V1 kliplerinde tek kare tekrarı yerine zaman koduna göre değişen gerçek video kare şeritleri, kullanıcı ayarlı proxy (tüm 4K klipler için opsiyonel 720p/1080p proxy anahtarı) ve `.srt`/`.vtt` altyazı içe/dışa aktarma desteği sunar.
   - **Kodda nereye oturur:** `src/main/media/media-probe.ts`, `src/main/media/media-service.ts`, `src/renderer/src/components/Timeline.tsx`, `src/main/export/export-service.ts` (`subtitles` / V2 dönüşümü).
   - **Teknik yaklaşım:** İçe aktarmada arka planda düşük çözünürlüklü sprite-sheet (`fps=1/2, scale=160:-2`) çıkarılır; proxy dosya adı `sha1(path + mtime + size)` ile sürüm kontrolüne alınır.
   - **Riskler:** `tmpdir()` disk tüketimini kontrol altında tutmak için LRU disk önbellek limiti eklenmelidir.

### 4.3 Büyük Hedefler

9. **GPU Donanım Hızlandırmalı Kodlama (NVENC / VAAPI / QSV / AMF) ve Çoklu Video Katmanı (V2/V3 Picture-in-Picture + Blend Modes + Maskeleme)** *(Efor: L)*
   - **Ne olduğu / Faydası:** Export hızını CPU `libx264`'e kıyasla katbekat artırır; birden çok video katmanını PiP, Screen/Overlay/Multiply harmanlama ve elips/dikdörtgen/serbest maskelerle (ör. yüz/gökyüzü ikincil renk düzeltmesi için Qualifier + Power Window) birleştirir.
   - **Kodda nereye oturur:** `src/main/engine/ffmpeg-engine.ts` (`ffmpeg -encoders` ile donanım kodlayıcı keşfi), `src/main/export/export-service.ts`, `src/renderer/src/lib/webgl-grade.ts` (çoklu doku + maske FBO pass), `src/shared/timeline.ts` (çoklu `V` kanalları).
   - **Teknik yaklaşım:** WebGL2'de Render-to-Texture (FBO) kompozisyon boru hattı kurulup `ExportWorkspace`'te donanım kodlayıcı seçici sunulur.
   - **Riskler:** Farklı GPU sürücülerinde (`VAAPI`/`NVENC`) FFmpeg filtre uyumu ve fallback testi gerektirir.

10. **Yerel Yapay Zekâ Otomatik Altyazı (Whisper Sidecar) ve Akıllı Sahne Algılama** *(Efor: L)*
    - **Ne olduğu / Faydası:** Videodaki konuşmaları tamamen çevrimdışı olarak metne döküp zaman kodlu `V2` altyazı klipleri oluşturur; sahne kesimlerini otomatik algılar.
    - **Kodda nereye oturur:** `src/main/media/media-probe.ts` (16kHz mono PCM çıkarımı hazır altyapısına benzer), yeni `src/main/ai/` sidecar yöneticisi, `src/renderer/src/App.tsx`.
    - **Teknik yaklaşım:** FFmpeg ile çıkarılan 16kHz PCM sesi yerel `whisper.cpp` veya ONNX Runtime alt sürecine verilip SRT/JSON zaman damgaları V2 kliplerine dönüştürülür.
    - **Riskler:** Model ağırlıklarının boyutu ve indirme/önbellek yönetimi ayrı bir kurulum akışı gerektirir.

11. **İç İçe Sekanslar (Compound / Nested Sequences) ve Playhead Mimarisi Ayrıştırması** *(Efor: L)*
    - **Ne olduğu / Faydası:** Karmaşık projelerde birden çok sahneyi alt sekanslara bölüp ana timeline içinde tek klip gibi kullanmayı ve kurgu performansını korumayı sağlar.
    - **Kodda nereye oturur:** `src/shared/project.ts` (`Sequence` veri modeli), `src/renderer/src/App.tsx`, `src/main/export/export-service.ts`.
    - **Teknik yaklaşım:** Proje modeli tek `clips` dizisi yerine `sequences: Record<string, Sequence>` yapısına taşınır; versiyon `1 -> 2` migration yazılır.
    - **Riskler:** Özyinelemeli sekans döngülerini engelleyen doğrulama ve `.noircut` v1 geriye dönük uyumluluk katmanı şarttır.

---

## 5. Önceliklendirilmiş Yol Haritası

Her aşama tek başına bağımsız bir geliştirme görevi olarak verilebilecek parçalara ayrılmıştır:

### Faz 1: Güvenlik, Veri Bütünlüğü ve Kritik Hatalar (Öncelik 1)
1. **Görev 1.1 — IPC & Protokol Sertleştirme:** `sandbox: true` geçişi (`src/main/index.ts`), `project:load-path`/`shell:reveal`/`file:saveText` yol ve uzantı doğrulaması, `noircut-media://` protokolünden `bypassCSP` ve wildcard CORS kaldırılması, `.noircut`/`.noirlook` şema doğrulaması.
2. **Görev 1.2 — Kritik Kurgu ve LUT Düzeltmeleri:** `App.tsx`'te `lib.active` değişince timeline'ın silinmesini durdurma; `cut()` fonksiyonunda `speed`/`reverse` `in` hesabı düzeltmesi; `WaveformCanvas` hız/ters düzeltmesi; `NOIR_LOOKS` içindeki eksik 3 LUT kimliğinin (`matrix-noir`, `arctic-blue`, `fuji-eterna`) çözülmesi; `V2` solo görünürlük ayrımı; `applyLoadedProjectResult` içinde `nextId` çakışma düzeltmesi.
3. **Görev 1.3 — Test ve Linter Altyapısı Kurulumu:** `eslint` + `vitest` kurulumu; `src/shared/*` (`color`, `timeline`, `lut`, `noirfilm`) için regresyon testleri ve CI/yerel kontrol betiği.

### Faz 2: Kararlılık, Süreç Yönetimi ve Performans (Öncelik 2)
4. **Görev 2.1 — FFmpeg Süreç Yaşam Döngüsü ve Önbellek Hijyeni:** Merkezi alt süreç kaydı (`export`, `proxy`, `peaks`), `before-quit` temizliği, tek eşzamanlı export kilidi, `makeThumbnail` hata temizliği, `mtime+size` tabanlı proxy anahtarı ve `tmpdir()` temizlik politikası.
5. **Görev 2.2 — Otomatik Kayıt (Autosave) & Çökme Kurtarma:** `userData/autosave.noircut` arka plan kaydı, kapanışta kaydedilmemiş değişiklik uyarısı, eksik `recordHistory` eylemlerinin tamamlanması (`stills`, `V2`, `lut`).
6. **Görev 2.3 — Oynatma ve UI Performansı Yenilemesi:** `usePlayer` `setTime` state'ini 60Hz tam-ağaç re-render yerine harici abonelik + throttled zaman koduna ayırma; `Monitor` bileşenini `EDIT`/`GRADE` geçişinde sabit tutma; `VideoScopes`'u throttle + tek `putImageData` + WebGL çıktısından örneklemeye geçirme; `WebGLColorEngine` FBO iki geçişli glow ve sıfır-tahsisli uniform güncellemesi; Timeline viewport sanallaştırma.

### Faz 3: Temel NLE & Ses/Renk Paritesi (Öncelik 3)
7. **Görev 3.1 — Etkileşimli Timeline Düzenleme:** Klip sürükleme (`start`), sol/sağ kenar kırpma (trim), Ripple Delete (`Shift+Del`) ve kare adım kısayolları (`←`/`→`).
8. **Görev 3.2 — Önizleme ↔ Export Ses ve Geçiş Paritesi:** Web Audio API ile canlı `pan` / `denoise` / `bass-boost` ve gerçek zamanlı VU metre; A/B video ön-tamponlama ile gerçek `cross-dissolve` (`xfade`/`acrossfade`) desteği; export auto-ducking `0.25s` rampa uyumu; export V2 animasyon paritesi; In–Out aralığı export desteği.
9. **Görev 3.3 — Paketleme & Kod Temizliği:** Ortak `UiSlider` ve tek `ExportPanel` birleştirmesi, `alert()` yerine toast/modal, FFmpeg GPL-3.0 lisans/notice dosyalarının pakete eklenmesi, Windows imzalama/ikon gömme akışı ve `updater.ts` gerçek hata ayrımı.

### Faz 4: Pro Özellikler ve Ölçeklenebilirlik (Öncelik 4)
10. **Görev 4.1 — GPU Donanım Kodlayıcıları (`NVENC`/`VAAPI`) + Export Preset'leri + Çoklu Video Katmanı / Maskeleme.**
11. **Görev 4.2 — Filmstrip Kare Şeridi + Genişletilmiş Keyframe Eğrileri + SRT/VTT Altyazı Sistemi.**
12. **Görev 4.3 — Yerel Otomatik Altyazı (Whisper Sidecar) ve İç İçe Sekanslar (`.noircut` v2).**
