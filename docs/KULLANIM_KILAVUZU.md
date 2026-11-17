# NoirCut Studio — Son Kullanıcı Kullanım Kılavuzu

Bu kılavuz, **NoirCut** ile ilk projenizi başlatmaktan son sinematik dışa aktarmaya (`MP4` / `MOV`) kadar tüm çalışma adımlarını kapsar.

---

## 1. Başlatıcı (NoirLauncher) ve Proje Güvenliği

Uygulamayı açtığınızda (veya üst bardaki **Ev** simgesine tıkladığınızda) **NoirLauncher** karşılar:

- **Sistem Kontrolü:** Üst solda **WebGL2 GPU** ve gömülü **FFmpeg Motoru** durumu yeşil ışıkla doğrulanır.
- **Yeni Kurgu / Proje Açma:** **Yeni Kurgu Başlat (Enter Studio)** ile temiz bir çalışma alanına geçebilir veya kayıtlı `.noircut` projelerinizi **Son Projeler** kartlarından tek tıkla açabilirsiniz.
- **Otomatik Yedek & Çökme Kurtarma:** Düzenleme yaptığınız projeler her 8 saniyede bir arka planda otomatik yedeklenir (son 10 sürüm saklanır). Beklenmedik bir kapanma sonrası açılışta **"Kurtarılacak Oturum Bulundu"** uyarısı görünür ve tek tıkla kaldığınız yerden devam edebilirsiniz.

---

## 2. Medya İçe Aktarma ve Zaman Çizelgesi (`EDIT`)

1. Sol paneldeki **+ İçe Aktar** butonunu kullanarak bilgisayarınızdan video (`MP4`, `MOV`, `MKV`, `WEBM`), ses (`MP3`, `WAV`, `AAC`, `FLAC`, `OGG`, `M4A`) veya görsel (`PNG`, `JPG`, `WEBP`) seçin.
   - *Otomatik Proxy:* Doğrudan tarayıcı uyumlu olmayan videolar arka planda hafif proxy kopyasına dönüştürülür; işlem sırasında bile zaman çizelgesinde kurguya devam edebilirsiniz.
