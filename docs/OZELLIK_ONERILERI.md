# NoirCut — Güncel Durum Analizi, Özellik Keşfi ve Yol Haritası

> **Kapsam ve Yöntem:** Bu doküman, `NoirCut` (`v1.0.0`, `v1` çekirdek kurgu geliştirmeleri sonrası güncel kod tabanı) kaynak dosyalarının doğrudan incelenmesine ve güncel 2026 rakip araştırmasına dayanır. Yalnızca kodda doğrudan gözlemlenen yetenekler listelenmiş, doğrulanamayan veya derleme/sürücü ortamına bağlı noktalar **"doğrulanmadı"** olarak işaretlenmiştir. Bu analiz sırasında kaynak kodda hiçbir değişiklik yapılmamıştır.

---

## Teknoloji Yığını ve Mimari Özeti

`package.json`, `electron.vite.config.ts` ve `src/` incelemesinden tespit edilen teknik mimari:

- **Masaüstü Çerçevesi ve Paketleme:** Electron `^45.3.2`, `electron-vite` `^6.0.0`, `vite` `^8.3.8`, TypeScript `^7.0.2`. Paketleme `electron-builder` `^26.18.0` (Linux `AppImage` x64, Windows `portable` & `nsis` x64) ve `electron-updater` `^6.8.11` ile yapılır.
- **Arayüz (Renderer) ve Durum Yönetimi:** React `^19.3.1`, Tailwind CSS `^3.4.19`, CSS değişkenleri tabanlı 4 tema (`noir-green`, `monochrome`, `midnight-blue`, `tungsten`). Harici bir state kütüphanesi (Redux/Zustand) bulunmaz; uygulama durumu `src/renderer/src/App.tsx` içinde React hook'ları, `stateSnapshotRef` ve 50 adımlı Undo/Redo yığını ile yönetilir. Yardımcı yerel kalıcılık (`localStorage`) tema, timeline yüksekliği, son projeler, `NoirFilm My Looks` ve yüklenen özel fontlar için kullanılır; proje otomatik yedekleri (`autosaves`) Electron ana sürecinde `userData` altına yazılır.
- **Önizleme Motoru:** `<video>` / `<img>` + gerçek zamanlı **WebGL2** shader boru hattı (`src/renderer/src/lib/webgl-grade.ts`, yedek olarak SVG filtreler), `V1`/`A1`/`A2` medya senkronizasyonu (`src/renderer/src/hooks/usePlayer.ts`), Web Audio API sentetik Foley motoru (`foley-audio.ts`), Canvas 2D ses dalgası (`WaveformCanvas.tsx`) ve gerçek zamanlı video scope'lar (`VideoScopes.tsx`).
- **Arka Plan Medya/Export Motoru (Main Process):** Gömülü `ffmpeg-static` (`^5.3.0`), `ffprobe-static` (`^3.1.0`), `fluent-ffmpeg` (`^2.1.3`) ve Windows paketleri için `resources/bin/win/ffmpeg.exe`. Medya analizi (`media-probe.ts`), proxy üretimi (`media-service.ts`), 4000 Hz PCM peak çıkarımı (`extractPeaks`), donanım kodlayıcı yoklaması (`ffmpeg-engine.ts`) ve `filter_complex` dışa aktarma (`export-service.ts`) yerel `spawn` alt süreçleriyle çalışır.
- **Güvenlik ve IPC:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `preload/index.ts` üzerinden tiplenmiş `window.noircut` köprüsü (`src/shared/types.ts`). Yerel dosyalar `noircut-media://` protokolü ve `approvedPaths` beyaz listesiyle sunulur.

---

## 1. Mevcut Durum Envanteri

| Alan | Yetenek / Bileşen | Durum | Kod Dayanağı ve Güncel Sınırları |
| :--- | :--- | :--- | :--- |
| **Medya İçe Aktarma** | Video, harici ses ve statik görsel alma | **Tam** | `VIDEO_EXTENSIONS` (`mp4, mov, mkv, webm`), `AUDIO_EXTENSIONS` (`mp3, wav, aac, flac, ogg, m4a`), `IMAGE_EXTENSIONS` (`png, jpg, jpeg, webp`). Ses dosyaları `A1`/`A2`'ye, görseller `V1`'e alınır (`media-probe.ts`, `media-service.ts`). |
| **Medya İçe Aktarma** | Otomatik uyumluluk Proxy üretimi | **Tam** | `H.264/VP8/VP9/AV1/Theora` ve uyumlu ses dışındaki videolar için geçici `1280px` H.264+AAC proxy üretilir (`media-service.ts`). |
| **Medya İçe Aktarma** | Gerçek PCM ses dalga formu (`peaks`) | **Tam** | 4000 Hz mono `s16le` PCM okuyup saniyede 50 tepe noktası çıkarır (`extractPeaks`, `WaveformCanvas.tsx`). |
| **Timeline** | Sabit 4 kanallı yapı (`V2`, `V1`, `A1`, `A2`) | **Kısmi** | `LANES` sabittir. `V2` yalnızca metin/jenerik (`CreditConfig`) tutar; dinamik kanal ekleme/silme, çok katmanlı video/PiP veya `V2` üzerine görsel/video bindirme yoktur. |
| **Timeline** | Klip sürükleme, sol/sağ kenar trim, Razor (`C`), Silme | **Tam** | `Timeline.tsx` (`startClipDrag`: yatay taşıma + canlı Snap kılavuz çizgisi, `trim-left` / `trim-right`), `C` ile playhead'den kesme, `fade` + `keyframes` bölme. |
| **Timeline** | Ripple Silme (`Shift+Del` / Ripple Modu) ve Boşluk Kapatma | **Tam** | `App.tsx` (`rippleDeleteSelected`, `closeGaps`). Yalnızca aynı kanal bazlı çalışır; kanallar arası genel `Sync Lock` veya `Roll/Slip/Slide` ince trim araçları yoktur. |
| **Timeline** | Sesi ayırma (`Detach Audio`), Snap, Zoom, Marker'lar | **Tam** | `V1 -> A1` ses ayırma, `0.5x–8x` zoom (`Ctrl+Tekerlek`), 5 renkli yönetmen notlu `Case Markers` (`M`), `50` adımlı Undo/Redo. |
| **Timeline** | `In` / `Out` işaretleme (`I` / `O`) | **Kısmi** | Cetvelde aralık gösterir ve **In–Out aralığı export** (`sliceClipsToRange`) destekler; ancak 3 noktalı `Insert/Overwrite` kurgu veya kaynak monitörü ön-kırpma yoktur. |
| **Transform & Hız** | Kadraj, Keyframe (`linear` / `ease-in-out`), Sabit Hız, Reverse | **Tam** | `scale`, `posX`, `posY`, `rotation`, `opacity`, `%25–%400` sabit hız ve ters oynatma canlıda ve FFmpeg export'ta çalışır. Monitör üstü sürüklenebilir gizmo, hareket yolu çizimi, Cubic-Bezier hız grafiği ve değişken hız rampası yoktur. |
| **Geçişler** | `cross-dissolve`, `dip-to-black` (`0.2–3.0s`) | **Kısmi** | Export'ta FFmpeg kararma uygular ve canlı monitörde basit opaklık düşüşü (`Monitor.tsx:145`) yapar; iki klip arası gerçek çift-dokulu cross-dissolve/wipe önizleme shader'ı veya zengin geçiş kütüphanesi yoktur. |
| **Renk & NoirFilm** | WebGL2 GPU renk motoru & **NoirFilm Studio** | **Tam** | Lift/Gamma/Gain/Offset, Auto WB + Damlalık, RGB/Luma Eğriler, Hue-vs-Hue/Sat, Log Profilleri, 19 LUT + `.cube`, 18 ön ayar, `35mm/16mm/8mm` emülasyon, gren, Halation/Bloom/Diffusion/Mist, `.noirlook` içe/dışa aktarma. Power Window şekil maskeleme, HSL seçici (Qualifier) ve Chroma Key yoktur. |
| **Monitör** | Video Scopes, False Color, Safe Frames, Karşılaştırma | **Tam** | Parade, Waveform, Vectorscope, Histogram (video ve görsellerde), False Color, `2.39:1 / 16:9 / 9:16`, Wipe & Tam Ekran karşılaştırma, Grab Still & Copy/Paste Grade. |
| **Ses** | Kanal Mute/Solo, Klip Gain/Pan/Fade, Auto-Ducking, Soundscape | **Tam** | `-60..+12 dB`, `-100..+100` pan, sürüklenebilir fade tutamaçları, `A2` `-11 dB` Auto-Ducking, 4 prosedürel `Noir Soundscape` WAV. |
| **Ses** | Audio FX (`denoise`/`bass-boost`) ve Canlı VU Metre | **Kısmi / İskelet** | Export'ta basit `highpass=85,lowpass=11500` (`denoise`) ve `bass=g=7` uygular; 5-bant EQ, kompresör, LUFS normalizasyonu ve AI ses izolasyonu yoktur. `AudioWorkspace.tsx:100` içindeki VU metre çubukları hâlâ sabit dizidir (`[52, 74, 90, 64, 82]`) — gerçek ses ölçmez (**İskelet**). |
| **Metin / Jenerik** | `CREDITS` (5 şablon, 20 font, `.ttf/.otf`, TR→EN Auto-ASCII, Glow) | **Tam** | `CreditOverlay.tsx` + `credit-export.ts` PNG bindirme, daktilo, gate weave, Foley SFX. Konuşmadan otomatik altyazı / `.srt` üretimi yoktur. |
| **Dışa Aktarma** | `ExportWorkspace`, Platform Presetleri, Kuyruk, GPU Probing | **Kısmi** | `1080p`, `4K`, `1080×1920`, `24/30/60fps`, `MP4/MOV` (ikisi de `libx264`), `YouTube 4K` / `Reels-TikTok-Shorts` / `Sinema 24p` / `Taslak` presetleri, In–Out aralığı export, sıralı Render Kuyruğu ve `NVENC/VAAPI/QSV/AMF` yoklaması + `libx264` fallback. (Gömülü `ffmpeg-static` yalnızca `libx264` içerdiği için GPU kodlama kullanıcının sistem `ffmpeg` ikilisine bağlıdır; **gerçek NVIDIA/AMD/Intel donanımında GPU kodlama bu ortamda doğrulanmadı**). ProRes ve ses-only (`.wav`/`.mp3`) export yoktur. |
| **Proje & Uygulama** | Launcher, Auto-Updater, Autosave/Kurtarma, 4 Tema | **Kısmi** | `.noircut` kaydet/aç, `userData/autosaves/` 8 sn debounce + son 10 anlık görüntü ve çökme kurtarma (`project-backup.ts`), `electron-updater`. Özelleştirilebilir kısayollar, Komut Paleti, Tercihler ekranı ve proje medya paketleme (Collect Media) yoktur. |

