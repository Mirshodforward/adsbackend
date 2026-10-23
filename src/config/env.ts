import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    // nginx ortidagi serverda 127.0.0.1 — port tashqi interfeysda ochilmaydi.
    // Bo'sh bo'lsa barcha interfeyslarda tinglaydi.
    HOST: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    DATABASE_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(32, "kamida 32 belgi bo'lishi kerak"),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // Vercel'dagi BFF bilan umumiy sir: backend internetga ochiq, lekin uni
    // faqat bizning frontend chaqira oladi. Lokal ishlashda bo'sh qolishi mumkin.
    INTERNAL_API_SECRET: z
      .union([
        z.literal(''),
        z.string().min(32, "kamida 32 belgi bo'lishi kerak"),
      ])
      .optional()
      .transform((v) => v || undefined),

    // @BotFather bergan token. Login Widget imzosi shu token bilan tekshiriladi.
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d+:[\w-]{30,}$/, '@BotFather bergan token formatida emas'),
    // Widget ma'lumoti shundan eski bo'lsa qabul qilinmaydi (replay himoyasi).
    TELEGRAM_AUTH_MAX_AGE_SEC: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),

    // ads.telegram.org/account/api — platformaning reklama hisobi tokeni.
    TELEGRAM_ADS_API_KEY: z.string().min(20),

    // E'lonlar va statistikani har 5 daqiqada sinxronlash. Faqat serverda
    // yoqiladi: lokal ishlash va testlar haqiqiy API'ni bezovta qilmasin.
    ADS_SYNC_ENABLED: z.stringbool().default(false),
    // Shu Telegram ID'lar login paytida ADMIN bo'ladi (vergul bilan).
    ADMIN_TELEGRAM_IDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    // Bot xabaridagi havolalar uchun.
    FRONTEND_URL: z.url().default('https://osontarget.uz'),
    // TON/USDT narxi uchun tonapi.io kaliti. Bo'sh bo'lsa yoki yiqilsa — Binance.
    TONAPI_KEY: z
      .string()
      .optional()
      .transform((v) => v || undefined),

    // ─── To'lovlar: balansni to'ldirish (PAYMENTS.md) ───────────────────
    // Paylinker → OsonTarget loyihasi. Kalit bo'sh bo'lsa to'lov o'chiq:
    // usullar ro'yxati bo'sh qaytadi, lokal ishlash buzilmaydi.
    PAYLINKER_API_BASE: z.url().default('https://api.paylinker.uz'),
    PAYLINKER_API_KEY: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    // Webhook imzosi (`whsec_…`). Bo'sh bo'lsa webhook 503 qaytaradi.
    PAYLINKER_WEBHOOK_SECRET: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    // Paynet ilova havolasidagi `m` (Paynet bergan). Bo'sh bo'lsa Paynet ko'rinmaydi.
    PAYNET_APP_MERCHANT: z
      .union([z.literal(''), z.string().regex(/^\d+$/, 'faqat raqam')])
      .optional()
      .transform((v) => v || undefined),
    // Yoqilgan usullar (vergul bilan): CLICK, PAYME, UZUM, PAYNET.
    // Summa chegaralari va komissiya — admin panelidagi sozlamalarda (bazada).
    PAYMENT_METHODS: z
      .string()
      .default('CLICK,PAYME,UZUM,PAYNET')
      .transform((v) =>
        v
          .split(',')
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean),
      ),
  })
  // Sirsiz production — hamma uchun ochiq backend. Buni jim o'tkazib yubormaymiz.
  .refine((env) => env.NODE_ENV !== 'production' || env.INTERNAL_API_SECRET, {
    path: ['INTERNAL_API_SECRET'],
    message: 'productionda majburiy',
  });

export type Env = z.infer<typeof envSchema>;

/** `ConfigModule.forRoot({ validate })` — noto'g'ri .env bilan ilova ishga tushmaydi. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`.env noto'g'ri sozlangan:\n${issues}`);
  }
  return parsed.data;
}
