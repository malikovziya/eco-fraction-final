# Eco-Fraction

**Yenilenebilir enerji varlıklarında kesirli yatırım: IoT ile ölçülür, yapay zeka ile doğrulanır, akıllı sözleşmeyle dağıtılır.**

Takım **VoltLedger** · Teknofest Finansal Teknolojiler Yarışması · Takım ID 932890

Eco-Fraction, Azerbaycan'daki güneş ve rüzgar santrallerini 10 $'lık ERC-1155 hisselerine böler (minimum yatırım 50 $). Her sensör okuması cihazın kendi anahtarıyla imzalanır, bir yapay zeka modeli fiziksel tutarlılığını denetler, her saatlik üretim zincire kaydedilir ve şebeke alıcısının ödemesi USDC olarak tüm hissedarlara otomatik dağıtılır. Şüpheli üretimin geliri dağıtılmaz; 2/3 çoklu imza kararına kadar emanette bekler.

---

## Neler gerçek, neler simülasyon?

| Bileşen | Durum | Açıklama |
|---|---|---|
| MQTT, Kafka akışı, imza doğrulama | ✅ Gerçek, çalışıyor | Mosquitto, Redpanda (Kafka API), Ed25519 |
| XGBoost anomali tespiti, LSTM tahmin | ✅ Gerçek modeller | Simüle edilmiş 90 günlük veriyle eğitildi, görülmemiş veriyle test edildi |
| 8 akıllı sözleşme | ✅ Gerçek, 22 test | Yerel EVM zinciri (Polygon uyumlu); isteğe bağlı Polygon Amoy dağıtımı |
| Otomatik gelir dağıtımı, emanet, çoklu imza | ✅ Zincir üstü | RevenueDistributor + MultiSig |
| IoT sensörleri | 🔵 Simülasyon | Güneş açısı + bulut ve rüzgar + türbin güç eğrisi fizik modelleri |
| USDC | 🟡 Test token | 6 ondalıklı MockUSDC |
| Açık Bankacılık, KYC | 🔵 Sandbox | Kurgusal bankalar (PSD2 akışı); cüzdan onayı gerçek zincir işlemi |
| Varlıklar, yatırımcılar, fonlar | 🔵 Demo verisi | Kurgusal isimler, gerçekçi konum ve kapasiteler |

---

## Mimari (ön rapor, Şekil 1)

```
[Fiziksel]     IoT sensörleri (6 cihaz, Ed25519)           iot/simulator.py
                    │ MQTT
[Veri]         İmza doğrulayan köprü → Kafka               iot/bridge.py · Redpanda
                    │ telemetry.verified / telemetry.rejected
[Zeka]         XGBoost + LSTM + ESG motoru                 backend/app/ai · esg.py
                    │ saatlik parti: hash + YZ kararı
[Blockchain]   EnergyOracle · AssetToken · Distributor     contracts/
                    │ kWh × 0,05 $ → USDC
[Finans]       Otomatik ödeme · emanet · Açık Bankacılık   backend/app/services · api/banking.py
                    │ WebSocket
[Kullanıcı]    Yatırımcı / üretici / yönetişim panelleri   frontend/
```

### Akıllı sözleşmeler (`contracts/contracts/`)

| Sözleşme | Görev |
|---|---|
| `AssetToken` | ERC-1155, her varlık bir token ID. Transferler yalnızca KYC onaylı cüzdanlar arasında |
| `KYCRegistry` | Doğrulanmış cüzdan listesi |
| `EnergyOracle` | Saatlik üretim partisi: enerji, veri özeti (SHA-256), YZ puanı ve kararı |
| `RevenueDistributor` | Şebeke ödemesini pay başına birikimli gelir modeliyle dağıtır; işaretli partiler emanette |
| `PrimaryMarket` | 10 $/hisse birincil satış, 50 $ minimum, %1 komisyon |
| `Marketplace` | Emanetsiz ikincil piyasa (satılana kadar hisse satıcıda kalır ve gelir kazanır) |
| `MultiSig` | 2/3 onay: emaneti serbest bırakma veya iade, komisyon değişikliği, durdurma |
| `MockUSDC` | Test stablecoin |

Dağıtımdan sonra tüm yönetici rolleri çoklu imzaya devredilir, dağıtıcı hesap yetkilerini bırakır.

### Yapay zeka (`backend/app/ai/`)

| Model | Görev | Görülmemiş test verisinde sonuç |
|---|---|---|
| XGBoost (4 sınıf) | Her okuma: normal / sayaç şişirme / donmuş sinyal / performans düşüşü | %99,6 doğruluk, SHAP ile karar açıklaması |
| LSTM + fiziksel ön bilgi | Sonraki 24 saatin üretim tahmini | Naif tahminden güneşte %26, rüzgarda %28 daha iyi |