---

## 2. Piyasa ve Rekabet Araştırması

> **Kaynak Notu:** 2026 yılı itibarıyla 8 editör için güncel web araması yapılmış; resmî ürün açıklamaları ve topluluk (Reddit vb.) geri bildirim özetleri derlenmiştir. Her ürünün donanım özelindeki ayrıntılı karşılaştırmalı performans metrikleri bu cihazda bizzat benchmark edilmediği için **doğrulanmadı** kabul edilmelidir.

### Öne Çıkan Özellikler ve Kullanıcı Şikâyetleri

- **DaVinci Resolve:** Endüstri standardı renk derecelendirme (node yapısı, *Film Look Creator* halation/bloom/gate weave), Fusion VFX, Fairlight ses ve ücretsiz sürüm cömertliği ile öne çıkar. **Şikâyetler:** 16 GB altı RAM / zayıf GPU'larda takılma ve çökme eğilimi, dik öğrenme eğrisi ve büyük sürüm geçişlerindeki veritabanı kilitlenmeleri.
- **Adobe Premiere Pro:** Creative Cloud ekosistemi (After Effects/Audition dinamik bağlantı), Firefly destekli transkript tabanlı kurgu ve yapay zekâ konuşma iyileştirme ile liderdir. **Şikâyetler:** Sürekli abonelik maliyeti ("subscription fatigue"), arka plan şişkinliği ve büyük projelerde kararsızlık.
- **Apple Final Cut Pro:** *Magnetic Timeline*, Apple Silicon M-serisi optimizasyonu, tek seferlik satın alma ve v11 *Magnetic Mask* / *Transcribe to Captions* hızıyla bilinir. **Şikâyetler:** Sadece macOS kilidi ve çoklu platformlu ajans akışlarından izolasyon.
- **CapCut (Desktop):** Kısa dikey içerik için şablonlar, tek tıkla otomatik altyazı, dolgu kelimesi/sessizlik silme, arka plan kaldırma ve akıllı medya araması sunar. **Şikâyetler:** Temel özelliklerin "Pro" abonelik duvarı arkasına alınması, bulut tabanlı AI gizlilik endişeleri ve profesyonel renk/ses mimarisi yetersizliği.
- **Kdenlive:** Ücretsiz, açık kaynak (Linux/Windows/macOS), esnek çalışma alanı, proxy desteği, SAM2 nesne segmentasyonu, OTIO desteği ve yerel konuşma-metin modelleriyle öne çıkar. **Şikâyetler:** Çok kanallı ağır kurgularda periyodik arayüz aksaklıkları ve kararsızlık.
- **Shotcut:** Doğrudan FFmpeg üzerine kurulu hafif, kurulumsuz/taşınabilir yapı, kapsamlı ses/LUFS analizörleri ve doğrudan zaman çizelgesi yaklaşımı sunar. **Şikâyetler:** Tarihî ve katı UI/UX, karmaşık görsel geçişlerde performans düşüşü.
- **OpenShot:** Başlangıç dostu sade arayüz ve ücretsiz/açık kaynak erişim sunar. **Şikâyetler:** Python bağlamalarının yarattığı yüksek gecikme nedeniyle büyük projelerde hızlı performans duvarına çarpma, export çökmeleri ve proje bozulmaları.
- **Descript:** Videoyu metin dokümanı gibi düzenleme (*Text-Based Editing*) ve *Studio Sound* yapay zekâ ses temizliği ile konuşma odaklı pazarı yakalamıştır. **Şikâyetler:** Kare hassasiyetinde geleneksel NLE kesimi, çoklu kamera, derin renk düzenleme ve görsel katmanlamada hantal kalması.

### Çıkarımlar: Standart Beklenti vs. Farklılaştırıcılar vs. Ortak Şikâyetler
1. **Standart Beklenti:** Çoklu video/resim/ses katmanı (PiP), akıcı kesme/trim/ripple, gerçek canlı ses seviyesi ölçümü + EQ/kompresör, temel ses/video senkron kilidi ve kararlı autosave.
2. **Gerçek Farklılaştırıcılar:** Yerel/çevrimdışı AI araçları (CapCut'ın abonelik+bulut kilidine karşı yerel Whisper altyazı, sessizlik silme, RNNoise ses temizliği) ile DaVinci *Film Look Creator* ayarında organik sinematik görünüm (NoirCut'ın mevcut `NoirFilm Studio` + `20+` kült tipografisi tam burada güçlü bir avantaja sahiptir).
3. **Hafif Masaüstü Editörlerde En Çok Şikâyet Edilenler:** Katmanlı bindirme (PiP/B-roll) eksikliği, konuşma sesini temizlemek için dış yazılıma çıkma zorunluluğu, uzun videolarda kaba kurgu/altyazı otomasyonu olmaması ve kare-temelli geçiş/efekt önizleme uyuşmazlıkları.

---

## 3. Kullanıcı İş Akışları ve Kalan Sürtünme Noktaları

> **Not:** `v1` çekirdek kurgusuyla birlikte *klip taşıma, kenar trim, ripple silme, harici MP3/WAV/PNG/JPG içe aktarma, platform export presetleri, In–Out export, kuyruk ve autosave* çözülmüştür. Aşağıdaki sürtünmeler **güncel kodda hâlâ devam eden** tıkanmalardır.

