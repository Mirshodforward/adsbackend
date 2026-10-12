import { createHash, createHmac } from 'node:crypto';

// vitest.config.e2e.ts `env` orqali .env'dagi qiymatlarni almashtiradi.
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
export const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET as string;

/** Telegram Login Widget payload'i — test bot tokeni bilan imzolangan. */
export function widgetPayload(fields: Record<string, string | number>) {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return { ...fields, hash };
}
