import type { Pricing } from '../../settings/pricing.service.js';
import type {
  AdButton,
  AdPlacement,
  CreateAdParams,
  InputAdTarget,
} from '../../telegram-ads/telegram-ads.types.js';

/** Mijoz shakli: pul so'mda, Telegram'ga TON'da ketadi. */
export interface ClientAdInput {
  promoteUrl: string;
  placement: Extract<
    AdPlacement,
    'channel_post' | 'bot_banner' | 'search_result'
  >;
  text: string;
  websiteName?: string;
  button?: AdButton;
  target:
    | {
        type: 'users';
        countryCodes: string[];
        languageCodes: string[];
        topicIds: number[];
        excludeTopicIds: number[];
      }
    | { type: 'channels'; channels: string[] }
    | { type: 'bots'; bots: string[] }
    | { type: 'search'; queries: string[] };
  budgetUzs: number;
  cpmUzs: number;
  dailyLimitUzs?: number;
}

export type AdRequestResult =
  | {
      ok: true;
      request: Omit<CreateAdParams, 'idempotency_key'>;
      amountUzs: number;
      amountTon: number;
    }
  | { ok: false; error: string };

/** Joylashuvga mos targeting turlari (Telegram Ads qoidasi). */
export const PLACEMENT_TARGETS: Record<ClientAdInput['placement'], string[]> = {
  channel_post: ['users', 'channels'],
  bot_banner: ['users', 'bots'],
  search_result: ['search'],
};

const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** 30000 → "30 000" (oddiy probel — xabar matnida NBSP chiqmasin). */
export const formatUzs = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "@kanal", "t.me/kanal", "https://t.me/bot?start=x" yoki sayt → to'liq URL. */
export function normalizePromoteUrl(
  raw: string,
): { url: string; telegram: boolean } | null {
  let s = raw.trim();
  if (/^@[A-Za-z]\w{3,31}$/.test(s)) {
    return { url: `https://t.me/${s.slice(1)}`, telegram: true };
  }
  if (/^(t\.me|telegram\.me)\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const telegram = host === 't.me' || host === 'telegram.me';
  if (telegram) {
    url.protocol = 'https:';
    url.hostname = 't.me';
    if (url.pathname.length < 2) return null;
  } else if (!host.includes('.')) {
    return null;
  }
  const result = url.toString();
  return result.length <= 256 ? { url: result, telegram } : null;
}

/** "@name", "name" yoki "t.me/name" → "@name"; noto'g'ri bo'lsa null. */
export function normalizeUsername(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?]/)[0];
  return /^[A-Za-z]\w{3,31}$/.test(name) ? `@${name}` : null;
}

/** Ads interfeysidagi ichki nom (1–128 bayt): mijoz raqami + matn boshi. */
function title(clientId: number, text: string) {
  let t = `OT ${clientId} · ${text.replace(/\s+/g, ' ').trim()}`;
  while (Buffer.byteLength(t) > 120) t = t.slice(0, -1);
  return t;
}

export function buildAdRequest(
  input: ClientAdInput,
  pricing: Pricing,
  clientId: number,
): AdRequestResult {
  const fail = (error: string): AdRequestResult => ({ ok: false, error });

  if (pricing.stale || pricing.uzsPerTon <= 0) {
    return fail(
      "Valyuta kursi hozircha yangilanmagan — birozdan so'ng urinib ko'ring",
    );
  }
  if (!PLACEMENT_TARGETS[input.placement].includes(input.target.type)) {
    return fail('Tanlangan joylashuvga bu auditoriya turi mos kelmaydi');
  }

  const link = normalizePromoteUrl(input.promoteUrl);
  if (!link)
    return fail(
      "Havola noto'g'ri: @kanal, t.me/... yoki https://sayt ko'rinishida kiriting",
    );
  if (!link.telegram && !input.websiteName) {
    return fail('Sayt reklamasi uchun sayt nomini kiriting');
  }

  const text = input.text.trim();
  if (input.placement !== 'search_result' && !text) {
    return fail('Reklama matnini kiriting');
  }

  if (input.budgetUzs < pricing.minBudgetUzs) {
    return fail(`Minimal budjet — ${formatUzs(pricing.minBudgetUzs)} so'm`);
  }
  const cpm = round2(input.cpmUzs / pricing.uzsPerTon);
  if (cpm < pricing.minCpmTon) {
    return fail(
      `1000 ko'rish narxi kamida ${formatUzs(pricing.minCpmTon * pricing.uzsPerTon)} so'm bo'lishi kerak`,
    );
  }
  const amountTon = floor2(input.budgetUzs / pricing.uzsPerTon);
  if (amountTon < cpm) {
    return fail("Budjet kamida 1000 ta ko'rishga yetishi kerak");
  }

  let target: InputAdTarget;
  const t = input.target;
  switch (t.type) {
    case 'users':
      if (t.topicIds.length + t.excludeTopicIds.length > 20) {
        return fail('Mavzular (istisnolar bilan) 20 tadan oshmasin');
      }
      target = {
        type: 'users',
        country_codes: t.countryCodes,
        ...(t.languageCodes.length && { language_codes: t.languageCodes }),
        ...(t.topicIds.length && { topic_ids: t.topicIds }),
        ...(t.excludeTopicIds.length && {
          exclude_topic_ids: t.excludeTopicIds,
        }),
      };
      break;
    case 'channels':
    case 'bots': {
      const names = (t.type === 'channels' ? t.channels : t.bots).map(
        normalizeUsername,
      );
      if (names.some((n) => !n))
        return fail("Username noto'g'ri — @username ko'rinishida kiriting");
      const unique = [...new Set(names as string[])];
      target =
        t.type === 'channels'
          ? { type: 'channels', channel_ids: unique }
          : { type: 'bots', bot_ids: unique };
      break;
    }
    case 'search':
      target = {
        type: 'search',
        search_queries: t.queries.map((q) => q.trim()),
      };
      break;
  }

  const daily =
    input.dailyLimitUzs !== undefined
      ? floor2(input.dailyLimitUzs / pricing.uzsPerTon)
      : undefined;
  if (daily !== undefined && daily < cpm) {
    return fail("Kunlik limit kamida 1000 ta ko'rishga yetishi kerak");
  }

  return {
    ok: true,
    amountUzs: input.budgetUzs,
    amountTon,
    request: {
      title: title(clientId, text || input.promoteUrl),
      ...(text && { text }),
      promote_url: link.url,
      cpm,
      placement: input.placement,
      target,
      initial_budget: amountTon,
      ...(daily !== undefined && { daily_budget_limit: daily }),
      ...(!link.telegram && { website_name: input.websiteName }),
      ...(!link.telegram && input.button && { button: input.button }),
      return_target: true,
    },
  };
}
