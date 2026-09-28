# Eco-Fraction · Final Sunumu Akış Planı (15 dakika)

Takım VoltLedger · Teknofest Finansal Teknolojiler Yarışması

> Bu plan sunumu yapan ekip içindir. Her adımda **ne tıklanacağı**, **ne söyleneceği** ve **bir şey ters giderse ne yapılacağı** yazıyor. Toplam: ~5 dk sunum + ~10 dk canlı demo.

---

## A. Sunumdan önce (T-30 dakika)

| # | Yapılacak | Kontrol |
|---|---|---|
| 1 | Docker Desktop'ı başlat, yeşil olana kadar bekle | Tepsi simgesi yeşil |
| 2 | Proje klasöründe `.\reset.ps1` çalıştır (~2 dk) | "Eco-Fraction is starting" yazısı |
| 3 | 1 dakika bekle: 200 yatırımcı ve 5 kurumsal fon arka planda yükleniyor | Ana sayfada **Yatırımcı ≥ 200** |
| 4 | Chrome'u tam ekran aç (F11), yakınlaştırma %100 veya %110 | Menü tek satırda |
| 5 | Sekmeleri sırayla aç (aşağıdaki liste) | Hepsi yükleniyor |
| 6 | `Ctrl+Shift+D` ile senaryo panelini aç/kapat, hızın **300×** olduğunu kontrol et | Panel açılıyor |
| 7 | Sağ üstte yeşil nokta ve simülasyon saati ilerliyor mu? | WebSocket bağlı |
| 8 | Wi-Fi'yi kapatıp sayfayı yenile: her şey çalışmaya devam etmeli | Tamamen çevrimdışı çalışır |

**Açık tutulacak sekmeler:**
1. `localhost:3000` — Ana sayfa
2. `localhost:3000/assets/khizi-wind` — Khizi Rüzgar (demo varlığı)
3. `localhost:3000/architecture` — Canlı Mimari
4. `localhost:3000/governance` — Yönetişim
5. `localhost:3000/market` — Piyasa
6. `localhost:3000/ai` — YZ Laboratuvarı

> **Neden Khizi?** Rüzgar santrali gece de üretir. Güneş varlıklarında gece "donmuş sinyal" görünmez (üretim zaten sıfır). Manipülasyon demosunu **her zaman Khizi Ridge Wind Farm** ile yapın.

---

## B. Akış

### 0:00 – 2:00 · Problem ve vizyon (slaytlar veya ana sayfa)

**Ekran:** Ana sayfa (Yeşil enerjinin ortağı olun…)

**Söylenecek:**
- "2030'a kadar yenilenebilir enerjiye 5 trilyon dolar yatırım gerekiyor, ama bireysel yatırımcı dışarıda: doğrudan yatırım 100 bin dolardan başlıyor."
- "Eco-Fraction santralleri 10 dolarlık hisselere bölüyor. Minimum yatırım 50 dolar."
- Sağdaki canlı sayaçları göster: "Bunlar statik değil: şu an platformdan geçen gerçek veri. Anlık üretim, dağıtılan gelir, önlenen CO₂."
- Haritayı göster: "Azerbaycan'da 6 varlık; nokta parlaklığı anlık üretim."
- "Hangi sorunu çözüyoruz?" bölümüne kaydır: 4 sorun ve 4 çözüm, raporumuzdaki başlıklarla birebir aynı.

### 2:00 – 4:00 · Varlık detayı: IoT + YZ + blockchain bir arada

**Ekran:** Khizi Ridge Wind Farm sekmesi

