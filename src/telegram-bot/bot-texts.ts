/**
 * @Osontarget_bot javoblari: matnlar (uz/ru/en), menyu tugmalari, buyruqlar
 * va bot profili. Sof funksiyalar — tarmoq va bazasiz testlanadi.
 *
 * Bot faqat "eshik": hamma ish kabinetda (Mini App `/app`), u Telegram
 * `initData` orqali parolsiz kiritadi.
 */

export const BOT_LANGS = ['uz', 'ru', 'en'] as const;
export type BotLang = (typeof BOT_LANGS)[number];

/** Telegram tili → bot tili (kabinetdagi `mini-app-gate.tsx` bilan bir xil). */
export const botLang = (code?: string): BotLang =>
  code?.startsWith('ru') ? 'ru' : code?.startsWith('en') ? 'en' : 'uz';

/** Stars/Premium — faqat @StarsPaymee_bot'ga havola (o'zimiz sotmaymiz). */
export const STARSPAYMEE_URL =
  'https://t.me/StarsPaymee_bot/starspaymee?startapp=s100-0-0-ot_stars_bot';
export const SUPPORT_URL = 'https://t.me/StarsPaymeeSupport';

/** `parse_mode: HTML` — foydalanuvchi ismi belgilari xabarni buzmasin. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "/start", "/help@Osontarget_bot", "/start ads" → "start" / "help". */
export function parseCommand(text?: string): string | null {
  const m = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i.exec(text ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** 125000 → "125 000" (kabinetdagi kabi oddiy probel bilan). */
const formatUzs = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export interface BotAccount {
  clientId: number;
  /** Bo'sh balans — yangi e'lonlarga ajratish mumkin bo'lgan pul. */
  freeUzs: number;
}

const T = {
  uz: {
    hello: 'Assalomu alaykum',
    about:
      "<b>OsonTarget</b> — Telegram Ads reklamasini so'mda berish xizmati. E'loningiz kanallar, botlar va qidiruv natijalarida chiqadi, balans esa Click, Payme, Uzum Bank yoki Paynet orqali to'ldiriladi — TON (Gram) va xorijiy karta kerak emas.",
    balance: "💰 Bo'sh balans",
    currency: "so'm",
    clientId: '🆔 Mijoz raqami',
    ctaNew:
      '👇 «Kabinetni ochish»ni bosing — Telegram orqali avtomatik kirasiz, parol kerak emas.',
    ctaKnown: "👇 Kabinetga o'tish uchun tugmani bosing.",
    help: [
      'ℹ️ <b>Bot imkoniyatlari</b>',
      '',
      "🚀 <b>Kabinet</b> — reklama berish, e'lonlar va statistika, balansni Click, Payme, Uzum Bank yoki Paynet orqali to'ldirish",
      '⭐ <b>Stars va Premium</b> — @StarsPaymee_bot orqali',
      '',
      "Kabinet Telegram orqali ochiladi — ro'yxatdan o'tish va parol kerak emas.",
      "Savol bo'lsa — «Qo'llab-quvvatlash» tugmasini bosing.",
      '',
      '/start — bosh menyu',
      '/help — yordam',
    ].join('\n'),
    fallback:
      "🤖 Hamma ish kabinetda — «Kabinetni ochish» tugmasini bosing 👇\n\nSavolingiz bo'lsa — «Qo'llab-quvvatlash» tugmasini bosing.",
    buttons: {
      cabinet: '🚀 Kabinetni ochish',
      stars: '⭐ Stars va Premium',
      support: "💬 Qo'llab-quvvatlash",
      site: '🌐 Sayt',
    },
    commands: { start: 'Bosh menyu', help: 'Yordam' },
    description:
      "OsonTarget — Telegram Ads reklamasini so'mda berish xizmati.\n\n📢 E'lonlar kanallar, botlar va qidiruv natijalarida\n💳 Balans Click, Payme, Uzum Bank yoki Paynet orqali\n🚫 TON (Gram) va xorijiy karta kerak emas\n\nBoshlash uchun pastdagi tugmani bosing 👇",
    shortDescription:
      "Telegram Ads reklamasi so'mda: kanallar, botlar, qidiruv. Click, Payme, Uzum, Paynet. osontarget.uz",
  },
  ru: {
    hello: 'Здравствуйте',
    about:
      '<b>OsonTarget</b> — реклама в Telegram Ads с оплатой в сумах. Объявления показываются в каналах, ботах и результатах поиска, а баланс пополняется через Click, Payme, Uzum Bank или Paynet — без TON (Gram) и зарубежной карты.',
    balance: '💰 Свободный баланс',
    currency: 'сум',
    clientId: '🆔 Номер клиента',
    ctaNew: '👇 Нажмите «Открыть кабинет» — вход через Telegram, без пароля.',
    ctaKnown: '👇 Нажмите кнопку, чтобы перейти в кабинет.',
    help: [
      'ℹ️ <b>Что умеет бот</b>',
      '',
      '🚀 <b>Кабинет</b> — создание рекламы, объявления и статистика, пополнение баланса через Click, Payme, Uzum Bank или Paynet',
      '⭐ <b>Stars и Premium</b> — через @StarsPaymee_bot',
      '',
      'Кабинет открывается через Telegram — без регистрации и пароля.',
      'Есть вопрос — нажмите «Поддержка».',
      '',
      '/start — главное меню',
      '/help — помощь',
    ].join('\n'),
    fallback:
      '🤖 Всё делается в кабинете — нажмите «Открыть кабинет» 👇\n\nЕсть вопрос — нажмите «Поддержка».',
    buttons: {
      cabinet: '🚀 Открыть кабинет',
      stars: '⭐ Stars и Premium',
      support: '💬 Поддержка',
      site: '🌐 Сайт',
    },
    commands: { start: 'Главное меню', help: 'Помощь' },
    description:
      'OsonTarget — реклама в Telegram Ads с оплатой в сумах.\n\n📢 Объявления в каналах, ботах и поиске\n💳 Пополнение через Click, Payme, Uzum Bank или Paynet\n🚫 Без TON (Gram) и зарубежной карты\n\nНажмите кнопку ниже, чтобы начать 👇',
    shortDescription:
      'Реклама Telegram Ads в сумах: каналы, боты, поиск. Click, Payme, Uzum, Paynet. osontarget.uz',
  },
  en: {
    hello: 'Hello',
    about:
      '<b>OsonTarget</b> lets you run Telegram Ads and pay in UZS. Your ads appear in channels, bots and search results, and you top up via Click, Payme, Uzum Bank or Paynet — no TON (Gram) or foreign card needed.',
    balance: '💰 Available balance',
    currency: 'UZS',
    clientId: '🆔 Client ID',
    ctaNew:
      '👇 Tap “Open dashboard” — you sign in through Telegram, no password needed.',
    ctaKnown: '👇 Tap the button to open your dashboard.',
    help: [
      'ℹ️ <b>What this bot can do</b>',
      '',
      '🚀 <b>Dashboard</b> — create ads, track them and their statistics, top up via Click, Payme, Uzum Bank or Paynet',
      '⭐ <b>Stars & Premium</b> — via @StarsPaymee_bot',
      '',
      'The dashboard opens through Telegram — no sign-up or password needed.',
      'Questions? Tap “Support”.',
      '',
      '/start — main menu',
      '/help — help',
    ].join('\n'),
    fallback:
      '🤖 Everything happens in the dashboard — tap “Open dashboard” 👇\n\nQuestions? Tap “Support”.',
    buttons: {
      cabinet: '🚀 Open dashboard',
      stars: '⭐ Stars & Premium',
      support: '💬 Support',
      site: '🌐 Website',
    },
    commands: { start: 'Main menu', help: 'Help' },
    description:
      'OsonTarget — run Telegram Ads and pay in UZS.\n\n📢 Ads in channels, bots and search\n💳 Top up via Click, Payme, Uzum Bank or Paynet\n🚫 No TON (Gram) or foreign card needed\n\nTap the button below to get started 👇',
    shortDescription:
      'Telegram Ads paid in UZS: channels, bots, search. Click, Payme, Uzum, Paynet. osontarget.uz',
  },
} satisfies Record<BotLang, unknown>;

/** /start: salom, (ro'yxatdan o'tgan bo'lsa) balans, aks holda xizmat haqida. */
export function startMessage(
  lang: BotLang,
  firstName: string,
  account?: BotAccount,
): string {
  const t = T[lang];
  const name = escapeHtml(firstName.trim().slice(0, 64));
  const lines = [
    name ? `👋 ${t.hello}, <b>${name}</b>!` : `👋 ${t.hello}!`,
    '',
  ];
  if (account) {
    lines.push(
      `${t.balance}: <b>${formatUzs(account.freeUzs)} ${t.currency}</b>`,
      `${t.clientId}: <code>${account.clientId}</code>`,
      '',
      t.ctaKnown,
    );
  } else {
    lines.push(t.about, '', t.ctaNew);
  }
  return lines.join('\n');
}

export const helpMessage = (lang: BotLang) => T[lang].help;
export const fallbackMessage = (lang: BotLang) => T[lang].fallback;

type InlineButton = { text: string } & (
  { web_app: { url: string } } | { url: string }
);

/**
 * Har javob ostidagi menyu. Mini App'ga bitta tugma — kabinet; reklama,
 * to'ldirish va e'lonlar o'sha yerda. `web_app` faqat shaxsiy chatda ishlaydi.
 */
export function menuKeyboard(
  lang: BotLang,
  frontendUrl: string,
): { inline_keyboard: InlineButton[][] } {
  const b = T[lang].buttons;
  return {
    inline_keyboard: [
      [
        {
          text: b.cabinet,
          web_app: { url: new URL('/app', frontendUrl).toString() },
        },
      ],
      [{ text: b.stars, url: STARSPAYMEE_URL }],
      [
        { text: b.support, url: SUPPORT_URL },
        { text: b.site, url: new URL(`/${lang}`, frontendUrl).toString() },
      ],
    ],
  };
}

/** `setMyCommands` — Telegram'ning "Menu" ro'yxati. */
export const botCommands = (lang: BotLang) => [
  { command: 'start', description: T[lang].commands.start },
  { command: 'help', description: T[lang].commands.help },
];

/** Bo'sh chatda ko'rinadigan tavsif va profildagi qisqa tavsif. */
export const botProfile = (lang: BotLang) => ({
  description: T[lang].description,
  shortDescription: T[lang].shortDescription,
});
