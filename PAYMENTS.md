# OsonTarget — to'lovlar (balansni to'ldirish)

Bu hujjat OsonTarget mijozi so'm balansini qanday to'ldirishini tasvirlaydi: qaysi to'lov
tizimlari, ular Paylinker orqali qanday ulanadi, Humo/Uzcard karta o'tkazmasi qanday
tinglanadi va kod qayerda yashaydi.

**Chegara:** to'lov qismining yagona vazifasi — mijoz balansini to'ldirish. Balans modeli,
e'lon yaratish va balansdan reklamaga yechish alohida qism (`src/balance/**`, `src/ads/**`).
To'lov kodi balansga o'zi yozmaydi, faqat bitta metodni chaqiradi:

```ts
balance.credit(userId, amountUzs, { source: 'paylinker' | 'card' | 'stars' | 'lava', externalId, note })
// → { credited: boolean; balanceUzs }   credited=false — bu (source, externalId) allaqachon yozilgan
```

Takroriy webhook yoki ikki marta kelgan SMS balansni ikki marta to'ldirmaydi — bunga
`(source, externalId)` bo'yicha unikallik kafolat beradi.

---

## 1. Qaysi to'lov tizimlari

StarsPaymee botidagi barcha usullar. Ulardan beshtasi Paylinker orqali o'tadi, qolganlari alohida.

| Usul | Qanday ishlaydi | Kanal | Bosqich |
|---|---|---|---|
| **Click** | Click to'lov sahifasi (veb) yoki Click ilovasi | Paylinker | 1 |
| **Payme** | checkout.paycom.uz (veb), karta yoki Payme ilovasi | Paylinker | 1 |
| **Uzum Bank** | Uzum Bank ilovasi deeplink'i, raqam oldindan to'ldirilgan | Paylinker | 2 |
| **Paynet** | Paynet ilovasi havolasi, raqam va summa oldindan to'ldirilgan | Paylinker | 2 |
| **Uzcard / Humo o'tkazma** | Kartaga aniq summa → bank SMS → tinglovchi | O'zimiz | 3 |
| **Telegram Stars** | @Osontarget_bot invoice (XTR) | Telegram | 4 |
| **СБП (rubl)** | Lava.ru shlyuzi | Lava | 4 |

Bot'dagi "balansdan to'lash" va "Paynet bankomati" bu yerda kerak emas: birinchisi balansning
o'zi, ikkinchisi 4-bosqichdagi ixtiyoriy kengaytma (8-bo'lim).

---

## 2. Kassa: yangisi kerakmi?

Ikki xil "kassa" bor va ularni aralashtirmaslik kerak.

### 2.1. Paylinker loyihasi — HA, yangisi majburiy

Paylinker ko'p loyihali. OsonTarget uchun admin panelda **alohida loyiha** ochiladi:

| Maydon | Qiymat |
|---|---|
| Nomi / slug | `OsonTarget` / `osontarget` |
| `webhookUrl` | `https://api.osontarget.uz/api/payments/paylinker/webhook` |
| `defaultReturnUrl` | `https://osontarget.uz/dashboard/balance` |
| `invoiceTtlMinutes` | `30` |
| `webPayEnabled` | `true` — Payme veb sahifasi shuni talab qiladi |
| `riskEnabled` | `true` |
| `fiscalTin` / `fiscalPinfl` | kassa egasining STIR/JSHSHIR (2.3 ga qarang) |

Loyiha o'z API kalitini (`pk_live_…`) va webhook imzo kalitini (`whsec_…`) beradi. StarsPaymee
bilan hech narsa aralashmaydi: webhook'lar, statistika va qaytarishlar loyiha bo'yicha alohida.

### 2.2. Provayder kassalari — boshida UMUMIY, keyin alohida

Paylinker'dagi Click, Payme, Paynet va Uzum shartnomalari **platforma darajasida**. Yangi
loyiha ularni avtomatik ishlatadi, ya'ni OsonTarget **birinchi kundan** hech qanday yangi
shartnoma va sertifikatsiyasiz ishlay oladi.

Lekin umumiy kassaning uchta oqibati bor:

1. **Brend.** Click sahifasi, Payme checkout'i, Paynet va Uzum ilovalarida mijoz OsonTarget emas,
   **StarsPaymee** xizmati nomini ko'radi. Bu ishonchga ta'sir qiladi.
2. **Hisob-kitob.** Pul StarsPaymee bilan bir xil merchant hisobiga tushadi. Paylinker uni loyiha
   bo'yicha ajratadi, lekin bank ko'chirmasida hammasi bitta.