**Söylenecek ve gösterilecek:**
1. **Canlı üretim grafiği:** "Her nokta, sensörün kendi Ed25519 anahtarıyla imzaladığı bir okuma." Grafiğin altındaki cihaz satırını göster (`dev-khizi-wind · seq · Ed25519 ✓`).
2. **YZ üretim tahmini (LSTM):** "Son 48 saat gerçekleşen, mor kesikli çizgi önümüzdeki 24 saatin tahmini. Model naif tahminden %28 daha iyi."
3. **Zincir üstü üretim kayıtları:** "Her saat, o saatin tüm okumaları özetlenip (hash) zincire yazılıyor." Bir satırda **Doğrula** butonuna bas: "Bu kontrolü sunucumuz değil, **sizin tarayıcınız** yapıyor: ham veriden özeti kendisi hesaplıyor ve doğrudan blokzincirden okuduğu değerle karşılaştırıyor. Eşleşiyor, veri değiştirilmemiş. Bize güvenmeyin, kendiniz doğrulayın."
4. **ESG skoru:** "ESG beyana dayalı değil: çevre puanı canlı kapasite faktöründen, yönetişim puanı veri bütünlüğünden hesaplanıyor. Bileşenler açık."

### 4:00 – 5:30 · 50 dolarla yatırım

**Ekran:** Aynı sayfa, sağdaki "Yatırım yap" kutusu. Giriş yapılmamışsa: sağ üstte **Giriş yap** → **Aylin Kaya**.

1. **$50** hazır butonuna bas (5 hisse). "Tahmini yıllık gelir" ve "önlenen CO₂ payınız" satırlarını göster.
2. **$50,00 yatır** butonuna bas. Yeşil onay ve işlem bağlantısı çıkar.
3. İşlem bağlantısına tıkla (Blok Gezgini): "PrimaryMarket.buy() çağrısı, olaylar: USDC transferi, hisse transferi. Her şey zincirde."
4. **Portföyüm** sekmesine geç: "Aylin'in 8.000 dolarlık portföyü var. Toplam kazanç rakamı her üretim saatinde otomatik artıyor. Kimse 'talep et' butonuna basmıyor, akıllı sözleşme cüzdana gönderiyor." Sağ üstte gelir bildirimi çıkmasını bekle.

### 5:30 – 8:30 · Ana an: sayaç manipülasyonu (en önemli bölüm)

1. Khizi sekmesine dön. **`Ctrl+Shift+D`** → Varlık: **Khizi Wind** → **Sayaç manipülasyonu**.
2. **Söyle:** "Şimdi santral sahibinin sayacı şişirdiğini varsayalım: gerçekte üretilenden fazlasını raporluyor. İmza geçerli, çünkü cihazın kendisi. Sadece imzaya bakan bir sistem bunu yakalayamaz."
3. Grafikte **kırmızı noktalar** belirir (birkaç saniye). "YZ her okumayı fizik kurallarıyla karşılaştırıyor: rüzgar hızı bu kadar üretime izin vermiyor."
4. **Canlı Mimari** sekmesine geç (beklerken): Zeka katmanında kırmızı darbeler görünür. "Raporumuzdaki Şekil 1, gerçek olaylarla çalışıyor."
5. 10–25 saniye içinde **"YZ manipülasyon tespit etti: gelir emanete alındı"** bildirimi çıkar. Khizi sekmesine dön: kırmızı **emanet bandı** ve "Neden işaretlendi?" açıklaması. "Yapay zeka kara kutu değil: kararın nedenini gösteriyor. Üretim, sensörün izin verdiğinin 2 katı." Başlıktaki risk rozetini göster: **"Yüksek risk"**. Sağdaki **YZ risk değerlendirmesi** kartında gerekçe hemen yazıyor: "YZ manipülasyon tespit ettiği için gelir bekletiliyor." Birkaç dakika sonra ikinci gerekçe de eklenir: "Üretim YZ tahmininin üstünde: olası sayaç şişirmesi" (LSTM tahmini ile karşılaştırma).
6. Panelden manipülasyonu **kapat**.

### 8:30 – 10:00 · Yönetişim: 2/3 çoklu imza

**Ekran:** Yönetişim sekmesi

1. Üstten **Leyla Hasanova**'yı (Risk Direktörü) seç.
2. Emanet kartında kanıt grafiğini göster: "Tek bir kişi bu parayı hareket ettiremez."
3. **Manipülasyon: iade et** butonuna bas. "Öneri zincire yazıldı, 1/2 imza."
4. Üstten **Elvin Aliyev**'i (CTO) seç → **İkinci imzayı at ve uygula**.
5. "İki imza tamamlandı: sözleşme otomatik çalıştı, şebeke alıcısına parası iade edildi. Var olmayan enerji için kimse ödeme almadı." Öneri geçmişinde **Uygulandı** rozetini göster.

