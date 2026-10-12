/**
 * `npm run ads:check` — TELEGRAM_ADS_API_KEY ishlayaptimi va reklama hisobida
 * nima borligini ko'rsatadi. Faqat o'qiydi, hech narsani o'zgartirmaydi.
 */
import 'dotenv/config';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../src/telegram-ads/telegram-ads.client.js';

const token = process.env.TELEGRAM_ADS_API_KEY;
if (!token) {
  console.error("TELEGRAM_ADS_API_KEY .env faylida yo'q");
  process.exit(1);
}

const ads = new TelegramAdsClient({ token });

try {
  const account = await ads.getCurrentAccount();
  console.log(`Hisob:      ${account.title} (${account.account_id})`);
  console.log(`Valyuta:    ${account.currency}`);
  console.log(`Qoldiq:     ${account.remaining_budget}`);
  console.log(`E'lonlarda: ${account.ads_budget}`);
  console.log(`Sarflangan: ${account.spent_budget}`);

  const { total_count, ads: page } = await ads.getAdsList({ limit: 100 });
  const byStatus = new Map<string, number>();
  for (const ad of page) {
    byStatus.set(ad.status, (byStatus.get(ad.status) ?? 0) + 1);
  }
  const summary = [...byStatus].map(([s, n]) => `${s}: ${n}`).join(', ');
  console.log(`E'lonlar:   ${total_count}${summary ? ` (${summary})` : ''}`);
} catch (e) {
  if (!(e instanceof TelegramAdsError)) throw e;
  console.error(`Telegram Ads xatosi: ${e.code} (${e.method})`);
  process.exit(1);
}
