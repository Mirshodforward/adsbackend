# OsonTarget — backend

NestJS 12 (ESM) · Prisma 7 · PostgreSQL 17 · zod. Serverda Docker ichida ishlaydi: `api.osontarget.uz`.
Frontend: [adsfrontend](https://github.com/Mirshodforward/adsfrontend) (Vercel, `osontarget.uz`).

```
Brauzer ──► Vercel (Next.js BFF, httpOnly cookie) ──► Caddy (HTTPS) ──► NestJS ──► Postgres
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

## Deploy (server)

### Bir martalik tayyorgarlik

1. Sirlarni yarating:
   ```bash
   openssl rand -hex 32      # INTERNAL_API_SECRET — Vercel'da ham AYNAN shu qiymat
   openssl rand -hex 32      # POSTGRES_PASSWORD (hex — DATABASE_URL'ni buzmaydi)
   openssl rand -base64 48   # JWT_ACCESS_SECRET
   ```
2. DNS: `api.osontarget.uz` → A yozuv → server IP.
3. Server: Linux, Docker (compose plugin bilan), 80 va 443 portlar ochiq. Repo private bo'lgani uchun
   serverga faqat o'qish huquqli deploy key qo'shing (GitHub → Settings → Deploy keys).

```bash
git clone git@github.com:Mirshodforward/adsbackend.git osontarget-backend
cd osontarget-backend
cp .env.production.example .env   # qiymatlarni to'ldiring
./deploy.sh --force               # birinchi deploy
```

Keyingi yangilanishlar: `./deploy.sh`. Skript ketma-ketligi:

1. `git pull`;
2. image build;
3. `prisma migrate deploy` (eski versiya hali ishlab turganda);
4. restart;
5. health check — yiqilsa, kod oldingi commitga qaytadi.

Migratsiyalar orqaga qaytarilmaydi, shuning uchun ular faqat qo'shuvchi bo'lsin.

```bash
curl https://api.osontarget.uz/api/health        # {"ok":true}
curl https://api.osontarget.uz/api/auth/me       # 403 — sirsiz so'rov o'tmaydi
docker compose -f docker-compose.prod.yml exec backend npm run ads:check
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U osontarget osontarget | gzip > backup-$(date +%F).sql.gz   # zaxira
```

Boshqa (managed) Postgres ishlatilsa, `docker-compose.prod.yml`dagi izohga qarang.

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