> **Yanlış alarm senaryosu** (soru gelirse): aynı akışta "Yanlış alarm: serbest bırak" seçilirse gelir yatırımcılara dağıtılır.

### 10:00 – 11:30 · Likidite ve Açık Bankacılık

1. **Piyasa** sekmesi: "Hisseler yıllarca kilitli değil. İlan veren satıcının hissesi satılana kadar cüzdanında kalıyor ve gelir kazanmaya devam ediyor." Bir ilanda **Satın al** → onayla.
2. **Portföyüm** → **Açık Bankacılık ile yatır** → banka seç → **Devam et** → izin ekranı: "PSD2: kullanıcı neye izin verdiğini görüyor, 5 dakika geçerli, tek kullanımlık." → **yönlendir** → kod: **123456** → **Ödemeyi onayla** → USDC cüzdanda, zincir işlemi bağlantısı.

### 11:30 – 13:00 · Üretici paneli ve iş modeli

1. Sağ üstte çıkış → **Giriş yap** → **Absheron Wind Energy**. **Üretici Paneli**: "Platform üzerinden sağlanan finansman (ekrandaki rakamı okuyun, onlarca milyon dolar), performans oranı, bakım uyarıları."
2. **ESG & risk raporu (PDF)** → **PDF olarak indir**: "Bu, B2B SaaS ürünümüz: tek tıkla denetime hazır rapor."
3. **İş Modeli** sekmesi: "Dört gelir kalemi. İşlem komisyonu zincir üstü hazineden canlı okunuyor, SaaS aboneliği, lisanslama, ve gelecek fazda karbon kredisi."

### 13:00 – 15:00 · Teknik derinlik ve kapanış

1. **Teknoloji → YZ Laboratuvarı**: "%99,6 doğruluk, karışıklık matrisi, özellik önemi. Açık konuşalım: model simüle veriyle eğitildi; gerçek sahada ilk iş pilot veriyle yeniden eğitim."
2. **Canlı Mimari**'de bir katmana tıkla: "Her katmanda neyin gerçek, neyin simülasyon olduğu açıkça yazıyor."
3. **Kapanış cümlesi:** "Eco-Fraction ile 50 dolarla yeşil enerjinin ortağı olmak mümkün. Üretim IoT ile ölçülüyor, yapay zeka ile doğrulanıyor, gelir akıllı sözleşmeyle anında dağıtılıyor. Teşekkürler."

---

## C. Bir şey ters giderse

| Belirti | Çözüm | Süre |
|---|---|---|
| Sağ üstte **kırmızı nokta** (bağlantı yok) | Sayfayı yenile (F5) | 2 sn |
| Sayılar donmuş, simülasyon saati ilerlemiyor | Senaryo paneli → hız **300×** tekrar seç | 5 sn |
| Manipülasyon 30 saniyede işaretlenmedi | Paneli kapatıp aç, manipülasyonu tekrar başlat; bir saat daha bekle (12 sn) | 15 sn |
| Bir sayfa hata veriyor | Başka sekmeye geç, anlatmaya devam et; sonra F5 | – |
| Her şey bozuldu | `.\reset.ps1` (~2 dk). Bu sırada slaytlarla veya YZ Laboratuvarı ekran görüntüleriyle devam et | 2 dk |
| Yatırım "Insufficient USDC" | Portföy → Açık Bankacılık ile 1.000 $ yatır | 20 sn |

**Güvenlik ağı:** Sunumdan önce ekran kaydı al (`Win+Alt+R`): manipülasyon → emanet → çoklu imza akışının 90 saniyelik videosu. İnternet, elektrik veya bilgisayar sorununda videoyu oynat.

## D. Rol dağılımı (öneri)

- **Konuşmacı:** anlatır, sahnede jüriye döner.
- **Operatör:** fare ve klavye; bu plandaki tıklamaları yapar, senaryo panelini kullanır.
- **Yedek:** plan C'yi bilir, soru-cevapta teknik soruları alır (bkz. `JURY_QA.md`).
