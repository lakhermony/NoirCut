# NoirCut Tick Zaman Tabanı (Integer Timebase) Envanter ve Durum Raporu

**Tarih:** 2026-11-28  
**Referans Sürüm:** `v1.0.6` (`12f29d1` sonrası `improve/round2-hardening`)

---

## 1. Mevcut Dosyalar ve Satır Sayıları

| Dosya | Satır | Durum |
| :--- | ---: | :--- |
| `src/core/timebase.ts` | 85 | Kısmi üretim kullanımı (`secondsToMediaTicks`, `ticksToFFmpegSeconds`) |
| `src/core/clip-ops.ts` | 187 | Kısmi üretim kullanımı (yalnızca `evaluateParameterAtMediaTick`) |
| `src/core/types/timeline.ts` | 64 | Kısmi üretim kullanımı (yalnızca `Keyframe` tipi) |
| `src/core/legacy-adapter.ts` | 200 | Yalnızca `adaptAnalysisTimestampsToMediaTicks` yazılıyor, okunmuyor |
| `src/ui/timeline/viewport-math.ts` → `experimental/timebase/viewport-math.ts` | 59 | **Park edildi (Seçenek B)** (`src/` içinde kullanılmıyordu) |
| **Toplam** | **595** | |

---

## 2. Üretim (`src/`) vs. Yalnızca Test (`tests/`) Kullanım Envanteri

### Üretimde Gerçekten Çağrılanlar
1. **`src/shared/timeline.ts`:**
   - `evaluateParameterAtMediaTick` (`src/core/clip-ops.ts`) — `evaluateClipTransformAt` ve `buildFfmpegKeyframeExpr` içinde kullanılıyor.
   - `secondsToMediaTicks`, `ticksToFFmpegSeconds` (`src/core/timebase.ts`) — saniye cinsinden gelen `k.time` / `localTime` değerlerini geçici olarak `MediaTick`'e çevirip tekrar saniyeye döndürüyor.
   - `type Keyframe as CoreKeyframe` (`src/core/types/timeline.ts`).
2. **`src/main/media/media-analysis.ts`:**
   - `adaptAnalysisTimestampsToMediaTicks` (`src/core/legacy-adapter.ts`) — satır 143 ve 245'te `mediaTicks` alanını dolduruyor; ancak `mediaTicks` alanı `src/` içinde **hiçbir yerde okunmuyor** (`grep -rn "mediaTicks" src/`).

### Yalnızca Testte (`tests/regression.test.mjs` Suite 18) Yaşayanlar
- `src/ui/timeline/viewport-math.ts`: Tüm fonksiyonları (`ticksToPixels`, `pixelsToTicks`, `getRulerStepTicks`, `formatTimecodeFromTicks`).
- `src/core/timebase.ts`: `TICKS_PER_SECOND` (doğrudan), `frameDurationInTicks`, `secondsToTimelineTicks`, `ticksToSeconds`, `snapTimelineTicks`, `asMediaTick`, `asTimelineTick` (üretimde `shared/timeline.ts` dışında doğrudan çağrısı yok).
- `src/core/clip-ops.ts`: `splitClipAtTimelineTick`, `trimClipLeftToTick`, `trimClipRightToTick`, `rippleDeleteAndShift`, vb. kesim/ripple fonksiyonları.
- `src/core/legacy-adapter.ts`: `timelineClipToCoreClip`, `adaptLegacyProjectToTickTimeline`, vb. proje dönüştürücüleri.

### Sonuç
Üretim zaman modeli (`TimelineClip.start`, `in`, `duration`, `CaseMarker.time`, `SubtitleSegment.start/end`, `usePlayer`, `export-service.ts`) hâlâ tamamen **kayan noktalı saniye (`number`)** tabanlıdır. `src/core` katmanı yalnızca keyframe enterpolasyonunda saniye → tick → saniye köprüsü olarak çalışmaktadır.

---

## 3. Karar Seçenekleri

### Seçenek (A) — Tick Zaman Tabanını Üretime Bağla
- **Kapsam:** En azından kesim/ripple/snap matematiğini (`src/shared/timeline.ts`, `App.tsx`, `Timeline.tsx`) ve `viewport-math.ts` cetvel/piksel dönüşümlerini `TimelineTick`/`MediaTick` tabanına bağlamak; proje yükleme/kaydetme sınırında `legacy-adapter.ts` ile geriye dönük uyumluluğu korumak.
- **Maliyet ve Risk:** **Orta–Yüksek.** `TimelineClip` ve `Timeline.tsx` (1.967+ satır) ile `export-service.ts` arasındaki tüm süre/konum alanları ve `.noircut` proje şeması migrasyon/adaptör sınırından geçmek zorundadır. Mevcut 20 regresyon testinin tamamının ve canlı sürükle-bırak/export davranışlarının yeniden doğrulanması gerekir.
- **Kazanç:** Uzun sekanslarda birikimli float yuvarlama kaymasını (`0.001s` sapmaları) ve kare sınırına hizalama hatalarını kalıcı olarak ortadan kaldırır.

### Seçenek (B) — Kullanılmayan Kodu Kaldır / Park Et
- **Kapsam:** Üretimde hiç kullanılmayan `src/ui/timeline/viewport-math.ts` dosyasını ve ölü `legacy-adapter.ts` / `clip-ops.ts` fonksiyonlarını `experimental/timebase/` altına taşımak veya silmek; `README.md` / `CHANGELOG.md` içindeki "integer tick timebase aktif" ifadelerini gerçek durumu yansıtacak şekilde düzeltmek (`shared/timeline.ts` içindeki `evaluateParameterAtMediaTick` ya sadeleştirilir ya da `core/timebase` yalnızca keyframe yardımcısı olarak bırakılır).
- **Maliyet ve Risk:** **Düşük.** Mevcut çalışan saniye tabanlı akışa ve `.noircut` dosya formatına dokunulmaz; kırılma riski minimumdur.
- **Kazanç:** Ölü kod ve yanıltıcı mimari iddiası temizlenir, bakım yükü azalır.

---

> **Durum:** Seçenek (B) uygulandı — kullanılmayan `src/ui/timeline/viewport-math.ts` modülü `experimental/timebase/viewport-math.ts` altına taşındı; mevcut `core/` keyframe yardımcıları ve `legacy-adapter.ts` geriye dönük test uyumluluğu için korundu.