### 1. Sosyal Medya İçerik Üreticisi (Kısa Dikey Video)
*Akış:* Video/görsel/ses alma → duraksamaları kesme → 9:16 dikeye kadrajlama → dikkat çekici kelime-kelime altyazı ve görsel B-roll/sticker bindirme → hızlı geçişler → Shorts/Reels/TikTok presetinde export.
1. **Otomatik & Kelime Vurgulu Altyazı Eksikliği:** Konuşmayı yazıya döküp ritmik, vurgulu sosyal medya altyazısı üreten araç yok; her cümle `V2`'de elle metin klibi gerektiriyor.
2. **Video Üstü Görsel/B-Roll/Sticker Katmanı (PiP) Olmaması:** Görseller ve videolar yalnızca ana `V1` kanalına konabildiği için ana videoyu kesmeden köşeye resim, ekran görüntüsü veya tepki videosu bindirilemiyor.
3. **Otomatik Dikey Odaklama (Auto-Reframe) Yokluğu:** Yatay (16:9) videoyu 1080×1920 dışa aktarırken konuşmacıyı sahne içinde takip edecek otomatik `posX` keyframe üretimi yok.

### 2. YouTuber (Uzun Format, Konuşma Ağırlıklı)
*Akış:* Uzun kamera + ekran kaydı alma → sessiz/hatalı yerleri hızla atma → B-roll/görsel bindirme → ses netleştirme (EQ/kompresör/LUFS) → bölüm kartları → hızlı export.
1. **Otomatik Sessizlik Kesme ve Transkriptten Kurgu Yokluğu:** 30–60 dakikalık konuşma videolarında nefes/duraksama boşluklarını tek tıkla tespit edip Ripple kesen araç olmadığı için kaba kurgu hâlâ elle kes-sil döngüsünde tıkanıyor.
2. **Konuşma Sesi İşleme ve Canlı Ölçüm Eksikliği:** `AudioWorkspace`'teki VU metreler statik ve dekoratif (`İskelet`); 5-bant EQ, kompresör, `-14 LUFS` YouTube normalizasyonu ve AI gürültü izolasyonu yok.
3. **B-Roll / Ekran Üstü Konuşmacı Katmanı Yokluğu:** `V1` tek video kanalı olduğundan anlatım sürerken üste B-roll videosu veya resim yerleştirilemiyor.

### 3. Kısa Film / Belgesel Yapımcısı
*Akış:* Çoklu kamera/çekim medyası → hassas sahne/diyalog kurgusu (J/L cut, Roll/Slip) → `NoirFilm Studio` ile ikincil maskeli renk derecelendirme → dış renkçi/mikser ile EDL/XML/OTIO paylaşımı → master çıktı.
1. **Roll / Slip / Slide ve Ses-Görüntü Senkron Kilidi Yokluğu:** `V1`–`A1` ayrıldıktan sonra iki klibin birbirine bağlı hareket etmesini sağlayan `Link/Sync Lock` ile diyaloğu kaydırmadan görsel kesimi kaydıran `Roll/Slip/Slide` araçları mevcut değil.
2. **İkincil Renk Maskeleme (Power Windows / Qualifier) ve Canlı Geçiş Önizleme Eksikliği:** NoirFilm yalnızca tüm kareye uygulanabiliyor (ör. sadece yüzü aydınlatma veya bir objeye sınırlama yok); ayrıca `cross-dissolve` geçişleri monitörde yan yana iki videoyu gerçekten harmanlamıyor.
3. **EDL / FCPXML / OTIO Alışverişi ve ProRes Master Yokluğu:** Kurguyu Resolve/Premiere'e taşımak için zaman çizelgesi dışa aktarma formatı yok; `MOV` konteyneri gerçek ProRes değil yalnızca H.264 yazıyor.

### 4. Müzik Videosu / Ses Ağırlıklı Proje Yapan Kişi
*Akış:* Master `.wav`/`.mp3` müzik alma → vuruş (beat) noktalarını çıkarma → performans kliplerini sese/çoklu açıya senkronlama → hız rampaları, dinamik flaş/blur geçişleri → canlı peak kontrolü → 60fps çıkış.
1. **Otomatik Ritim (Beat Marker) ve Çoklu Kamera Ses Senkronu (Multicam) Yokluğu:** Müzik artık içe aktarılabilse de vuruş noktalarını algılayan araç ve aynı şarkıyla çekilmiş farklı açıları ses dalgasından eşleyen Multicam/Auto-Sync yok.
2. **Hız Rampası (Speed Ramping) ve Dinamik Geçiş Kütüphanesi Yokluğu:** Kliplerde yalnızca sabit hız oranı var; tek klip içinde akıcı hızlanma/yavaşlama eğrisi ve zoom-blur/whip-pan/glitch tarzı canlı geçiş efektleri bulunmuyor.
3. **Canlı Master Peak/Clip Ölçümü ve Ses Kazancı Keyframe Zarfları Yokluğu:** VU metre çubukları gerçek sesi göstermediği için ses patlamaları görselden takip edilemiyor; müziğin belirli saniyelerinde keyframe tabanlı hacim otomasyonu (volume envelope) çizilemiyor.

### 5. Ders / Sunum Videosu Hazırlayan Eğitmen
*Akış:* Ekran/kamera kaydı alma → uygulama içi ek seslendirme (Voiceover) → slayt/konuşmacı PiP bindirme → önemli bölgeye monitör üstünden zoom/pan yapma → altyazı (`.srt` + gömülü) → export.
1. **Çok Katmanlı PiP ve Chroma Key Yokluğu:** Slaytların üzerine konuşmacı penceresini yerleştirecek ikinci video kanalı (`V2` video desteği) ve yeşil perde temizleyici yok.
2. **Uygulama İçi Ekran Kaydı ve Voiceover (Seslendirme) Eksikliği:** Ders içindeki hatalı bir cümleyi stüdyo içinden mikrofona yeniden okumak (Punch-in Record) veya doğrudan ekran yakalamak için dış programa çıkılıyor.
3. **Monitör Üstü Transform Gizmosu ve `.srt` Ders Altyazısı Yokluğu:** Ekrandaki bir kodu/grafiği büyütmek için monitörde kutu sürüklemek yerine sağ panelden `scale`/`posX`/`posY` sayıları deneniyor; LMS/YouTube için `.srt` üretilemiyor.

---

## 4. Özellik Adayları (28 Aday)

> Aşağıdaki 28 aday, `v1` çekirdek paketi tamamlandıktan sonraki **güncel boşlukları** hedefler.

### A. Timeline, Kurgu Yapısı ve Çoklu Katman

#### 1. Dinamik Çok Kanallı Timeline ve Video/Görsel PiP Katmanları (`V2+`, `A3+`)
- **Kullanıcıya Faydası:** Eğitmen (ekran + konuşmacı PiP), YouTuber (B-roll üst katmanı) ve sosyal medya üreticisinin (görsel/sticker bindirme) tek video kanalı tıkanmasını çözer.
- **Mevcut Koda Nasıl Oturacağı:** `src/shared/timeline.ts` (`LANES` yerine dinamik `tracks: TimelineTrack[]` + v1 `.noircut` otomatik dönüşümü), `Timeline.tsx`, `usePlayer.ts`, `Monitor.tsx`, `export-service.ts`.
- **Teknik Yaklaşım:** Renderer tarafında WebGL2 çok dokulu (multi-texture) veya sıralı FBO kompozitleme; Main export tarafında FFmpeg `overlay=x=...:y=...:enable='between(t,...)'` katman zinciri.
- **Riskler ve Bağımlılıklar:** Aynı anda 3–4 video akışının decode edilmesi Chromium belleğini zorlayabilir; yalnızca playhead penceresindeki aktif klipleri bağlayan havuz (pool) ve mevcut proxy mekanizması kullanılmalıdır.
- **Uygulama Eforu:** XL | **Kullanıcı Etkisi:** Yüksek

#### 2. Roll, Slip, Slide İnce Kurgu Araçları ve Link / Sync Lock
- **Kullanıcıya Faydası:** Kısa film ve belgesel kurgucularının diyaloğu bozmadan kesim kaydırmasını (J/L cut) ve bağlı video-ses kliplerini senkron taşımasını sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `Timeline.tsx` (araç seçici: `Select`, `Razor`, `Roll`, `Slip`, `Slide` + klip üstü kilit/bağ ikonu), `shared/timeline.ts` (`linkGroupId`), `App.tsx`.
- **Teknik Yaklaşım:** Saf TypeScript zaman/ofset matematiği; kaynak medya `[0, media.duration]` sınır kilidi ve görsel çift-kenar önizleme.
- **Riskler ve Bağımlılıklar:** `v1`'deki kenar trim ve taşıma altyapısı üzerine oturur; bağlı kliplerde `Ripple Delete` kurallarının net olması gerekir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 3. Compound Clip / Nested Sequence (Gruplanmış Alt Zaman Çizelgesi)
- **Kullanıcıya Faydası:** Karmaşık müzik videosu ve belgesel projelerinde birden fazla klibi tek bir blokta toplayıp ortak Transform/NoirFilm/Hız uygulamayı sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`CompoundDef` ve özyinelemeli klip referansı), `project.ts`, `Timeline.tsx` (sekme/breadcrumb ile içine girme), `export-service.ts`.
- **Teknik Yaklaşım:** Veri modelinde alt timeline düğümleri + FFmpeg tarafında özyinelemeli filtre grafiği derleme.
- **Riskler ve Bağımlılıklar:** Aday #1 (çoklu kanal) ile birlikte tasarlanmalıdır; döngüsel iç içe referanslar yasaklanmalıdır.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Orta

