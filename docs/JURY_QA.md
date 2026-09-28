# Jüri Soru-Cevap Hazırlığı

Takım VoltLedger · Eco-Fraction

> Kural: **Her zaman dürüst olun.** Demoda neyin gerçek, neyin simülasyon olduğunu açıkça söylemek güven kazandırır. Bilmediğiniz bir şey sorulursa: "Bu, pilot aşamasında doğrulayacağımız bir konu" deyin.

## Demo ve dürüstlük

**S: Ekrandaki 200 yatırımcı ve kurumsal fonlar gerçek mi?**
C: Hayır, demo verisi. Her biri gerçek bir zincir üstü cüzdan (KYC onaylı, gerçek işlemler), ama kişiler ve fonlar kurgusal. Pazar davranışını göstermek için sunumdan önce otomatik oluşturuluyor. Varlık isimleri de kurgusal; konumlar ve kapasiteler gerçekçi.

**S: Neler gerçek, neler simülasyon?**
C: Canlı Mimari sayfasında her katman için yazıyor. Kısaca:
- **Gerçek, çalışıyor:** MQTT, Kafka akışı, imza doğrulama, XGBoost ve LSTM modelleri, 8 akıllı sözleşme, otomatik ödeme, çoklu imza.
- **Yerel zincir:** Sözleşmeler Polygon uyumlu yerel bir EVM zincirinde çalışıyor (sahnede internet riski olmasın diye). Aynı sözleşmeler Polygon Amoy testnet'ine dağıtılmaya hazır (`deploy-public.js`). *Amoy dağıtımı yapıldıysa: "Blok Gezgini sayfasında Polygonscan bağlantıları var" deyin.*
- **Simülasyon:** IoT sensörleri (fizik modeliyle), bankalar (PSD2 sandbox), KYC kontrolleri.
- **Test token:** USDC yerine aynı 6 ondalıklı test token.

**S: Yapay zeka simüle veriyle eğitildiyse %99,6 doğruluk anlamlı mı?**
C: Yöntem açısından anlamlı, sayı açısından iyimser. Modeli görmediği günlerle (zamana göre %80/%20 ayrım) test ettik. Ancak gerçek sahada gürültü, sensör arızaları ve mevsimsellik daha karmaşık. Pilot aşamada gerçek sayaç verisiyle yeniden eğitim ve kalibrasyon planlıyoruz. Asıl güçlü yan mimari: fizik tabanlı özellikler (sayacın bildirdiği üretim, ışınım veya rüzgar hızının izin verdiğiyle tutarlı mı?) gerçek veride de geçerli.

## Blockchain ve güvenlik

**S: Neden blockchain? Bir veritabanı yetmez mi?**
C: Üç nedenle yetmez:
1. **Değiştirilemez kayıt:** Üretim verisinin özeti zincirde, yatırımcı platforma güvenmek zorunda değil, kendisi doğrulayabilir (Doğrula butonu).
2. **Otomatik ödeme:** Geliri hiçbir çalışan tutamaz veya geciktiremez, sözleşme dağıtır.
3. **Kesirli mülkiyet ve likidite:** ERC-1155 hisseleri cüzdanlar arası transfer edilebilir.

**S: Oracle problemi: sensör yalan söylerse?**
C: Üç katmanlı savunma:
1. Her cihazın kendi anahtarı var; sahte cihaz köprüde reddedilir.
2. Gerçek cihaz manipüle edilirse YZ fiziksel tutarsızlığı yakalar.
3. Şüpheli gelir otomatik dağıtılmaz, emanete alınır ve insan (2/3 çoklu imza) karar verir.
Gerçek sahada buna ek olarak kurcalamaya dayanıklı donanım (secure element) ve sertifikalı sayaçlar kullanılır.

**S: Akıllı sözleşme hatası olursa?**
C: 22 birim testimiz var: KYC, minimum yatırım, komisyon sınırları, pro-rata dağıtım, emanet, çoklu imza. OpenZeppelin'in denetlenmiş kütüphaneleri kullanılıyor. Tüm yönetici yetkileri 2/3 çoklu imzada; dağıtıcı hesap yetkilerini bırakıyor. Transferler acil durumda durdurulabilir (pause). Ayrıca sektör standardı güvenlik tarayıcısı **Slither** ile (102 kontrol) taradık: **gerçek açık yok**; 4 bulguyu iyileştirdik, kalan 9'u tasarım gereği ve gerekçeleri `docs/SECURITY_SCAN.md` dosyasında. Ana ağ öncesi bağımsız denetim (audit) planlı.