3. **Paynet login to'qnashuvi.** 8-bo'limga qarang — umumiy Paynet shartnomasida Telegram ID'ni
   login sifatida ishlatib bo'lmaydi.

Paylinker har loyihaga **o'z kassasini** ulashga imkon beradi (admin → loyiha → shartnomalar).
Kod tekshirildi: Click webhook'i shartnomani invoice'dan oladi, Payme/Paynet/Uzum esa login-parol
bo'yicha topadi. Demak ikkita kassa yonma-yon ishlaydi va **OsonTarget kodi o'zgarmaydi** —
almashtirish faqat admin panelda qilinadi.

| Provayder | Alohida kassa olish | Qiyinligi |
|---|---|---|
| Click | o'sha merchant ostida yangi xizmat (`service_id`) | oson, kabinetda |
| Payme | Payme Business'da yangi kassa; endpoint o'sha — `https://api.paylinker.uz/webhooks/payme` | oson, lekin qumloq qaytadan |
| Uzum | Uzum'dan yangi xizmat va `serviceId` | o'rtacha |
| Paynet | yangi xizmat, yangi ilova va anketa, sertifikatsiya | og'ir |

### 2.3. Qaror

- **OsonTarget StarsPaymee bilan bir yuridik shaxsga** (o'sha YTT) tegishli bo'lsa: umumiy kassalar
  bilan ishga tushamiz, parallel ravishda Click xizmati va Payme kassasini alohida olamiz (brend
  uchun eng muhimi shu ikkisi). Paynet va Uzum — hajm oshganda.
- **Boshqa yuridik shaxs** bo'lsa: alohida kassalar ishga tushirishdan **oldin** majburiy. Pul va
  fiskal chek to'g'ri shaxs nomiga tushishi kerak, umumiy kassa bilan bu mumkin emas.

Bu savolga javob ishga tushirish rejasini belgilaydi.

---

## 3. Umumiy arxitektura

```
                 ┌──────────── osontarget.uz (Next.js, Vercel) ────────────┐
 Mijoz ─────────►│ /dashboard/balance/topup   →  BFF  →  x-internal-secret │
                 └──────────────────────────────────┬──────────────────────┘
                                                    ▼
             ┌──────────── api.osontarget.uz (NestJS, pm2) ─────────────┐
             │  PaymentsModule                                          │
             │    POST /api/payments/topups      ──►  Paylinker API     │
             │    GET  /api/payments/topups/:id                         │
             │    POST /api/payments/paylinker/webhook  ◄── Paylinker   │ (@AllowDirect, HMAC)
             │                          │                               │
             │                          ▼                               │
             │                 BalanceService.credit()  (src/balance)   │
             └──────────────────────────▲───────────────────────────────┘
                                        │ Prisma (bitta Postgres)
             ┌──────────── osontarget-card-listener (pm2) ──────────────┐
             │  Telegram userbot → bank bot chatlari → SMS → moslash     │
             └───────────────────────────────────────────────────────────┘
```

Ikki muhim nuqta:

- **Webhook BFF orqali o'tmaydi.** Paylinker to'g'ridan-to'g'ri `api.osontarget.uz` ga uradi.
  Backend hamma so'rovdan `x-internal-secret` talab qiladi, shuning uchun webhook marshruti
  `@AllowDirect() @Public()` bilan belgilanadi va o'z himoyasini **HMAC imzo** bilan ta'minlaydi
  (decorators.ts'dagi izohda aynan shu nazarda tutilgan).
- **Imzo xom tana bo'yicha.** `NestFactory.create(AppModule, { rawBody: true })` — aks holda JSON
  qayta tuzilgach imzo mos kelmaydi.

---

## 4. Ma'lumotlar modeli (`src/payments/**`)

Balans jadvallari `src/balance` da (u qismga tegishli). To'lov qismi o'zining ikkita jadvalini qo'shadi:

```prisma
enum TopupMethod { CLICK PAYME UZUM PAYNET CARD STARS SBP }
enum TopupStatus { PENDING PAID EXPIRED CANCELLED FAILED REFUNDED }

/// To'ldirish niyati — mijoz "To'ldirish" bosganda yaratiladi.
model Topup {
  id              String      @id @default(cuid())   // Paylinker externalId ham shu
  userId          String
  method          TopupMethod
  /// Balansga tushadigan summa (so'm)
  creditUzs       Decimal     @db.Decimal(14, 2)
  /// Mijoz to'laydigan summa: komissiya va karta uchun noyob qo'shimcha bilan
  payUzs          Decimal     @db.Decimal(14, 2)
  status          TopupStatus @default(PENDING)
  paylinkerInvoiceId String?  @unique
  /// Paylinker hisob raqami (Payme/Paynet/Uzum) — qo'llab-quvvatlashda kerak
  accountNumber   String?
  payUrl          String?
  /// Karta: qaysi kartaga (oxirgi 4 raqam)
  cardLast4       String?
  expiresAt       DateTime
  paidAt          DateTime?
  createdAt       DateTime    @default(now())

  @@index([userId, createdAt])
  @@index([method, status, payUzs])                 // karta moslash shu indeks bo'yicha
}

/// Bank SMS daftari — har xabar BIR MARTA, aniq tiyin bilan.
model CardSms {
  id         String   @id @default(cuid())
  account    String                                 // userbot akkaunti
  chatId     String
  messageId  Int
  brand      String                                 // humo | uzcard
  cardLast4  String?
  amountTiyin BigInt?
  bankTime   DateTime?
  rawText    String                                 // ⚠️ karta qoldig'i bor — tashqariga chiqmaydi
  status     String   @default("new")               // new | used | unmatched | ignored
  topupId    String?  @unique                       // bitta SMS — bitta to'ldirish
  createdAt  DateTime @default(now())

  @@unique([account, chatId, messageId])            // gramjs xabarni qayta yetkazsa ham bir marta
  @@index([status, createdAt])
}
```

Migratsiya faqat **qo'shuvchi**: `User` va balans jadvallariga tegmaydi.

---

## 5. Paylinker orqali to'lov (Click, Payme, Uzum, Paynet)

### 5.1. Oqim

```
1. POST /api/payments/topups { method: "PAYME", amountUzs: 100000 }        (JWT)
2. Topup(PENDING) yaratiladi; payUzs = creditUzs + komissiya
3. Paylinker: POST /v1/invoices
     { externalId: topup.id, amount: payUzs, provider: "PAYME",
       description: "OsonTarget balansini to'ldirish",
       returnUrl: "https://osontarget.uz/dashboard/balance?topup=<id>",
       metadata: { userId } }
   → { invoiceId, payUrl, accountNumber }
4. Frontend: tugma (payUrl) + kompyuterda QR + kerak bo'lsa hisob raqami
5. Paylinker → POST /api/payments/paylinker/webhook  (invoice.paid)
6. Bitta tranzaksiyada: Topup PENDING→PAID (shartli UPDATE) + balance.credit(source='paylinker', externalId=invoiceId)
7. @Osontarget_bot orqali mijozga xabar
```

### 5.2. Provayderlar farqi

| | `payUrl` | Kompyuterda | Hisob raqamini ko'rsatish |
|---|---|---|---|
| Click | veb sahifa | ochiladi | yo'q |
| Payme | checkout.paycom.uz | ochiladi | ixtiyoriy |
| Uzum | `uzumbank.uz/open-service?serviceId=…&account=…` (Paylinker quradi) | **ochilmaydi** — QR kerak | **ha** |
| Paynet | Paylinker `null` qaytaradi → `https://app.paynet.uz/?m=<PAYNET_APP_MERCHANT>&c=<accountNumber>&a=<so'm>` o'zimiz quramiz | **ochilmaydi** — QR kerak | **ha** |

OsonTarget **veb-sayt**, Telegram Mini App emas. Uzum va Paynet faqat telefon ilovasida ishlaydi,
shuning uchun kompyuterdan kirgan mijozga sahifa **QR kod** ko'rsatadi (telefon kamerasi bilan
skanerlanadi) va zaxira sifatida hisob raqamini nusxalash tugmasi bilan beradi.

### 5.3. Webhook — xavfsizlik va takror

```
X-Paylinker-Event:     invoice.paid | invoice.expired | invoice.cancelled | invoice.failed | invoice.refunded
X-Paylinker-Timestamp: <unix soniya>
X-Paylinker-Signature: sha256=<hex>
imzo = HMAC-SHA256(PAYLINKER_WEBHOOK_SECRET, `${timestamp}.${rawBody}`)
```

- Imzo `timingSafeEqual` bilan, vaqt oynasi 24 soat (Paylinker 7 martagacha qayta uradi: 10s → 6h).
- Javob faqat `2xx` bo'lsa qayta urinish to'xtaydi. Ichki xato → `500` (Paylinker qayta uradi).
- Noma'lum `externalId` → `200` (qayta urmasin) + jurnal.
- **To'langan summa tekshiriladi:** `data.amount` < `topup.payUzs` bo'lsa balansga yozilmaydi.
- `invoice.expired` / `cancelled` → Topup `EXPIRED`. `invoice.refunded` → balansdan qaytarish
  (yetmasa — admin'ga ogohlantirish, manfiyga tushirilmaydi).

### 5.4. Zaxira tekshiruvlar

Webhook kechikishi yoki yo'qolishi mumkin:

- `GET /api/payments/topups/:id` — `PENDING` bo'lsa va 20 soniyadan eski bo'lsa, Paylinker'dan
  `GET /v1/invoices/by-external/:id` bilan jonli holat so'raladi (frontend shu endpoint'ni so'raydi).
- Cron (har 10 daqiqa): muddati o'tgan `PENDING` to'ldirishlar Paylinker bilan solishtiriladi.

---

## 6. Uzcard / Humo karta o'tkazmasi

Bu yagona usul — Paylinker'siz, o'zimiz tinglaymiz. StarsPaymee'dagi tajribadan olingan tuzilma,
lekin ancha soddaroq: OsonTarget'da **bitta buyurtma turi** bor (balans to'ldirish), shuning uchun
StarsPaymee'dagi 16 ta `MATCH_API_*` endpoint zanjiri kerak emas — bitta so'rov yetadi.

### 6.1. Oqim

```
1. POST /api/payments/topups { method: "CARD", amountUzs: 100000 }
2. Noyob summa: 100 000 → 100 050 (o'sha paytdagi boshqa PENDING karta to'ldirishlari bilan
   to'qnashmaydigan eng kichik qo'shimcha, 50 so'm qadam). Kutish: 30 daqiqa.
3. Ekranda: karta raqami (nusxalash) + ANIQ summa + teskari sanoq + "To'ladim" tugmasi
4. Mijoz o'tkazadi → Humo/Uzcard boti userbot akkauntiga SMS yuboradi
5. Tinglovchi: SMS → CardSms (takrorsiz) → parser → moslash → balance.credit(source='card', externalId=sms.id)
```

### 6.2. Tinglovchi — alohida jarayon

`src/card-listener/main.ts` — NestJS **standalone** konteksti (`createApplicationContext`),
alohida pm2 jarayoni `osontarget-card-listener`. API bilan bitta bazani ishlatadi, lekin u
yiqilsa yoki qayta ulanayotgan bo'lsa API ishlashda davom etadi.

```
src/card-listener/
  main.ts                 standalone kontekst, SIGTERM'da toza o'chish
  listener.service.ts     gramjs TelegramClient, NewMessage, qayta ulanish, FLOOD_WAIT
  heartbeat.service.ts    har 60s "tirikman" yozuvi
src/payments/card/
  sms-parsers.ts          sof funksiyalar — Humo va Uzcard formatlari
  sms-parsers.spec.ts     HAQIQIY SMS namunalari bilan testlar
  sms-ledger.service.ts   CardSms yozish (account, chat, messageId bo'yicha bir marta)
  card-matcher.service.ts noyob summa bo'yicha moslash (bitta tranzaksiya)
  unique-amount.ts        bo'sh qo'shimchani topish
```

### 6.3. Uni "chiroyli" qiladigan narsalar

- **Har xabar bir marta.** `@@unique([account, chatId, messageId])` — gramjs xabarni qayta yetkazsa,
  u ikkinchi marta to'lov bo'lib hisoblanmaydi. StarsPaymee'da bu keyin qo'shilgan, bu yerda boshidan.
- **Aniq tiyin.** `21 836.23` → `2183623`. Eski parser kasrni tashlab yuborardi.
- **Bitta SMS — bitta to'ldirish.** `CardSms.topupId @unique` va moslash shartli UPDATE bilan.
- **Topilmagan SMS yo'qolmaydi.** `unmatched` holatida qoladi; admin sahifasida ro'yxat, "mijozga
  biriktirish" tugmasi (audit bilan). Kam/ko'p to'langan pul shu yerdan topiladi.
- **Qoldiq sir.** SMS matnidagi karta qoldig'i faqat `CardSms.rawText` da; logga, admin'ga
  bildirishnomaga, mijozga chiqmaydi.
- **Tinglovchi o'lsa — usul yashirinadi.** Heartbeat 5 daqiqadan eski bo'lsa, `GET /api/payments/methods`
  karta usulini qaytarmaydi va admin'larga bot orqali xabar boradi. O'lik tinglovchi bilan karta
  ko'rsatish — pul tushadi, lekin balans to'lmaydi.
- **Bir nechta karta.** `PAYMENT_CARDS` ro'yxatidan faol karta tanlanadi (rotatsiya, kunlik limit
  yaqinlashganda almashtirish).