#### 4. Çoklu Kamera Senkronizasyonu (Multicam Sync — Ses Dalgasıyla Eşleme)
- **Kullanıcıya Faydası:** Müzik videosu, röportaj ve çok açılı YouTube çekimlerinde 2–4 kamerayı ses dalga formlarından otomatik hizalayıp tek tıkla açı değiştirmeyi sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `main/media/sync-service.ts`, `Monitor.tsx` (2x2 çoklu açı grid seçici), `Timeline.tsx` (açı kesimleri).
- **Teknik Yaklaşım:** Mevcut `extractPeaks` veya 8000 Hz PCM zarflarının çapraz korelasyon (FFT / sliding cross-correlation) ile zaman ofseti (`deltaT`) hesabı (tamamen yerel JS/Node veya hafif WASM).
- **Riskler ve Bağımlılıklar:** Aday #1 (çoklu video kanalı) altyapısına ihtiyaç duyar; senkron sonrası açı değişimleri `V1` kesimlerine dönüştürülebilir.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Orta

#### 5. Tam 3 Noktalı Kurgu (Kaynak Monitörü Ön-Kırpma + Insert / Overwrite)
- **Kullanıcıya Faydası:** Uzun belgesel ve ders ham kayıtlarından yalnızca seçili In–Out parçasını doğrudan playhead'e eklemeyi sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `LeftPanel.tsx` / `Monitor.tsx` (Source vs Program görünüm anahtarı), `App.tsx` (`insertAtPlayhead`, `overwriteAtPlayhead`).
- **Teknik Yaklaşım:** Saf React + mevcut `TimelineClip` `in`/`duration` oluşturucu.
- **Riskler ve Bağımlılıklar:** Mevcut `I`/`O` program timeline aralık seçimiyle karışmaması için "Kaynak" ve "Timeline" odak ayrımı net gösterilmelidir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 6. Ayar Katmanları (Adjustment Layer) ve Gelişmiş Marker Arama/Dışa Aktarma
- **Kullanıcıya Faydası:** Renk/NoirFilm look'unu veya animasyonlu kadrajı onlarca klibe tek tek kopyalamadan tek bir üst katmandan tüm zaman aralığına uygulamayı; işaretçileri sahne listesi/YouTube bölüm zaman damgası (Timestamps) olarak kopyalamayı sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`layerType: 'adjustment'`), `Timeline.tsx` (Marker paneli & YouTube `00:00 Giriş` kopyalama butonu), `export-service.ts`.
- **Teknik Yaklaşım:** Saf TS (`markers` -> YouTube Chapter metni kopyalama `S` efor) + çoklu kanal kompozitinde aktif alt video akışına grade uygulama.
- **Riskler ve Bağımlılıklar:** Ayar katmanının kendisi Aday #1'e bağlıdır; Marker YouTube Bölüm dışa aktarımı ise bağımsız bir hızlı kazanımdır.
- **Uygulama Eforu:** M (Ayar Katmanı) / S (Marker Chapter) | **Kullanıcı Etkisi:** Orta

---

### B. Animasyon, Görüntü, Renk ve Efektler

#### 7. Canlı Monitör Transform Gizmosu & SVG Hareket Yolu (Motion Path)
- **Kullanıcıya Faydası:** Eğitmen ve sosyal medya üreticilerinin zoom, PiP konumlandırma ve keyframe animasyonunu sayısal sürgüler yerine ekranda tutamaç sürükleyerek yapmasını sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `Monitor.tsx` (kutu seçim çerçevesi, köşe ölçek tutamacı, üst döndürme kolu, keyframe noktaları arası hareket çizgisi), `RightPanel.tsx`.
- **Teknik Yaklaşım:** Etkileşimli HTML/SVG overlay + `evaluateClipTransformAt` ile çift yönlü senkron.
- **Riskler ve Bağımlılıklar:** Damlalık (`wbPickerActive`) ve Wipe (`split`) modlarıyla pointer çakışması olmaması için aktif araç önceliği tanımlanmalıdır.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Yüksek

#### 8. Cubic-Bezier Keyframe Eğri Editörü (Velocity & Easing Graph)
- **Kullanıcıya Faydası:** Müzik videosu ve hareketli grafiklerde `linear` ve `ease-in-out` dışına çıkıp tok sıçrama/frenleme hareketleri oluşturmayı sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`cubicBezier` kontrol noktaları + `ease-in`/`ease-out`/`hold`), `RightPanel.tsx` (mini SVG eğri düzenleyici), `buildFfmpegKeyframeExpr`.
- **Teknik Yaklaşım:** Renderer ve `buildFfmpegKeyframeExpr` içine parametrik polinom/kübik Bezier değerlendirici (`if/pow` ifadeleriyle FFmpeg uyumlu).
- **Riskler ve Bağımlılıklar:** FFmpeg ifade motorunun karmaşık iteratif Newton-Raphson çözememesi nedeniyle zaman-örneklemeli veya kapalı form güç eğrileri (`easeInCubic`, `easeOutBack` yaklaşıklıkları) tercih edilmelidir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 9. Hız Rampası (Speed Ramping — Zaman Yeniden Eşleme)
- **Kullanıcıya Faydası:** Müzik videosu ve aksiyon/reels sahnelerinde tek klip içinde akıcı hızlanma ve ağır çekim geçişleri üretir.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`speedKeyframes`), `Timeline.tsx` (hız eğrisi görünümü), `usePlayer.ts`, `export-service.ts`.
- **Teknik Yaklaşım:** Zaman-hız eğrisinin sayısal integrali ile kaynak zaman haritası; FFmpeg'de değişken `setpts` ve isteğe bağlı `minterpolate` kare üretimi.
- **Riskler ve Bağımlılıklar:** Değişken hızlı akışta ses perde kayması ve `<video>` seek takılmaları olmaması için önizlemede pürüzsüz hız güncellemesi ve seste koruma/ayırma gerekir.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Yüksek