**S: "Doğrula" butonuna neden güvenelim? Sonuçta sizin sunucunuz söylüyor.**
C: Hayır, sunucumuz söylemiyor. Kontrol **sizin tarayıcınızda** yapılıyor: tarayıcı o saatin imzalı sensör mesajlarını indirip parmak izini (SHA-256) kendisi hesaplıyor ve blokzincirdeki kaydı **doğrudan zincirden** okuyup karşılaştırıyor. Tek bir rakam değişse parmak izi tutmaz. Kısacası: "Bize güvenmeyin, kendiniz doğrulayın."

**S: Platformun anahtarı çalınırsa?**
C: Platform anahtarı yalnızca operasyonel işleri yapabilir (parti kaydı, ödeme, KYC onayı). Emanetteki parayı hareket ettiremez, bu yetki 2/3 çoklu imzada. Üretimde ayrıca şebeke alıcısının ödeme onayı sınırsız değil, aylık limitli olur (otomatik ödeme talimatındaki limit gibi); böylece anahtar çalınsa bile zarar sınırlı kalır.

**S: Yatırımcı sayısı artınca ödeme maliyeti patlamaz mı?**
C: Hayır. "Pay başına birikimli gelir" (accumulator) modeli kullanıyoruz: her üretim partisi O(1) maliyetle kaydediliyor, yatırımcı sayısından bağımsız. Otomatik gönderim (keeper) gruplar halinde yapılıyor; yatırımcı istediğinde kendisi de talep edebilir.

**S: Anahtarlar kimde? Kullanıcı cüzdanı kaybederse?**
C: Demoda emanetli (custodial) cüzdan kullanıyoruz, anahtarlar şifreli saklanıyor. Bu, kripto bilmeyen bireysel yatırımcı için doğru deneyim. Üretimde HSM/MPC tabanlı anahtar yönetimi ve isteyen kullanıcıya kendi cüzdanını (self-custody) bağlama seçeneği planlıyoruz.

**S: Neden Polygon?**
C: Düşük işlem maliyeti (saatlik kayıt ve ödeme ekonomik), EVM uyumlu (standart araçlar, denetçiler), ve raporumuzdaki gibi sürdürülebilirlik odaklı bir ağ.

**S: Polygon'da nerede? Gösterebilir misiniz?**
C: Canlı demo, internet bağlantısına bağlı kalmamak için blokzincirin yerel bir kopyasında çalışıyor. Aynı sözleşmeler Polygon'un herkese açık test ağına (Amoy) dağıtılmaya hazır; dağıtım betiği önce toplam işlem ücretini kontrol ediyor ve yetmezse hiç başlamıyor. Kod tamamen aynı, yalnızca ağ adresi farklı.

## Regülasyon

**S: Bu bir menkul kıymet değil mi? Lisans gerekmez mi?**
C: Evet, hisse tokenı menkul kıymet niteliği taşıyabilir ve bunu risk tablomuzda "Yüksek" olarak işaretledik. Bu yüzden:
- Transferler yalnızca KYC onaylı cüzdanlar arasında (ERC-3643 benzeri uyum).
- Pilotu düzenleyici sandbox ortamında yapmayı hedefliyoruz: Türkiye'de SPK, Azerbaycan'da Merkez Bankası'nın FinTech sandbox'ı.
- AB için MiCA ve menkul kıymet mevzuatı ayrıca değerlendirilecek.
Hukuk danışmanlığı yol haritamızda var.

**S: Kişisel veriler (KVKK/GDPR)?**
C: Zincirde kişisel veri yok, yalnızca cüzdan adresleri ve üretim özetleri var. KYC verisi zincir dışında, şifreli ve KVKK'ya uygun saklanır.

## İş modeli ve pazar

**S: 50 dolar yatırım saatte 0,001 dolar kazandırıyor. Kim bunu ister?**
C: Yıllık bazda bu yaklaşık %9–12 brüt getiri (güneşte %9,3, rüzgarda %11,8), bir mevduat veya tahvil ile kıyaslanabilir. Üstelik gelir düzenli ve şeffaf, CO₂ etkisi ölçülebilir. 50 dolar giriş kapısı; ortalama yatırımın daha yüksek olmasını bekliyoruz.

**S: Getiri hesabı nereden geliyor?**
C: Kapasite × gerçekçi kapasite faktörü (güneş %17, rüzgar %35) × 8.760 saat × 0,05 $/kWh PPA tarifesi, bölü varlık değeri (güneş 0,8 M$/MW, rüzgar 1,3 M$/MW). Operasyon maliyetleri öncesi brüt değer.

