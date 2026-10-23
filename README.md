# OsonTarget — backend

NestJS 12 (ESM) · Prisma 7 · PostgreSQL 16+ · zod. Production: `api.osontarget.uz`
(pm2 + nginx + certbot). Frontend: [adsfrontend](https://github.com/Mirshodforward/adsfrontend)
(Vercel, `osontarget.uz`).

```
Brauzer ──► Vercel (Next.js BFF, httpOnly cookie) ──► nginx (HTTPS) ──► NestJS 127.0.0.1:4400 ──► Postgres
                         x-internal-secret ─────────┘
```

Backend internetga ochiq, lekin `x-internal-secret`siz so'rovni 403 bilan qaytaradi
(`/api/health` va to'lov webhook'i bundan mustasno). Uni faqat frontend BFF chaqiradi.

## Lokal ishga tushirish

```bash
createdb osontarget
cp .env.example .env      # TELEGRAM_BOT_TOKEN, TELEGRAM_ADS_API_KEY, JWT_ACCESS_SECRET
npm install
npm run db:migrate
npm run start:dev         # http://localhost:4000/api
```

`.env`dagi biror qiymat noto'g'ri bo'lsa, ilova qaysi o'zgaruvchi xato ekanini aytib to'xtaydi.
`INTERNAL_API_SECRET` lokalda bo'sh bo'lishi mumkin, productionda esa majburiy. Lokal sinov uchun
alohida bot tokenidan foydalaning: prod bot `osontarget.uz` domeniga bog'langan.

## Production server

Ilova `appuser` nomidan pm2 orqali `/home/appuser/osontarget-backend` papkasida ishlaydi va faqat
`127.0.0.1:4400`da tinglaydi. Tashqariga nginx orqali chiqadi. Baza — tizimdagi PostgreSQL.

### Yangilash

```bash
sudo -iu appuser
cd ~/osontarget-backend && ./deploy.sh
```

Skript ketma-ketligi:

1. `git pull`;
2. `npm ci` va build (past ustuvorlikda — server boshqa ilovalar bilan umumiy);
3. `prisma migrate deploy`;
4. `pm2 reload`;
5. health check.

Migratsiya yoki health check yiqilsa, kod oldingi commitga qaytadi. Migratsiyalar orqaga
qaytarilmaydi, shuning uchun ular faqat qo'shuvchi bo'lsin.

```bash
pm2 logs osontarget-api                       # loglar
curl http://127.0.0.1:4400/api/health         # {"ok":true}
npm run ads:check                             # Ads API kaliti va hisob holati
```

### Birinchi o'rnatish (bir marta)

```bash
# root: baza (parol — openssl rand -hex 32)
sudo -u postgres psql -c "CREATE ROLE osontarget LOGIN PASSWORD '<parol>'"
sudo -u postgres psql -c "CREATE DATABASE osontarget OWNER osontarget"

# appuser: kod va sozlamalar
sudo -iu appuser
git clone https://github.com/Mirshodforward/adsbackend.git ~/osontarget-backend
cd ~/osontarget-backend
cp .env.production.example .env && chmod 600 .env   # to'ldiring
./deploy.sh --force

# root: nginx va HTTPS (DNS: api.osontarget.uz → server IP)
cp /home/appuser/osontarget-backend/nginx/api.osontarget.uz.conf /etc/nginx/sites-available/api.osontarget.uz
ln -s /etc/nginx/sites-available/api.osontarget.uz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.osontarget.uz
```

## Pul modeli: mijoz so'mda, Telegram TON'da

Mijoz hamma narsani so'mda ko'radi: balans, e'lon budjeti, 1000 ko'rish narxi (CPM), sarf.
Telegram Ads bilan hisob-kitob TON'da. O'rtadagi kurs (`src/settings/pricing.service.ts`):

```
mijoz narxi (1 TON) = bozor kursi × (1 + xizmat haqi %)
bozor kursi         = TON/USDT (tonapi.io, `TONAPI_KEY`; zaxira — Binance) × USDT/so'm (admin
                      sozlamasidagi qo'lda kurs, standart 12 250; bo'sh bo'lsa Markaziy bank), har soatda
```

Standart xizmat haqi — **30%**: mijoz e'longa 130 000 so'm ajratsa, Telegram'ga 100 000 so'mlik
TON ketadi, farq platformaniki. Sarf har sinxronlashda e'lonning *o'z* kursi bo'yicha so'mga
aylanadi (`ClientAd.fundedUzs / fundedTon`) — kurs keyin o'zgarsa ham mijozga ta'sir qilmaydi.
E'lon yakunlansa, ishlatilmagan qoldiq shu kurs bo'yicha balansga qaytadi.

Admin panelida o'zgartiriladi: xizmat haqi, qo'lda TON kursi, USDT kursi, minimal budjet, minimal CPM (TON — Telegram
chegarasi), to'ldirish chegaralari (standart 50 000 – 10 000 000 so'm) va to'lov komissiyasi.
Hammasi bazada (`Setting.pricing`), `.env`da emas.

## Sinxronlash

`ADS_SYNC_ENABLED=true` bo'lsa, backend har 5 daqiqada Telegram Ads'dan hisob holatini, e'lonlarni va
5 daqiqalik statistikani bazaga oladi (`src/ads/ads-sync.service.ts`). Birinchi sinxronlashda oxirgi
72 soat yuklanadi, statistika 30 kun saqlanadi. Har sinxronlashdan keyin:

- javobi kelmay qolgan pul amallari (`FundingOperation`) xuddi shu `idempotency_key` bilan qayta
  yuboriladi; yakunlangan e'lonlarning qoldig'i 10+ daqiqadan keyin balansga qaytariladi;