#### 10. Canlı Önizlemeli Zengin Geçiş Kütüphanesi (Cross-Dissolve Blend, Whip Pan, Zoom Blur, Glitch, Luma Wipe)
- **Kullanıcıya Faydası:** Sosyal medya ve müzik videosu editörlerine dinamik sahne geçişleri kazandırır ve şu an yalnızca çıkışta tam harmanlanan geçişlerin monitörde de gerçek zamanlı izlenmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `usePlayer.ts` (geçiş aralığında iki aktif `V1` klibi için çift video/buffer besleme), `webgl-grade.ts` (çift-dokulu geçiş GLSL shader'ları), `export-service.ts` (FFmpeg `xfade` eşleşen modlar).
- **Teknik Yaklaşım:** WebGL2 iki-girişli fragment shader (önizleme) + FFmpeg `xfade` (export).
- **Riskler ve Bağımlılıklar:** Geçiş penceresinde iki videonun eşzamanlı decode edilmesi için ikincil gizli `<video>` tamponu (pre-roll buffer) gereklidir.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Yüksek

#### 11. Power Windows Şekil Maskeleme & İkincil Renk Seçici (HSL Qualifier)
- **Kullanıcıya Faydası:** Kısa film ve NoirFilm kullanıcılarının yalnızca öznenin yüzünü aydınlatıp arka planı karartmasını veya tek bir rengi (ör. Noir kan kırmızısı) izole etmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/color.ts` (`masks` + `hslQualifier`), `webgl-grade.ts` (GLSL iç/dış maske karıştırma), `GradeWorkspace.tsx`, `export-service.ts`.
- **Teknik Yaklaşım:** WebGL2 shader maskeleme (önizleme) + FFmpeg `geq` alfa maske & iki ayrı `lut3d` akışını birleştiren `maskedmerge` (export).
- **Riskler ve Bağımlılıklar:** Tek `.cube` dosyası uzamsal maske taşıyamadığından FFmpeg çıkışında maskeli klipler için 2 geçişli renk harmanı kurulmalıdır.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Yüksek

#### 12. Chroma Key (Yeşil/Mavi Perde) & Luma Key
- **Kullanıcıya Faydası:** YouTuber ve eğitmenlerin yeşil perde arkasını şeffaf yapıp sunum/sahne üzerine yerleşmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `RightPanel.tsx`, `webgl-grade.ts` (GLSL renk mesafesi + spill giderme), `export-service.ts` (FFmpeg `chromakey`/`despill`).
- **Teknik Yaklaşım:** WebGL2 YUV/RGB chroma key shader + FFmpeg `chromakey` filtresi.
- **Riskler ve Bağımlılıklar:** Alt video katmanının görünebilmesi için Aday #1 (çoklu video kanalı) önkoşuludur.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 13. Video Stabilizasyon (Sarsıntı Giderme)
- **Kullanıcıya Faydası:** Elde çekilmiş kısa film, vlog ve belgesel çekimlerindeki titreşimi giderir.
- **Mevcut Koda Nasıl Oturacağı:** `main/media/stabilize-service.ts`, `RightPanel.tsx`, `export-service.ts`.
- **Teknik Yaklaşım:** FFmpeg `vidstabdetect` + `vidstabtransform` (veya gömülü `ffmpeg-static` içinde `libvidstab` yoksa — bu derlemede mevcut olup olmadığı **doğrulanmadı** — `deshake` / hafif WASM optik akış analizi + stabilize önbellek dosyası).
- **Riskler ve Bağımlılıklar:** İki geçişli analiz süresi gerektirir; canlı oynatma için proxy benzeri arka plan önbellek üretimi gerekir.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Orta

#### 14. Hareketli Grafik & Gelişmiş Başlık/Alt Bant Motoru (Progress Bar, Sayaç, Ok/Kutu Vurgu)
- **Kullanıcıya Faydası:** Eğitmenler ve sosyal medya üreticilerinin derslerde ekrandaki alanı kutu/ok ile işaretlemesini veya videoya ilerleme çubuğu eklemesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/credits.ts` (yeni şablon türleri: `annotation-callout`, `progress-bar`, `kinetic-title`), `CreditOverlay.tsx`, `credit-export.ts`.
- **Teknik Yaklaşım:** Mevcut `V2` şablon & Canvas 2D PNG overlay (veya zaman-tabanlı animasyon kare serisi) altyapısının genişletilmesi.
- **Riskler ve Bağımlılıklar:** Sabit PNG şeffaf bindirme yalnızca fade/scroll hareketi yapar; kare-kare değişen sayaç/ilerleme çubuğu için FFmpeg `drawbox`/ifade veya PNG dizisi gerekir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

---

### C. Ses İşleme ve Miksaj

#### 15. Canlı LUFS / True Peak VU Metreler ve Loudness Normalizasyonu (`-14 LUFS`)
- **Kullanıcıya Faydası:** `AudioWorkspace.tsx` içindeki statik dekoratif barları gerçek ses ölçerlere dönüştürür; YouTube/Spotify ses standardında tutarlı ses çıkışı sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `usePlayer.ts` (Web Audio `AudioContext` + `MediaElementAudioSourceNode` + `AnalyserNode`), `AudioWorkspace.tsx` (canlı dBFS/LUFS metre + clipping uyarısı), `export-service.ts` (`loudnorm`).
- **Teknik Yaklaşım:** Yerleşik Web Audio API (önizleme) + FFmpeg `loudnorm=I=-14:TP=-1.5:LRA=11` (export).
- **Riskler ve Bağımlılıklar:** HTML `<video>`/`<audio>` elemanlarının Web Audio'ya yalnızca yaşam döngüsü başına bir kez bağlanması (`WeakMap`) gerekir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Yüksek

#### 16. 5-Bant Parametrik EQ, Dinamik Kompresör ve Ses Profilleri (Podcast / Diyalog / Sinema)
- **Kullanıcıya Faydası:** YouTuber, eğitmen ve kısa filmcilerin boğuk mikrofon sesini dış yazılıma geçmeden parlatmasını ve ani ses sıçramalarını bastırmasını sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`audioDsp`), `usePlayer.ts` (Web Audio `BiquadFilterNode` + `DynamicsCompressorNode`), `AudioWorkspace.tsx`, `export-service.ts` (`equalizer`, `acompressor`).
- **Teknik Yaklaşım:** Web Audio DSP grafiği + birebir FFmpeg ses filtre karşılıkları.
- **Riskler ve Bağımlılıklar:** Aday #15'teki Web Audio yönlendirme altyapısı üzerine kurulur.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Yüksek

#### 17. Ses Klibi İçi Dalga Formu Kazanç Keyframe Zarfları (Volume Envelope)
- **Kullanıcıya Faydası:** Müzik videosu ve belgeselcilerin ses dalgası üzerinde doğrudan tıklayarak nokta koyup belirli cümlelerde müziği elle eğimli kısabilmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`gainKeyframes`), `Timeline.tsx` (dalga formu üstü çizgi + sürüklenebilir noktalar), `usePlayer.ts`, `export-service.ts`.
- **Teknik Yaklaşım:** Mevcut `buildFfmpegKeyframeExpr` interpolatörünün dB->lineer kazanç eğrisiyle FFmpeg `volume='...':eval=frame` filtresine uygulanması.
- **Riskler ve Bağımlılıklar:** Sürücü ses sıçramasını önlemek için logaritmik/dB uzayında yumuşak interpolasyon kullanılmalıdır.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

---

### D. Yapay Zekâ ve Akıllı Otomasyon Araçları

#### 18. Çevrimdışı Yerel Whisper Otomatik Altyazı, Kelime Vurgulu Altyazılar & `.srt`/`.vtt`
- **Kullanıcıya Faydası:** Sosyal medya (dinamik/karaoke altyazı), YouTuber ve eğitmenlerin (Türkçe dahil yüksek doğrulukta otomatik `.srt` ve gömülü altyazı) saatler süren manuel yazım yükünü ortadan kaldırır.
- **Mevcut Koda Nasıl Oturacağı:** `main/ai/whisper-service.ts`, `shared/subtitles.ts`, `RightPanel.tsx` / `CaptionsWorkspace`, `CreditOverlay.tsx` + `credit-export.ts` + `export-service.ts`.
- **Teknik Yaklaşım:** Yerel `whisper.cpp` (prebuilt CLI veya native addon) / `@huggingface/transformers` (ONNX) — tamamen çevrimdışı ve aboneliksiz; modeller ilk kullanımda `userData/models` dizinine indirilir.
- **Riskler ve Bağımlılıklar:** Büyük model boyutları (`150MB–500MB`) kurulum `.AppImage`/`.exe` içine gömülmemeli, isteğe bağlı indirilmelidir; kelime seviyesi zaman damgalı stil export'u için çoklu PNG veya FFmpeg `ass` altyazı yakma (`libass`) gerekir (`ffmpeg-static`'in `subtitles`/`ass` filtresi **doğrulanmadı**; eksikse Canvas PNG dizisi her zaman çalışır).
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Yüksek

#### 19. Otomatik Sessizlik Kesme (Silence Removal)
- **Kullanıcıya Faydası:** YouTuber ve eğitmenlerin uzun konuşma videolarındaki sessiz boşlukları ve duraksamaları saniyeler içinde temizleyip otomatik Ripple birleştirmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `main/media/analysis-service.ts`, `RightPanel.tsx` / `AudioWorkspace.tsx` (dB eşiği ve minimum süre sürgüleri + önizleme), `App.tsx` (toplu bölme ve boşlukları kapatma).
- **Teknik Yaklaşım:** Sıfır ek AI bağımlılığıyla yerel FFmpeg `silencedetect=noise=-35dB:d=0.6` filtresi (ya da mevcut `extractPeaks` 50 Hz verisi üzerinde saf TS eşik taraması!).
- **Riskler ve Bağımlılıklar:** Mevcut `v1` Ripple altyapısını kullanır; yanlış kesimleri önlemek için tek tık Undo (`recordHistory`) ve kesim öncesi önizleme listesi zorunludur.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Yüksek

