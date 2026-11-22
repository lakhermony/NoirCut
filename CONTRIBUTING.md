# NoirCut Studio — Katkıda Bulunma Rehberi (CONTRIBUTING)

NoirCut Studio projesine katkıda bulunmak istediğiniz için teşekkür ederiz. Bu belge geliştirme ortamı kurulumu, kod standartları, test kuralları ve Pull Request (PR) sürecini açıklar.

---

## 1. Geliştirme Ortamı Kurulumu

### Gereksinimler
- **Node.js:** `>= 20.x`
- **npm:** `>= 10.x`
- **İşletim Sistemi:** Linux (`x64`) veya Windows (`x64`)

### Kurulum Adımları
```bash
git clone https://github.com/lakhermony/NoirCut.git
cd NoirCut
npm install
npm run dev
```

---

## 2. Mimari ve Kod İlkeleri

NoirCut 3 katmanlı Electron mimarisiyle çalışır:
- `src/shared/`: Hem Main hem Renderer sürecinde kullanılan saf TypeScript veri modelleri ve matematiksel fonksiyonlar (`timeline.ts`, `color.ts`, `lut.ts`, `noirfilm.ts`, `credits.ts`, `project.ts`). Bu katmanda Node.js veya DOM bağımlılığı bulunmamalıdır.
- `src/main/`: Electron ana süreci; gömülü/sistem FFmpeg motoru (`ffmpeg-engine.ts`), Smart Proxy ve güvenli `noircut-media://` protokolü (`media-service.ts`), FFmpeg dışa aktarma (`export-service.ts`) ve atomik otomatik kayıt (`project-backup.ts`).
- `src/renderer/src/`: React 19 arayüzü, WebGL2 shader motoru (`webgl-grade.ts`), Web Audio API gerçek zamanlı ses motoru (`noir-audio-engine.ts`) ve çalışma alanları.

### Temel Kurallar
1. **Önizleme = Dışa Aktarma Tutarlılığı:** Program Monitörü veya `NoirAudioEngine` üzerinde eklenen her görsel/işitsel işlem, `src/main/export/export-service.ts` içindeki FFmpeg filtre grafiğinde karşılığıyla birlikte uygulanmalıdır.
2. **Sıfır Re-render Oynatma Döngüsü:** 60 FPS oynatma sırasında (`usePlayer.ts`) her karede React `useState` tetiklenmemeli; zaman kodu ve playhead güncellemeleri `subscribeTime` üzerinden doğrudan DOM referanslarıyla yapılmalıdır.
3. **Veri Bütünlüğü:** Undo/Redo geçmişinde (`cloneClipItem`, `cloneLaneMap`) referans paylaşımına izin verilmemeli, dışa aktarma işlemleri geçici `.part` dosyası üzerinden atomik olarak tamamlanmalıdır.

---

## 3. Zorunlu Doğrulama ve Testler

Her Pull Request öncesinde aşağıdaki komutların sıfır hatayla tamamlanması zorunludur:

```bash
# 1. TypeScript tip kontrolü
npm run typecheck

# 2. Main, Preload ve Renderer üretim derlemesi
npm run build

# 3. Regresyon ve veri bütünlüğü test paketi
npm test
```

---

## 4. Pull Request Süreci

1. Yeni bir dal (branch) oluşturun (`git checkout -b feat/ozellik-adi` veya `fix/hata-adi`).
2. Değişikliklerinizi anlaşılır commit mesajlarıyla (`feat:`, `fix:`, `perf:`, `docs:`) kaydedin.
3. `npm run typecheck`, `npm run build` ve `npm test` çıktılarını doğrulayın.
4. PR açıklamasında yapılan değişikliği, test senaryosunu ve varsa önizleme/export eşleşme detaylarını belirtin.