- mijoz sarfi so'mda yangilanadi;
- e'lon holati o'zgargan mijozga bot orqali xabar boradi (moderatsiyadan o'tdi / rad etildi / budjet tugadi).

## Admin paneli

Admin — `ADMIN_TELEGRAM_IDS`dagi foydalanuvchi (login paytida rol beriladi); keyin rolni admin
panelida ham berish mumkin. `src/admin`, barcha endpoint'lar `@AdminOnly()`:

| Endpoint | Nima |
| --- | --- |
| `GET /admin/overview` | Platforma holati: TON hisobi (so'mda ham), mijozlar, balanslar yig'indisi, sarf, to'ldirishlar, e'tibor talab qiladigan amallar |
| `GET /admin/users?q=&page=` · `GET /admin/users/:id` | Mijozlar (qidiruv: ism, username, mijoz raqami, Telegram ID), mijoz kartasi: balans, e'lonlar, jurnal, to'ldirishlar |
| `POST /admin/users/:id/adjust` | Balansni qo'lda tuzatish (±), mijozga bot xabari |
| `POST /admin/users/:id/active` · `/role` | Bloklash (sessiyalar yopiladi) · rol |
| `GET /admin/ads` · `POST /admin/ads/sync` · `/:adId/pause` · `/resume` · `/close` | Hisobdagi barcha e'lonlar (egasi va so'mdagi pul bilan), sinxronlash, boshqaruv |
| `GET /admin/topups` · `POST /admin/topups/:id/refresh` | To'ldirishlar; webhook kelmaganini Paylinker'dan qayta so'rash |
| `GET /admin/funding` | Kutilayotgan / yiqilgan pul amallari |
| `GET/PUT /admin/settings` · `POST /admin/settings/refresh-rate` | Narx sozlamalari; bozor kursini hozir yangilash |

## Ogohlantirishlar va chegaralar

Adminlarga (`ADMIN_TELEGRAM_IDS`) bot orqali xabar ketadi (`AdminAlertsService`, bir xil holat
6 soatda bir marta):

- Telegram Ads hisobida TON mijoz balanslarini qoplamaydi yoki 5 TON'dan kam (har sinxronlashda);
- bozor kursini 6 soatdan beri olib bo'lmayapti (24 soatdan keyin yangi e'lonlar to'xtaydi);
- sinxronlash 3 marta ketma-ket yiqildi (va tiklandi);
- Telegram pul amalini rad etdi (mijozga pul qaytdi) yoki amal 20 soat / 12 urinishdan keyin
  ham hal bo'lmadi (`GIVE_UP:` — pul avtomatik qaytarilmaydi, admin Telegram'da tekshiradi);
- to'ldirish kam to'langan yoki qaytarilgan.

Yakunlashda qoldiq Telegram'ga yuborishdan **oldin** `FundingOperation.amountTon`ga yoziladi —
jarayon o'rtada uzilsa, qayta urinish xuddi shu summani xuddi shu kalit bilan yuboradi.
API orqali yaratilgan e'lon `ready_for_review` bo'lsa, `submitAdForReview` avtomatik chaqiriladi.

So'rov chegarasi (`src/common/rate-limit.ts`, xotirada, foydalanuvchi yoki BFF uzatgan IP bo'yicha):
umumiy 120/daqiqa; `/ads` 60/daqiqa, e'lon yaratish 10/daqiqa, `resolve` 30/daqiqa, to'ldirish
yaratish 10/daqiqa; health va webhook chegarasiz. Oshsa — 429.

## Buyruqlar

| Buyruq              | Nima qiladi                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm test`          | Unit testlar (Telegram imzo tekshiruvi, Ads API klienti, e'lon so'rovi)      |
| `npm run test:e2e`  | Auth, mijoz e'lonlari, to'lovlar, admin paneli. `.env`dagi bazada ishlaydi, test ma'lumotini o'zi o'chiradi |
| `npm run ads:check` | Ads API kaliti ishlayaptimi va hisobda nima borligini ko'rsatadi (faqat o'qiydi) |
| `npm run db:studio` | Prisma Studio                                                                |

## Autentifikatsiya

1. Frontend Telegram Login Widget ma'lumotini `POST /api/auth/telegram` ga uzatadi (widget
   redirect rejimida — BFF GET callback'i orqali).
2. Backend imzoni bot tokeni bilan tekshiradi (HMAC-SHA256), foydalanuvchini yaratadi yoki yangilaydi
   va ikki token beradi: access (15 daqiqa) va refresh (30 kun). Refresh token bazada faqat xesh
   ko'rinishida saqlanadi.
3. Refresh token har ishlatilganda almashtiriladi. Eski token 60 soniyadan keyin qayta kelsa,
   butun sessiya oilasi bekor qilinadi (o'g'irlangan token himoyasi).
4. Mijoz IP'si va brauzeri sessiyaga faqat ichki sir mos kelganda yoziladi (`common/client-meta.ts`).

## Telegram Ads API

- Hujjat: <https://ads.telegram.org/docs/api> (faqat login qilinganda ochiladi).
- Klient: `src/telegram-ads/`. Base URL: `https://promoteapi.telegram.org/<method>`, `Authorization: Bearer`.
- API mantiqiy xatolarni ham HTTP 200 bilan qaytaradi (`{"ok": false, "error": "..."}`).
- Hozirgi kalit oddiy reklama hisobiga tegishli (valyuta — TON). Sub-hisob metodlari
  (`createAccount`, `increaseAccountBudget` va boshqalar) `MAIN_ACCOUNT_REQUIRED` qaytaradi.
  Shuning uchun barcha mijozlar e'lonlari shu bitta hisobda turadi va har bir e'lonning o'z budjeti bor.