#### 20. Transkript Tabanlı Kurgu (Text-Based Editing)
- **Kullanıcıya Faydası:** YouTuber, podcast ve belgeselcilerin uzun röportajlarda metni okuyup istenmeyen cümleleri dokümandan siler gibi seçip silerek videoyu kesmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `TranscriptPanel.tsx`, `App.tsx` (seçilen zaman aralıklarını toplu kes + Ripple Sil), `shared/subtitles.ts`.
- **Teknik Yaklaşım:** Aday #18 çıktısındaki kelime zaman damgalarını timeline klip dilimleriyle canlı eşleyen düzenleyici.
- **Riskler ve Bağımlılıklar:** Doğrudan Aday #18 (Whisper transkript) önkoşuludur; klip zamanı kaydığında transkript eşlemesi (`in`/`start` ofsetleri) reaktif güncellenmelidir.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Yüksek

#### 21. Yapay Zekâ Konuşma İzolasyonu & Gürültü Silme (RNNoise / Voice Isolate)
- **Kullanıcıya Faydası:** Dış mekân, klima, klavye veya oda uğultusu içeren YouTube/ders/belgesel konuşmalarını temizler (mevcut `denoise` yalnızca `85Hz-11.5kHz` bant filtresidir).
- **Mevcut Koda Nasıl Oturacağı:** `main/audio/voice-isolate.ts`, `AudioWorkspace.tsx` (`AI Voice Isolate` + ıslak/kuru karışım oranı), `usePlayer.ts`, `export-service.ts`.
- **Teknik Yaklaşım:** Önizlemede Web Audio `AudioWorklet` + `@shiguredo/rnnoise-wasm`; export'ta FFmpeg `arnndn` (`ffmpeg-static` içinde `arnndn` varlığı **doğrulanmadı**) veya WASM/native RNNoise ile üretilmiş temizlenmiş WAV önbelleği.
- **Riskler ve Bağımlılıklar:** CPU yükünü düşürmek için klibe özel temizlenmiş WAV önbelleği üretmek hem önizleme hem export uyumunu garantiler.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Yüksek