**S: Platform nasıl para kazanıyor?**
C: İş Modeli sayfasındaki dört kalem:
1. Alım-satımdan %0,5–1,5 komisyon (canlı, zincirde).
2. Enerji şirketlerine SaaS aboneliği.
3. ESG doğrulama altyapısının lisanslanması.
4. Gelecek fazda karbon kredisi.

**S: Rakiplerden farkınız?**
C: RealT kesirli mülkiyet sunuyor ama IoT ve ESG doğrulaması yok. Toucan karbon odaklı. Hiçbiri IoT + YZ doğrulama + otomatik dağıtım + açık bankacılığı uçtan uca birleştirmiyor. Asıl fark: **doğrulanmamış gelir dağıtılmıyor.**

**S: Neden Azerbaycan?**
C: 2030 Yeşil Enerji Stratejisi ve 3 milyar dolarlık yatırım hedefi; güçlü rüzgar (Abşeron) ve güneş potansiyeli; ekibimizin bölgesel bağlantıları. Model Türkiye'ye ve diğer ülkelere doğrudan taşınabilir.

**S: Enerji üreticisi neden bu platformu kullansın?**
C: Banka kredisine alternatif finansman, uluslararası bireysel yatırımcıya erişim, otomatik ESG raporu (yeşil tahvil ve sürdürülebilirlik raporlaması için) ve bakım uyarıları.

## Teknik

**S: YZ yanlış alarm verirse yatırımcı mağdur olur mu?**
C: Hayır. Gelir silinmez, emanette bekler. Çoklu imza yanlış alarm derse gelir yatırımcılara dağıtılır. Performans düşüşü (dürüst yıpranma) emanete bile alınmaz, sadece bakım uyarısı üretir.

**S: Gerçek IoT cihazı nasıl bağlanır?**
C: Aynı MQTT konu yapısına imzalı mesaj gönderen herhangi bir cihaz (ESP32, endüstriyel sayaç ağ geçidi). Üretimde köprünün yerini AWS IoT Core alır: cihaz sertifikaları ve TLS 1.3. Mimari aynı kalır.

**S: Ölçeklenebilirlik?**
C: Kafka yatay ölçeklenir, AI puanlaması okuma başına milisaniye mertebesinde. Zincirde işlem sayısı varlık başına saatte 3, yatırımcı sayısından bağımsız.

**S: ESG skoru greenwashing'e açık değil mi?**
C: Tersine: çevre ve yönetişim puanları canlı veriden hesaplanıyor ve bileşenler açık. Yalnızca sosyal (S) puanı üretici beyanı, bunu raporda açıkça belirtiyoruz. Yıllık bağımsız denetimle doğrulanacak.

**S: Yapay zeka riskleri nasıl analiz ediyor?**
C: Her varlık için canlı bir **risk skoru (0–100, Düşük/Orta/Yüksek)** üç sinyalden hesaplanıyor:
1. **Manipülasyon sinyali (XGBoost):** son 24 saatte işaretlenen veya emanette bekleyen saatler.
2. **Tahmine göre performans (LSTM):** YZ her saat bir sonraki saatin üretimini tahmin ediyor; son 24 saatte gerçekleşen üretim tahminden çok saparsa risk yükseliyor (düşükse olası yıpranma, yüksekse olası sayaç şişirmesi).
3. **Veri güvenilirliği (Ed25519):** engellenen sahte cihaz mesajları.
Her skorun yanında gerekçesi düz bir cümleyle yazıyor. Sunumda sayaç manipülasyonu başlatınca risk bir dakika içinde "Yüksek"e çıkıyor.

**S: Risk eşiklerini nasıl belirlediniz?**
C: Tahmin etmedik, **kalibre ettik**. Aynı simülatörü, modelin hiç görmediği tohumlarla 40 günlük normal çalışma ve arıza senaryolarında çalıştırdık (`backend/scripts/calibrate_risk.py`). Normal günlerde üretim, tahminden güneşte en fazla yaklaşık %18, rüzgarda %26 sapıyor; yıpranmada %44–68, sayaç şişirmesinde %32'nin üstünde. Bu yüzden normal aralık güneşte ±%20, rüzgarda ±%30. Canlı testte sağlıklı santraller 4 simüle gün boyunca hep "Düşük" kaldı, yani yanlış alarm yok.

## Sonraki adımlar (yol haritası)

1. Bir üreticiyle gerçek sayaç verisiyle pilot (sandbox).
2. Gerçek veriyle model yeniden eğitimi.
3. Bağımsız akıllı sözleşme denetimi.
4. Hukuki yapılandırma (SPK / Azerbaycan Merkez Bankası sandbox).
5. Polygon ana ağ ve gerçek USDC.
6. Karbon kredisi modülü.