2. **Medya Filtreleri:** Sol panel üstündeki `Tümü | Video | Ses | Görsel` haplarıyla dosyalarınızı filtreleyin ve kartları zaman çizelgesindeki ilgili kanala (`V1`, `A1`, `A2`) sürükleyin.
3. **Kurgu Araçları:**
   - **Taşıma & Kırpma:** Klibin ortasından tutarak sağa/sola kaydırın; sol veya sağ kenar tutamacından çekerek giriş/çıkış süresini kırpın (`Mıknatıs / Snap` açıkken klip kenarlarına ve işaretçilere otomatik hizalanır).
   - **Bölme (`C`):** Playhead'i istediğiniz saniyeye getirip `C` tuşuna basın.
   - **Ripple Modu & Boşluk Kapatma:** Üst şeritteki **Ripple** modunu açtığınızda (veya `Shift + Del` kullandığınızda) silinen klibin arkasındaki klipler boşluk bırakmadan otomatik geri kayar. Var olan boşlukları **Boşluk Kapat** ile toplayabilirsiniz.
   - **Sesi Ayır:** `V1` kanalındaki videonun sesini bağımsız düzenlemek için **Sesi Ayır** butonuna basın (`A1`'e aktarılır).
4. **Sağ Panel Kontrolleri:** Seçili klip için **Transform** (`Scale`, `Pos X/Y`, `Rotation`, `Opacity` + elmas ikonlarıyla keyframe ekleme), **Hız (`%25–%400` & `Reverse`)** ve **Geçiş Efektleri** (`Cross Dissolve`, `Dip to Black`) ayarlanabilir.

---

## 3. Renk Düzeltme, NoirFilm Studio & LUT Kütüphanesi (`GRADE`)

`GRADE` çalışma alanı üstte **Program Monitörü** + **Lift · Gamma · Gain · Offset** renk tekerleklerini, altta ise 3 ayrı stüdyo sekmesini sunar:

### A) `COLOR DECK & SCOPES`
- **Temel Ayarlar & WB:** Düz/Log çekimler için `Kamera Profili` (`S-Log3`, `C-Log`, `V-Log`, `Log-C` → `Rec.709`) seçin; **Auto WB** veya monitör üstü **Damlalık** ile beyaz dengesini kalibre edin.
- **Skoplar:** `Parade`, `Waveform`, `Vectorscope` ve `Histogram` ile pozlama ve renk doygunluğunu teknik olarak takip edin. Monitör üstünden **False Color**, **Safe Frames (`2.39:1`, `16:9`, `9:16`)**, **Before/After Wipe**, **Kare Yakala (Grab Still)** ve **Kopyala/Yapıştır** araçlarını kullanın.
- **Eğriler:** Luma ve R/G/B kanallarında ince ton eğrileri ve Hue-vs-Hue/Sat ayarları yapın.

### B) `NOIRFILM STUDIO`
- **NOIR LOOKS:** 12 kategoride hazır sinematik görünümler.
- **FILM EMULATION:** `35mm`, `16mm` ve `8mm` film kontrastı, highlight roll-off ve shadow/highlight renk tonlaması.
- **FILM TEXTURE:** Organik film greni boyutu, yumuşaklığı, luma ve renk greni dağılımı.
- **LIGHT EFFECTS:** Yığılabilir **Halation**, **Bloom**, **Diffusion** ve **Mist** ışık efektleri.
- **MY LOOKS:** Kendi oluşturduğunuz görünümleri favorilere ekleyin veya `.noirlook` dosyası olarak kaydedip paylaşın.

### C) `• LUT KÜTÜPHANESİ`
- **Filtre & Arama:** Kategori hapları (`Tümü`, `Gerilim & Korku`, `Neo-Noir & Gece`, `35mm Film`, `Stüdyo`, `Özel .cube`), tür seçimi (`Hepsi`, `Şablonlar`, `3D LUT`) ve anlık arama kutusuyla istediğiniz görünümü saniyeler içinde bulun.
- **`.cube` İçe Aktarma:** **+ .cube Yükle** butonuyla kendi 3D LUT dosyalarınızı ekleyin; üstteki 4 kaydırıcı ile **LUT Yoğunluğu**, **Film Grain (35mm)**, **Halation** ve **Mist / Diffusion** şiddetini anında ayarlayın.

---

## 4. Ses Miksajı ve Atmosfer (`AUDIO`)

- `V1`, `A1` ve `A2` kanallarını **Mute / Solo** ile izole edin.
- Her klip için **Gain (`-60..+12 dB`)**, **Pan (`Sol ↔ Sağ`)**, **Fade In / Fade Out** ve **Audio FX** (`Denoise` / `Sinematik Bas`) ayarlayın.
- **Auto-Ducking (Diyalog Önceliği):** Açık olduğunda `V1` veya `A1` konuşma sesleri duyulduğu an `A2` müzik kanalı otomatik olarak yumuşatılır.
- **Noir Soundscape:** Tek tıkla playhead konumuna prosedürel sentezlenmiş *Gerilim Riser*, *Sub Drop*, *Film Projektörü* veya *Gece Yağmuru* ekleyin.

---

## 5. Sinematik Başlık & Jenerik (`TEXT / CREDITS`)

1. Sol panelden bir şablon seçin (`Classic Rolling Credits`, `Noir Opening Title`, `Minimalist Lower Third`, `Chapter / Act Card`, `Serbest Metin`).
2. Sağ panelden **20 kült sinema/korku/noir fontundan** birini seçin veya **+ .ttf / .otf Font Yükle** ile kendi yazı tipinizi anında yükleyin.
3. Yalnızca İngilizce harf içeren afiş fontlarında eksik harf kutusu çıkmasını önlemek için **TR -> EN Harf Dönüştür (`Ğ→G, Ş→S, İ→I`)** anahtarını kullanın.
4. **Harf Aralığı**, **Satır Yüksekliği**, **Metin Gölgesi / Neon Glow Rengi**, **Daktilo Efekti** ve **Film Titremesi (Gate Weave)** ayarlayıp **+ Timeline'a Ekle** ile `V2` katmanına yerleştirin.

---

## 6. Dışa Aktarma ve Render Kuyruğu (`EXPORT`)

- İsterseniz tek tıkla hazır **Platform Ön Ayarlarından** birini seçin (`YouTube 4K Master`, `Reels / TikTok / Shorts`, `Sinema 24p Noir`, `Hızlı Taslak`).
- Yalnızca belirli bir sahneyi almak için timeline üzerinde `I` ve `O` noktaları koyup **In – Out Aralığı** çıkışını açın.
- Birden fazla sürümü (örneğin hem 16:9 `1080p` hem 9:16 `Dikey`) tek seferde üretmek için **+ Kuyruğa Ekle** ve **Kuyruğu Başlat** butonlarını kullanın.
