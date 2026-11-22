# Changelog

NoirCut Studio projesindeki tüm önemli değişiklikler bu dosyada belgelenir.

---

## [v1.0.5] — 2026-11-22

### Yeni Özellikler
- **NoirAudio Engine (`src/renderer/src/lib/noir-audio-engine.ts`):**
  - Web Audio API tabanlı, tekil `48 kHz` `AudioContext` ve `WeakMap<HTMLMediaElement, ChannelStripNodes>` kaynak yöneticisi (`InvalidStateError` korumalı).
  - Canlı önizlemede `+0 dB .. +12 dB` baş mesafesi (headroom), `StereoPannerNode` (`-100..+100` Sol/Sağ Pan), 3-Bant Parametrik EQ (`100 Hz`, `1 kHz`, `8 kHz`), Compressor (`DynamicsCompressorNode`), Brickwall Limiter (`20:1`), çift kademeli Reverb (`60 ms` / `110 ms` + `3.8 kHz` sönümleme) ve Noise Reduction (`85 Hz HPF` + `11.5 kHz LPF` + `4.5 kHz Hiss Dip`) desteği.
  - Kanal bazlı ve Master Bus bazlı gerçek zamanlı `AnalyserNode` tepe (dBFS) ölçümü (`AudioWorkspace.tsx`).
  - `AUDIO`, `SUBTITLES` ve `EXPORT` sekmelerine geçildiğinde gömülü video sesinin kesintisiz devam etmesi için arka plan A/B ses/video tampon koruması.
- **Otomatik Regresyon Test Paketi (`tests/regression.test.mjs`, `npm test`):**
  - Dinamik kanal (`V1..Vn`, `A1..An`) Undo/Redo koruması, derin kopyalama ve döngüsel referans koruması, Linked A/V Razor kesim eşleşmesi, çok katmanlı `flattenNestedClips` önizleme/export eşliği, `1/2` / `1/4` / `1/8` proxy ölçek doğrulaması ve atomik `.part` dışa aktarma testleri.

---

## [v1.0.4] — 2026-11-22

### Veri Bütünlüğü ve Kararlılık Düzeltmeleri
- **Dinamik Kanal Undo/Redo Koruması:** `cloneLaneMap` fonksiyonu `V3+` ve `A3+` dahil tüm dinamik kanalları ve özelliklerini (`locked`, `hidden`, `muted`, `solo`, `order`) koruyacak şekilde güncellendi.
- **Derin Kopyalama & Döngüsel Referans Koruması:** `cloneClipItem` içine `audioEffects` ve `nestedClips` derin kopyalaması ile döngüsel referans (`seen: Set`) koruması eklendi.
- **Linked A/V Razor Kesimi:** Bağlı video ve ses klipleri (`cut` ve `cutClipAt`) kesildiğinde sağda oluşan yeni video ve ses parçalarının `linkedClipId` ile çift yönlü bağlı kalması sağlandı.
- **Nested Sequence Canlı Önizleme & Export Eşliği:** `flattenNestedClips` hem `usePlayer.ts` hem `export-service.ts` içine entegre edilerek çok katmanlı iç içe sekansların gerçek alt kliplerine açılması sağlandı.
- **Monoton Proxy Ölçek Matematiği:** `1/2`, `1/4` ve `1/8` proxy genişlikleri kaynak çözünürlükten çift sayı olarak hesaplandı; küçük kaynaklarda büyütme (upscale) engellendi.
- **Atomik `.part` Dışa Aktarma:** FFmpeg çıktısı geçici `.part` dosyasına yönlendirildi; iptal veya hata durumunda hedef klasördeki mevcut geçerli dosyanın silinmesi önlendi.

---

## [v1.0.3] — 2026-11-21

### Yeni Özellikler ve İyileştirmeler
- **5 Entegre Çalışma Alanı:** `EDIT`, `COLOR`, `AUDIO`, `SUBTITLES` ve `EXPORT` çalışma alanları.
- **3 Katmanlı Timeline Klip Kartları & Dinamik Tema:** `Header + FilmstripCanvas + WaveformCanvas` yapısı, `Ctrl+A`, `Esc`, Marquee (Rubber-Band) çoklu seçim ve 5 karanlık oda temasıyla dinamik sınır renkleri.
- **Kesintisiz Oynatma & Smart Proxy:** Çift tamponlu (`Slot A/B`) gapless pre-roll, `requestVideoFrameCallback`, sıfır React re-render (`subscribeTime`) ve `-g 1` All-Intra arka plan proxy üretimi.
- **NoirFilm Studio & Chroma Key:** `17/33/65` 3D LUT, Film Stock emülasyonu (`Kodak 2383`, `Fujifilm 3513`, `Kodak 5219`, `Ilford HP5`, `Silver Noir`), Halation/Bloom/Mist ve Chroma Key (`V1` arka plan + `V2` şeffaf PiP).
- **Altyazı Burn-In & Render Kuyruğu:** `.srt`/`.vtt` içe-dışa aktarma, PNG katmanlı garantili altyazı gömme (Burn-In), `H.264`/`H.265` donanım kodlayıcı algılama ve `SIGSTOP`/`SIGCONT` destekli Render Queue.