- **Parser testlari haqiqiy SMS bilan.** Har yangi bank formati uchun avval test, keyin regex.

### 6.4. Firibgarlikka qarshi

Karta o'tkazmasi tasdiqni bankdan emas, SMS'dan oladi — shuning uchun eng ehtiyotkor usul.
StarsPaymee'da 23.09 da bitta foydalanuvchi katta summani 10 daqiqada bo'lib-bo'lib to'ldirgan;
o'sha tajribadan kelib chiqib, boshidan:

- bitta to'ldirish chegarasi va 24 soatlik soni (masalan 3 ta, keyin admin ruxsati);
- bitta mijozda bir vaqtda bitta kutilayotgan karta to'ldirishi;
- noyob summa band bo'lsa yangi summa beriladi, hech qachon ikkita bir xil `PENDING` summa bo'lmaydi.

---

## 7. Endpointlar va frontend

### Backend (JWT, BFF orqali)

| Metod | Yo'l | Vazifa |
|---|---|---|
| `GET` | `/api/payments/methods` | yoqilgan usullar, chegaralar, komissiya (tinglovchi holati hisobga olinadi) |
| `POST` | `/api/payments/topups` | `{ method, amountUzs }` → to'ldirish + to'lov ma'lumoti |
| `GET` | `/api/payments/topups/:id` | holat (zaxira tekshiruv bilan) |
| `GET` | `/api/payments/topups` | mijozning to'ldirishlari |
| `POST` | `/api/payments/paylinker/webhook` | **@AllowDirect @Public**, HMAC |
| `GET` | `/api/admin/payments/sms?status=unmatched` | @AdminOnly |
| `POST` | `/api/admin/payments/sms/:id/attach` | @AdminOnly, `{ topupId }` |

