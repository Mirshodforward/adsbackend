# OsonTarget — backend

NestJS 12 (ESM) · Prisma 7 · PostgreSQL 16+ · zod. Production: `api.osontarget.uz`
(pm2 + nginx + certbot). Frontend: [adsfrontend](https://github.com/Mirshodforward/adsfrontend)
(Vercel, `osontarget.uz`).

```
Brauzer ──► Vercel (Next.js BFF, httpOnly cookie) ──► nginx (HTTPS) ──► NestJS 127.0.0.1:4400 ──► Postgres
                         x-internal-secret ─────────┘
```

Backend internetga ochiq, lekin `x-internal-secret`siz so'rovni 403 bilan qaytaradi
(`/api/health` bundan mustasno). Uni faqat frontend BFF chaqiradi.

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

## Buyruqlar

| Buyruq              | Nima qiladi                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm test`          | Unit testlar (Telegram imzo tekshiruvi, Ads API klienti)                     |
| `npm run test:e2e`  | Auth oqimi va ichki sir. `.env`dagi bazada ishlaydi, test foydalanuvchini o'zi o'chiradi |
| `npm run ads:check` | Ads API kaliti ishlayaptimi va hisobda nima borligini ko'rsatadi (faqat o'qiydi) |
| `npm run db:studio` | Prisma Studio                                                                |

## Autentifikatsiya

1. Frontend Telegram Login Widget ma'lumotini `POST /api/auth/telegram` ga uzatadi.
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