#### 22. Otomatik Ritim (Beat) ve Sahne Değişimi (Scene Cut) Algılama
- **Kullanıcıya Faydası:** Müzik videosu kurgucularına şarkının vuruşlarına otomatik marker yerleştirir; tek parça uzun videoları sahne değişimlerinden otomatik kliplere böler.
- **Mevcut Koda Nasıl Oturacağı:** `main/media/analysis-service.ts`, `Timeline.tsx` (beat işaretçileri + Snap hedefi), `App.tsx`.
- **Teknik Yaklaşım:** Sahne tespiti: FFmpeg `select='gt(scene,0.35)',showinfo`. Ritim tespiti: PCM enerji akışı (spectral flux) pik bulma (yerel Node/JS).
- **Riskler ve Bağımlılıklar:** Düşük risk; vuruş yoğunluğu için kullanıcıya hassasiyet eşiği sunulmalıdır.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 23. Akıllı Dikey Takip (Auto-Reframe 16:9 → 9:16) & AI Arka Plan Kaldırma (Subject Mask)
- **Kullanıcıya Faydası:** Yatay videoları konuyu ortalayarak 9:16'ya çevirir; yeşil perde olmadan insan/obje arkasını kaldırır veya metni öznenin arkasına yerleştirir.
- **Mevcut Koda Nasıl Oturacağı:** `main/ai/vision-service.ts`, `RightPanel.tsx`, `timeline.ts` (Auto-Reframe çıktısı doğrudan `posX` keyframe'lerine yazılır).
- **Teknik Yaklaşım:** `@mediapipe/tasks-vision` veya `onnxruntime-node` (yüz/özne takibi + segmentasyon maskesi).
- **Riskler ve Bağımlılıklar:** 4K videolarda ağır GPU/CPU yükü; düşük çözünürlükte örnekleme + keyframe yumuşatma gerekir. Arka plan kaldırmalı bindirme Aday #1'e (çoklu katman) bağlıdır.
- **Uygulama Eforu:** XL | **Kullanıcı Etkisi:** Yüksek

---

### E. Performans, Kayıt ve Proje Yönetimi

#### 24. Uygulama İçi Ekran/Webcam Kaydı ve Timeline Voiceover (Seslendirme)
- **Kullanıcıya Faydası:** Eğitmen ve YouTuber'ların ders kaydını veya seslendirmeyi dış yazılıma geçmeden doğrudan timeline'a kaydetmesini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `preload`/`main` (`desktopCapturer`), `CaptureModal.tsx`, `media-service.ts` (kaydedilen `.wav`/`.mp4` dosyasını otomatik içe aktarıp playhead'e yerleştirme).
- **Teknik Yaklaşım:** Electron `desktopCapturer` + `navigator.mediaDevices.getUserMedia` + `MediaRecorder` / WAV kaydedici.
- **Riskler ve Bağımlılıklar:** Linux Wayland üzerinde ekran yakalama sistem PipeWire izni gerektirir; ses kayıtları artık mevcut olan harici ses alma hattına doğrudan oturur.
- **Uygulama Eforu:** L | **Kullanıcı Etkisi:** Orta

#### 25. Akıllı Render Cache (Ön-Render Önbelleği) ve Proje Medya Toplama (Collect & Archive)
- **Kullanıcıya Faydası:** Ağır `Halation/Bloom/Grain` veya yavaş hız efekti içeren bölümlerin timeline'da takılmadan oynamasını sağlar ve `.noircut` projesini tüm ham dosyalarla tek klasöre paketleyerek kırık yolları önler.
- **Mevcut Koda Nasıl Oturacağı:** `main/project-backup.ts` (`project:collectMedia`), `timeline.ts` (cache dilimleri), `Monitor.tsx` / `usePlayer.ts`.
- **Teknik Yaklaşım:** Node `fs/promises` kopyalama + göreceli yol destekli `.noircut` v2; FFmpeg ile işaretli aralıkların arka plan ön-render'ı.
- **Riskler ve Bağımlılıklar:** Disk kota yönetimi ve önbellek temizleme ayarı gerektirir.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 26. Doğrudan Ses Export (`.wav` / `.mp3`) ve ProRes (`.mov` `prores_ks`) Master Profilleri
- **Kullanıcıya Faydası:** Kısa filmcilerin gerçek 10-bit ProRes master almasını, podcast/müzik üreticilerinin yalnızca mikslenmiş ses çıktısı almasını sağlar (şu an `MOV` yalnızca `libx264` yazıyor).
- **Mevcut Koda Nasıl Oturacağı:** `shared/timeline.ts` (`ExportFormat`: `'mp4' | 'mov-h264' | 'mov-prores' | 'wav' | 'mp3'`), `export-service.ts`, `ExportWorkspace.tsx`.
- **Teknik Yaklaşım:** FFmpeg `-c:v prores_ks -profile:v 2` veya `-vn -c:a pcm_s16le` / `libmp3lame`.
- **Riskler ve Bağımlılıklar:** Düşük risk; gömülü `ffmpeg-static` içinde `prores_ks` ve `libmp3lame` desteği kolayca kontrol edilebilir.
- **Uygulama Eforu:** S | **Kullanıcı Etkisi:** Orta

---

### F. Dosya Alışverişi, Otomasyon ve Platform Entegrasyonu

#### 27. EDL / FCPXML / OpenTimelineIO (OTIO) İçe-Dışa Aktarma & `.noirpack` Preset Paylaşımı
- **Kullanıcıya Faydası:** Kısa film/belgesel ekiplerinin NoirCut kurgusunu DaVinci Resolve/Premiere'e aktarmasını; kullanıcıların LUT + NoirLook + Kredi şablonu paketlerini tek dosyada paylaşmasını sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `src/shared/exchange/` (`otio.ts`, `edl.ts`, `fcpxml.ts`), `main/index.ts`, `ExportWorkspace.tsx`.
- **Teknik Yaklaşım:** Saf TypeScript dönüştürücüler (CMX 3600 EDL, FCPXML, OTIO JSON) + JSON arşivli `.noirpack`.
- **Riskler ve Bağımlılıklar:** NoirFilm özel shader parametreleri harici NLE'lerde birebir açılmaz; ancak kesim, zamanlama, hız, LUT referansı ve marker'lar aktarılır.
- **Uygulama Eforu:** M | **Kullanıcı Etkisi:** Orta

#### 28. Komut Paleti (`Ctrl+K`), Özelleştirilebilir Kısayollar, Tercihler, Makro & Eklenti API'si (ve Doğrudan Platform Yükleme Değerlendirmesi)
- **Kullanıcıya Faydası:** Kurgucuların Premiere/Resolve kısayol şemasına geçmesini, sık kullanılan adımları (ör. "Seçili Klibe Noir Look + Voice Isolate + 9:16 Kuyruk") tek makroda çalıştırmasını ve topluluk şablon/efekt eklentilerini sağlar.
- **Mevcut Koda Nasıl Oturacağı:** `renderer/src/lib/commands.ts`, `CommandPalette.tsx`, `SettingsModal.tsx`, `main/plugins/` (güvenli manifest tabanlı JS/JSON eklenti yükleyici).
- **Teknik Yaklaşım:** Merkezi `CommandRegistry` + `localStorage`/JSON kısayol haritası + kısıtlı sandbox plugin API. *(Not: Doğrudan YouTube/TikTok OAuth yükleme — `L` efor, `Düşük-Orta` etki — API inceleme/token bakımı gerektirdiği için öncelik olarak platform export presetleri yeterli görülüp yükleme entegrasyonu uzun vadeli eklenti modülüne bırakılmalıdır.)*
- **Riskler ve Bağımlılıklar:** `App.tsx` içindeki mevcut `keydown` bloğunun merkezi komut tablosuna taşınması gerekir. Eklentilerde Node API'sine doğrudan erişim kapatılmalıdır.
- **Uygulama Eforu:** M (Komut Paleti + Ayarlar + Kısayollar) / XL (3. Parti Plugin SDK) | **Kullanıcı Etkisi:** Orta–Yüksek

---

## 5. Önceliklendirme

### NoirCut'ın Kimliği Ne Olmalı?

> **Ürün Kimliği Önerisi:** **"Sinema Karanlık Odası & Çevrimdışı Hikâye Stüdyosu (The Indie Cinema & Moody Creator NLE)"**
>
> **Hedef Kitle & Dayanak:** Bağımsız kısa film/belgesel yapımcıları, müzik videosu yönetmenleri, sinematik video-essay/YouTube üreticileri ve abonelik ya da bulut zorunluluğu olmadan Linux + Windows'ta çalışan, kutudan çıktığı anda 35mm film dokusu veren bir editör arayan yaratıcılar.
>
> **Neden Bu Kimlik?** `v1` çekirdek kurgusu (klip taşıma, trim, ripple, ses/görsel alma, GPU yoklamalı kuyruk, autosave) tamamlandığına göre NoirCut artık temel bir NLE olarak ayakta durabiliyor. En büyük mevcut kası hâlâ **WebGL2 NoirFilm Studio + Scopes + 20 Kült Tipografi + Foley SFX**. Kimliğini *"ağır Hollywood suite'lerinden hafif, CapCut'ın bulut/pro duvarından özgür, yerel AI ve film-laboratuvarı gücüne sahip karanlık oda stüdyosu"* olarak konumlandırması en yüksek tutarlılığı sağlar.

---

### Etki / Efor Matrisi (v1 Sonrası Güncel Adaylar)

| | **Düşük Efor (`S` – `M`)** | **Yüksek Efor (`L` – `XL`)** |
| :--- | :--- | :--- |
| **Yüksek Etki** | • #19 Otomatik Sessizlik Kesme (`M`)<br>• #15 Canlı LUFS/Peak VU Metre + Loudnorm (`M`)<br>• #16 5-Bant EQ + Kompresör + Ses Profilleri (`M`)<br>• #21 AI Konuşma İzolasyonu / RNNoise (`M`)<br>• #7 Monitör Transform Gizmosu & Hareket Yolu (`M`) | • #1 Dinamik Çok Kanallı Timeline & PiP (`XL`)<br>• #18 Yerel Whisper Otomatik & Dinamik Altyazı (`L`)<br>• #20 Transkript Tabanlı Kurgu (`L`)<br>• #10 Canlı Önizlemeli Zengin Geçiş Motoru (`L`)<br>• #11 Power Windows Şekil Maskeleme & HSL Qualifier (`L`)<br>• #9 Hız Rampası (`L`)<br>• #23 AI Auto-Reframe & Arka Plan Kaldırma (`XL`) |
| **Orta Etki** | • #6b Marker → YouTube Bölüm Çıktısı (`S`)<br>• #26 ProRes & Ses-Only (`.wav`/`.mp3`) Export (`S`)<br>• #2 Roll/Slip/Slide & Sync Lock (`M`)<br>• #5 Tam 3 Noktalı Kurgu (`M`)<br>• #8 Cubic-Bezier Keyframe Eğrileri (`M`)<br>• #14 Hareketli Grafik / Ok & İlerleme Çubuğu (`M`)<br>• #17 Ses Kazanç Keyframe Zarfları (`M`)<br>• #22 Beat & Sahne Kesimi Algılama (`M`)<br>• #25 Proje Medya Toplama & Render Cache (`M`)<br>• #27 EDL / FCPXML / OTIO & `.noirpack` (`M`)<br>• #28a Komut Paleti & Kısayol Ayarları (`M`) | • #3 Compound Clip / Nested Sequence (`L`)<br>• #4 Çoklu Kamera (Multicam) Ses Senkronu (`L`)<br>• #12 Chroma Key / Luma Key (`M`, #1'e bağlı)<br>• #13 Video Stabilizasyon (`L`)<br>• #24 Ekran/Webcam Kaydı & Voiceover (`L`)<br>• #28b 3. Parti Plugin SDK (`XL`) |

### Öncelik Grupları ve Gerekçeleri

1. **Hızlı Kazanımlar** (*#15 Canlı LUFS VU Metre, #19 Otomatik Sessizlik Kesme, #26 ProRes & WAV/MP3 Export, #6b Marker Bölüm Dışa Aktarma, #7 Monitör Transform Gizmosu*)
   - *Neden bu sıra?* Yeni altyapı değişikliği (`tracks` göçü) beklemeden mevcut `V1/A1/A2` mimarisi ve FFmpeg üzerinde haftalar içinde teslim edilebilirler; `AudioWorkspace`'teki sahte statik VU çubuklarını düzeltip YouTuber/eğitmen/müzik üreticilerine anında hız kazandırırlar.
2. **Temel Taşlar (Altyapı İşleri)** (*#1 Dinamik Çok Kanallı Timeline & PiP, #16 Web Audio DSP + EQ/Kompresör, #10 Çift-Dokulu Canlı Geçiş Motoru, #28a Merkezi Komut Paleti & Ayarlar*)
   - *Neden bu sıra?* Video üstü B-roll/PiP, Chroma Key (#12), Ayar Katmanları (#6a), Multicam (#4) ve görsel üzerine AI maskeli bindirmeler (#23) çoklu video katmanı olmadan yapılamaz. Aynı şekilde canlı Web Audio DSP grafiği de sonraki tüm ses/AI ses araçlarının taşıyıcısıdır.
3. **Farklılaştırıcı Özellikler** (*#18 Yerel Whisper Altyazı, #20 Transkript Tabanlı Kurgu, #21 RNNoise AI Konuşma İzolasyonu, #11 Power Windows Maskeleme & HSL Qualifier*)
   - *Neden bu sıra?* Piyasada CapCut ve Descript'in abonelik/bulut karşılığı sattığı zaman kazandırıcı AI özelliklerini tamamen yerel ve ücretsiz sunarken, DaVinci kalitesindeki maskeli `NoirFilm` görünümünü koruyarak NoirCut'ı benzersiz kılarlar.
4. **Uzun Vadeli Büyük Hedefler** (*#23 Auto-Reframe & AI Segmentasyon, #9 Hız Rampası, #3 Compound Clip, #4 Multicam, #24 Ekran Kaydı & Voiceover, #27 OTIO/EDL/FCPXML, #13 Stabilizasyon*)
   - *Neden bu sıra?* Yüksek mühendislik maliyeti veya çoklu katman/AI çekirdeğine bağımlılık taşırlar; çekirdek çok-kanallı NLE ve yerel AI omurgası oturduktan sonra v3 olgunlaşma döneminde eklenmelidirler.

---

## 6. Yol Haritası (En İyi 10 Özellik · 3 Sürüm)

> `v1.0` temel kurgu çekirdeği tamamlanmış olduğundan, sıradaki en değerli **10 özellik** bağımlılık sırasına göre **3 sürüme (`v1` / Sonraki Acil Paket, `v2`, `v3`)** bölünmüştür.

---

### Sürüm v1 (v1.1) — "Ses Gücü, Hızlı Kaba Kurgu ve Canlı Kadraj"

#### 1. Canlı LUFS/True-Peak VU Metreler, 5-Bant EQ/Kompresör ve `-14 LUFS` Normalizasyonu (#15 + #16)
- **Görev 1.1:** `usePlayer.ts` içinde Web Audio `AudioContext`, `WeakMap` kaynak düğümü, `BiquadFilterNode` (5-bant EQ), `DynamicsCompressorNode` ve kanal/master `AnalyserNode` yönlendirmesini kurma.
- **Görev 1.2:** `AudioWorkspace.tsx` içindeki statik çubukları gerçek dBFS/peak VU metreyle değiştirme; "Podcast / Diyalog / Sinema" tek tık profillerini ekleme.
- **Görev 1.3:** `export-service.ts` içine eşdeğer FFmpeg `equalizer`/`acompressor` zinciri ve isteğe bağlı `loudnorm=I=-14` + `.wav`/`.mp3`/ProRes `.mov` (#26) çıkış seçeneklerini bağlama.

#### 2. Otomatik Sessizlik Kesme ve AI Konuşma İzolasyonu (#19 + #21)
- **Görev 2.1:** `main/media/analysis-service.ts` içinde FFmpeg `silencedetect` ile sessiz aralıkları (`SilenceSpan[]`) çıkaran IPC ve `AudioWorkspace`/`RightPanel` önizleme listesini ekleme.
- **Görev 2.2:** Seçili sessizlikleri tek tıkla klibi bölüp `Ripple Silme` ile kaldıran toplu `cutAndRippleSpans` aksiyonunu `App.tsx`'e yazma (tek Undo adımı).
- **Görev 2.3:** RNNoise (`@shiguredo/rnnoise-wasm` AudioWorklet / temizlenmiş WAV önbelleği) tabanlı "AI Konuşma İzolasyonu" anahtarını ekleme.

#### 3. Canlı Monitör Transform Gizmosu, SVG Hareket Yolu ve Cubic-Bezier Eğrileri (#7 + #8)
- **Görev 3.1:** `Monitor.tsx` üzerine aktif klip için sürüklenebilir konum, köşe ölçek ve döndürme gizmosu ekleme (`RightPanel` transform sürgüleriyle çift yönlü).
- **Görev 3.2:** Keyframe'li kliplerde monitör üzerinde noktalar arası SVG hareket yolunu çizme.
- **Görev 3.3:** `shared/timeline.ts` ve `buildFfmpegKeyframeExpr` içine `ease-in`, `ease-out`, `hold` ve parametrik Cubic-Bezier eğri ön ayarlarını ekleme.

---

### Sürüm v2 — "Çok Katmanlı Stüdyo ve Yerel Yapay Zekâ Altyazı"

#### 4. Dinamik Çok Kanallı Timeline (`V2+`, `A3+`) ve Picture-in-Picture Kompozitleme (#1)
- **Görev 4.1:** `shared/timeline.ts` ve `project.ts` modellerini dinamik `tracks: TimelineTrack[]` (video/audio/adjustment) yapısına geçirip mevcut `v1` `.noircut` dosyaları için otomatik göç (migration) yazma.
- **Görev 4.2:** `Timeline.tsx` içinde "+ Video / + Ses Kanalı Ekle", kanal gizleme/kilitleme ve dikey kanallar arası klip taşıma UI'ını geliştirme.
- **Görev 4.3:** `Monitor.tsx` + `webgl-grade.ts` (çok dokulu/FBO alfa katmanlama) ve `export-service.ts` (FFmpeg `overlay` zinciri + `Link/Sync Lock`) güncellemelerini tamamlama.

#### 5. Çevrimdışı Yerel Whisper Otomatik Altyazı & Dinamik Sosyal Medya Altyazıları (#18)
- **Görev 5.1:** `main/ai/whisper-service.ts` içinde kullanıcı istediğinde `whisper` modelini (`tiny`/`base`/`small`) `userData/models` dizinine indiren ve kelime zaman damgalı segment + `.srt`/`.vtt` üreten servisi kurma.
- **Görev 5.2:** `CREDITS` / `CAPTIONS` içine kelime vurgulu (karaoke/aktif kelime renkli) sosyal medya altyazı şablonu ekleme ve düzenlenebilir altyazı listesi sunma.
- **Görev 5.3:** Altyazı katmanını `credit-export.ts` ve FFmpeg çıkışına birebir basma (`.srt` harici dosya export dahil).

#### 6. Transkript Tabanlı Kurgu ve Roll / Slip / Slide İnce Kurgusu (#20 + #2)
- **Görev 6.1:** `TranscriptPanel.tsx` bileşeninde Whisper kelime zaman damgalarını timeline ile senkronlayıp seçilen metni silince ilgili aralığı otomatik kesip Ripple silme.
- **Görev 6.2:** `Timeline.tsx` araç çubuğuna `Roll`, `Slip`, `Slide` ince kurgu modlarını ve `V–A` bağlı klip senkron kilidini ekleme.

#### 7. Canlı Önizlemeli Zengin Geçiş Motoru & Chroma/Luma Key (#10 + #12)
- **Görev 7.1:** `usePlayer.ts` ve `webgl-grade.ts` içine geçiş penceresinde iki klibi aynı anda harmanlayan WebGL2 shader geçişlerini (`Cross Dissolve`, `Whip Pan`, `Zoom Blur`, `Luma Wipe`) ekleme ve `export-service.ts` `xfade` ile eşleştirme.
- **Görev 7.2:** Çok katmanlı kanal üzerinde çalışan WebGL2 + FFmpeg `chromakey` / `despill` (yeşil perde) modülünü `RightPanel.tsx`'e ekleme.

---

### Sürüm v3 — "Profesyonel Renk Maskeleme, Hareket Zekâsı ve Ekosistem"

#### 8. Power Windows Şekil Maskeleme & HSL Renk Seçici (Qualifier) (#11)
- **Görev 8.1:** `shared/color.ts` ve `GradeWorkspace.tsx` içine elips/dikdörtgen/yumuşak kenar (feather) maske kontrolü ve HSL renk aralığı seçici ekleme.
- **Görev 8.2:** `webgl-grade.ts` (GLSL iç/dış grade harmanı) ve `export-service.ts` (maske alfası + iki-geçişli `maskedmerge` export) desteğini tamamlama.

#### 9. Hız Rampası (Speed Ramping) + Beat & Sahne Kesimi Algılama (#9 + #22)
- **Görev 9.1:** `shared/timeline.ts` ve `Timeline.tsx` içinde hız keyframe'leri, zaman integrali çözücüsü ve `usePlayer.ts`/`export-service.ts` değişken hız haritalama desteğini kurma.
- **Görev 9.2:** `analysis-service.ts` içinde FFmpeg `scene` kesim dedektörü ve PCM spektral akış tabanlı otomatik Beat Marker üreticisini ekleyip `Timeline` snap hedeflerine bağlama.

#### 10. AI Auto-Reframe (`16:9→9:16`), Komut Paleti (`Ctrl+K`) & EDL/FCPXML/OTIO Alışverişi (#23 + #27 + #28a)
- **Görev 10.1:** Yerel yüz/özne takip modeliyle yatay kliplere otomatik `posX` keyframe üreten **Auto-Reframe** aracını ekleme.
- **Görev 10.2:** `App.tsx` kısayollarını merkezi `CommandRegistry`'e taşıyıp `Ctrl+K` Komut Paleti ve özelleştirilebilir Kısayol/Ayarlar penceresini geliştirme.
- **Görev 10.3:** `src/shared/exchange/` altında `.edl`, `.fcpxml`, `.otio` ve `.noirpack` preset paketi içe/dışa aktarıcılarını tamamlayıp `NoirCut`'ı Resolve/Premiere ekosistemine bağlama.