Karar politikası: şişirme ve donmuş sinyal geliri emanete alır; performans düşüşü yalnızca bakım uyarısı üretir; sahte cihaz köprüde reddedilir. Model kartları: `GET /api/ai/models` veya uygulamada **Teknoloji → YZ Laboratuvarı**.

---

## Çalıştırma

Gereksinimler: Windows, Docker Desktop, Python 3.12, Node.js 20+.

```powershell
.\start.ps1         # her şeyi başlatır (ilk çalıştırmada bağımlılıkları kurar)
.\reset.ps1         # temiz ve aynı başlangıç durumu: sunum ve provalardan önce
.\stop.ps1          # her şeyi durdurur
.\start.ps1 -Dev    # geliştirme: anlık yeniden yükleme
```

| Servis | Adres |
|---|---|
| Uygulama | http://localhost:3000 |
| API dokümantasyonu | http://localhost:8100/docs |
| Kafka konsolu | http://localhost:8080 |
| Yerel zincir RPC | http://localhost:8545 |

Tamamen çevrimdışı çalışır (fontlar, harita ve tüm veriler yerel).

### Demo hesapları

Giriş sayfasında tek tıkla: **Aylin Kaya** (yatırımcı, 8.000 $ portföy), **Caspian Solar Holdings** ve **Absheron Wind Energy** (üreticiler), **Leyla Hasanova / Murat Demir / Elvin Aliyev** (çoklu imza yetkilileri). Açık Bankacılık sandbox kodu: `123456`.

**Senaryo paneli:** herhangi bir sayfada `Ctrl+Shift+D`. Arıza veya saldırı enjekte etme (sayaç manipülasyonu, donmuş sinyal, performans kaybı, sahte cihaz), simülasyon hızı, persona değiştirme.

---

## Testler

```powershell
cd contracts; npx hardhat test                       # 22 sözleşme testi
.venv\Scripts\python backend\scripts\e2e.py          # uçtan uca: yatırım → manipülasyon → emanet → çoklu imza,
                                                     # sahte cihaz, bakım, piyasa, açık bankacılık, üretici raporu
.venv\Scripts\python backend\scripts\soak.py 20      # 20 dakikalık kararlılık testi
.venv\Scripts\python frontend\scripts\screenshots.py <klasör>   # tüm sayfaların ekran görüntüsü (playwright gerekir)
```

---

## Polygon Amoy testnet'e dağıtım (isteğe bağlı)

Aynı sözleşmeleri herkese açık testnet'e yükler; uygulamanın **Blok Gezgini** sayfasında Polygonscan bağlantıları görünür. Canlı demo yerel zincirde kalır.

1. **Yeni** bir test cüzdanı oluşturun (gerçek para bulunan cüzdanı asla kullanmayın) ve bir faucet'ten 0,5–1 test POL alın (ör. faucet.polygon.technology).
2. Anahtarı Hardhat'in yerel değişken deposuna kaydedin (repoya girmez):
   ```powershell
   cd contracts
   npx hardhat vars set AMOY_PRIVATE_KEY
   npx hardhat vars set POLYGONSCAN_API_KEY   # isteğe bağlı: kaynak kodunu doğrular (etherscan.io API anahtarı)
   ```
3. Dağıtın:
   ```powershell
   npx hardhat run scripts/deploy-public.js --network amoy
   ```
   Adresler `contracts/deployments/amoy.json` dosyasına yazılır ve uygulama bunları otomatik gösterir.

---

## Depo yapısı

```
iot/         sensör simülatörü, fizik modelleri, imzalar, MQTT→Kafka köprüsü
backend/     FastAPI: YZ, ESG, zincir entegrasyonu, piyasa, bankacılık, yönetişim API'leri
contracts/   Solidity sözleşmeleri, testler, dağıtım betikleri
frontend/    Next.js arayüzü (TR/EN, USD/AZN/TRY)
shared/      varlık tanımları (tüm katmanların tek kaynağı)
infra/       docker-compose: Mosquitto, Redpanda, yerel zincir
docs/        sunum akış planı, jüri soru-cevap hazırlığı
```

## Bilinen sınırlamalar

- YZ modelleri simüle veriyle eğitildi; gerçek sahada pilot veriyle yeniden eğitim gerekir.
- Emanetli cüzdan anahtarları demo için yerel olarak şifreli saklanır; üretimde HSM/MPC gerekir.
- Sözleşmeler bağımsız denetimden geçmedi.
- Düzenleyici onay yok; pilot sandbox ortamında planlanmaktadır.

*Demo ortamı: yerel zincir ve test USDC. Yatırım tavsiyesi değildir.*