### Frontend

- `/dashboard/balance` — balans va tarix (balans qismiga tegishli), "To'ldirish" tugmasi →
- `/dashboard/balance/topup` — summa tanlash (tayyor variantlar), usul tanlash (logotiplar bilan),
  keyin usulga mos ekran:
  - Click / Payme — "To'lash" tugmasi, yangi oynada;
  - Uzum / Paynet — telefonda tugma, kompyuterda QR + hisob raqami;
  - Karta — karta raqami, aniq summa, teskari sanoq;
  - har birida holat avtomatik yangilanadi (4 soniyada bir so'rov), to'langach balans sahifasiga qaytadi.

---

## 8. Bilib qo'yish kerak bo'lgan xavflar

**Paynet balans modeli umumiy shartnomada ishlamaydi.** Paylinker platforma shartnomasida
balansli hisob loginlari **barcha loyihalar bo'yicha** unikal bo'lishi kerak. Bir odam ham
StarsPaymee, ham OsonTarget mijozi bo'lsa va ikkalasi Telegram ID'ni login qilsa — Paynet
`302 Клиент не найден` qaytaradi, **ikkala** loyihada ham. Shuning uchun:

- 2-bosqichda Paynet **invoice modeli** bilan ulanadi (har to'ldirishga alohida hisob raqami) —
  to'qnashuv yo'q;
- "Paynet bankomati" (mijoz terminalga o'z raqamini teradi) faqat ikkita yo'l bilan: alohida Paynet
  xizmati yoki to'qnashmaydigan login — mijozning tasodifiy `clientId` si (balans qismida `User.clientId`).

**Paynet raqami boshqa loyihaning loginiga teng bo'lib qolishi.** Paylinker `GetInformation` da
avval balansli hisobni, keyin invoice raqamini qidiradi. Invoice raqami biror StarsPaymee mijozining
Telegram ID'siga teng bo'lsa, pul o'sha odamning balansiga ketadi. Hozir raqamlar (~4 300) Telegram
ID'lardan (≥ 500 000) ancha kichik, lekin bu jim buziladigan tuzoq. StarsPaymee bot'da tekshiruv bor;
**Paylinker'ning o'zida** markaziy tekshiruv qo'shish kerak (Paylinker vazifasi).

**Tinglovchi akkaunti.** Userbot sessiyasi (`TG_SESSION`) — sir. U bilan bank chatlari o'qiladi;
sessiya o'g'irlansa karta harakati ko'rinadi. Serverda `chmod 600 .env`, logga chiqmaydi.

**1 so'mlik sinov.** Har usul ishga tushirishdan oldin 1 so'mlik haqiqiy to'lov bilan uchidan-uchigacha
tekshiriladi: to'lov → webhook → balans. Usul shungacha mijozlarga ko'rinmaydi.

---

## 9. Sozlamalar (`.env`)

```bash
# Paylinker — admin panel → OsonTarget loyihasi
PAYLINKER_API_BASE=https://api.paylinker.uz
PAYLINKER_API_KEY=pk_live_...
PAYLINKER_WEBHOOK_SECRET=whsec_...
# Paynet ilova havolasidagi `m` (Paynet bergan). Bo'sh bo'lsa Paynet ko'rinmaydi.
PAYNET_APP_MERCHANT=54304

# To'ldirish chegaralari (so'm)
TOPUP_MIN_UZS=10000
TOPUP_MAX_UZS=2500000

# Karta o'tkazmasi: JSON ro'yxat — [{ "brand":"humo","number":"9860...","last4":"1234","holder":"...","chatId":"..." }]
PAYMENT_CARDS=
CARD_TOPUP_TTL_MIN=30
# Userbot (tinglovchi) — my.telegram.org
TG_API_ID=
TG_API_HASH=
TG_SESSION=

# 4-bosqich
STARS_UZS_PER_STAR=
LAVA_SHOP_ID=
LAVA_SECRET_KEY=
LAVA_ADDITIONAL_KEY=
```

`ecosystem.config.cjs` ga ikkinchi jarayon qo'shiladi: `osontarget-card-listener`
(`node dist/card-listener/main.js`).

---

## 10. Bosqichlar

**0. Tayyorgarlik** (1 soat)
- [ ] Paylinker'da OsonTarget loyihasi, API kaliti va webhook kaliti `.env` ga
- [ ] 2.3 dagi yuridik shaxs savoliga javob

**1. Asos + Click + Payme**
- [ ] `Topup` modeli va migratsiyasi (balans modeli tayyor bo'lgandan keyin)
- [ ] Paylinker klienti, webhook (HMAC, takror, summa tekshiruvi), zaxira tekshiruv va cron
- [ ] `/dashboard/balance/topup` — summa, usul, Click/Payme ekrani
- [ ] 1 so'mlik sinov: Click, Payme

**2. Uzum + Paynet**
- [ ] QR va hisob raqami ekrani, Paynet ilova havolasi
- [ ] 1 so'mlik sinov: Uzum, Paynet

**3. Karta + tinglovchi**
- [ ] `CardSms`, parserlar va haqiqiy SMS testlari, noyob summa, moslash
- [ ] `osontarget-card-listener` jarayoni, heartbeat, usulni avtomatik yashirish
- [ ] Admin: topilmagan SMS ro'yxati va biriktirish
- [ ] Firibgarlikka qarshi chegaralar

**4. Qo'shimcha**
- [ ] Telegram Stars (bot update'lari uchun webhook — `X-Telegram-Bot-Api-Secret-Token`)
- [ ] СБП / Lava (osontarget.uz uchun alohida Lava do'koni)
- [ ] Paynet bankomati (`clientId` login bilan)
- [ ] Alohida kassalar (2.2)

---

## 11. Ikki qism o'rtasidagi chegara

Kod bir papkada, ikki mustaqil qismda yoziladi:

| | To'lovlar (bu hujjat) | Balans va e'lonlar |
|---|---|---|
| Papkalar | `src/payments/**`, `src/card-listener/**` | `src/balance/**`, `src/ads/**` |
| Prisma | `Topup`, `CardSms` | `User` (`balanceUzs`, `clientId`), `BalanceEntry`, `Ad` |
| Frontend | `/dashboard/balance/topup` | `/dashboard/balance`, e'lon yaratish |
| Bog'lanish | `balance.credit(...)` ni chaqiradi | `credit()` ni beradi, `debit()` o'zida |

Umumiy fayllar (`app.module.ts`, `config/env.ts`, `.env.example`, `prisma/schema.prisma`) faqat
qo'shish bilan tahrirlanadi, tahrirdan oldin har safar qayta o'qiladi. `main.ts` da to'lov qismi
faqat `rawBody: true` qo'shadi.
