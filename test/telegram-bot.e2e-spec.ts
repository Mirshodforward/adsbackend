import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { webhookSecret } from '../src/telegram-bot/bot-updates.service.js';
import { TelegramBotService } from '../src/telegram-bot/telegram-bot.service.js';
import { BOT_TOKEN } from './helpers.js';

// Haqiqiy foydalanuvchilar bilan to'qnashmaydigan id'lar; afterAll'da o'chiriladi.
const KNOWN_TG = 9_930_000_000 + randomInt(1_000_000);
const NEW_TG = KNOWN_TG + 1;

/** Soxta bot — Telegram'ga chiqmaydi, yuborilgan javoblarni yig'adi. */
const fakeBot = {
  sendMessage: vi.fn(
    async (_chatId: bigint | number | string, _text: string, _extra?: object) =>
      true,
  ),
  api: vi.fn(async () => null),
};

type Keyboard = {
  inline_keyboard: {
    text: string;
    url?: string;
    web_app?: { url: string };
  }[][];
};

describe('Telegram bot webhook (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let frontendUrl: string;
  let clientId: number;
  let updateId = 1;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramBotService)
      .useValue(fakeBot)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    frontendUrl = app.get(ConfigService).getOrThrow<string>('FRONTEND_URL');
    const user = await db.user.create({
      data: {
        telegramId: BigInt(KNOWN_TG),
        firstName: 'Known',
        balanceUzs: 125_000,
      },
    });
    clientId = user.clientId;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { telegramId: { in: [BigInt(KNOWN_TG), BigInt(NEW_TG)] } },
    });
    await app.close();
  });

  beforeEach(() => fakeBot.sendMessage.mockClear());

  /** Telegram'dagidek shaxsiy chat xabari (chat id = foydalanuvchi id). */
  const update = (
    text: string,
    o: {
      from?: number;
      lang?: string;
      firstName?: string;
      group?: boolean;
    } = {},
  ) => {
    const from = o.from ?? NEW_TG;
    const id = updateId++;
    return {
      update_id: id,
      message: {
        message_id: id,
        date: Math.floor(Date.now() / 1000),
        chat: o.group
          ? { id: -1_001_234_567_890, type: 'supergroup', title: 'Guruh' }
          : { id: from, type: 'private', first_name: 'X' },
        from: {
          id: from,
          is_bot: false,
          first_name: o.firstName ?? 'Ali',
          ...(o.lang ? { language_code: o.lang } : {}),
        },
        text,
      },
    };
  };

  // BFF'siz, ichki sirsiz — Telegram'dagidek.
  const send = (
    body: object,
    secret: string | null = webhookSecret(BOT_TOKEN),
  ) => {
    const req = request(app.getHttpServer()).post('/api/telegram/webhook');
    if (secret !== null) req.set('x-telegram-bot-api-secret-token', secret);
    return req.send(body);
  };

  const reply = () => {
    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, extra] = fakeBot.sendMessage.mock.calls[0];
    const { parse_mode, reply_markup } = extra as {
      parse_mode: string;
      reply_markup: Keyboard;
    };
    const buttons = reply_markup.inline_keyboard.flat();
    return { chatId, text, parse_mode, buttons };
  };

  it("sirsiz yoki noto'g'ri sir bilan — 401, javob yuborilmaydi", async () => {
    await send(update('/start'), null).expect(401);
    await send(update('/start'), 'notogri-sir').expect(401);
    expect(fakeBot.sendMessage).not.toHaveBeenCalled();
  });

  it('/start — yangi foydalanuvchiga xizmat haqida va menyu (ru)', async () => {
    await send(update('/start', { lang: 'ru' })).expect(200, { ok: true });
    const r = reply();
    expect(String(r.chatId)).toBe(String(NEW_TG));
    expect(r.parse_mode).toBe('HTML');
    expect(r.text).toContain('Здравствуйте, <b>Ali</b>!');
    expect(r.text).toContain('Click, Payme, Uzum Bank или Paynet');

    // Mini App'ga bitta tugma — kabinet (reklama, to'ldirish, e'lonlar ichida).
    const apps = r.buttons.flatMap((b) => (b.web_app ? [b.web_app.url] : []));
    expect(apps).toEqual([new URL('/app', frontendUrl).toString()]);
    const links = r.buttons.flatMap((b) => (b.url ? [b.url] : []));
    expect(links).toEqual([
      'https://t.me/StarsPaymee_bot/starspaymee?startapp=s100-0-0-ot_stars_bot',
      'https://t.me/StarsPaymeeSupport',
      new URL('/ru', frontendUrl).toString(),
    ]);
    expect(r.buttons[0].text).toBe('🚀 Открыть кабинет');
  });

  it("/start — ro'yxatdan o'tgan mijozga balans va mijoz raqami (uz)", async () => {
    await send(update('/start promo', { from: KNOWN_TG, lang: 'uz' })).expect(
      200,
    );
    const r = reply();
    expect(String(r.chatId)).toBe(String(KNOWN_TG));
    expect(r.text).toContain("Bo'sh balans: <b>125 000 so'm</b>");
    expect(r.text).toContain(`Mijoz raqami: <code>${clientId}</code>`);
    expect(r.text).not.toContain('xorijiy karta');
  });

  it('/help@Osontarget_bot — yordam (en)', async () => {
    await send(update('/help@Osontarget_bot', { lang: 'en' })).expect(200);
    const r = reply();
    expect(r.text).toContain('What this bot can do');
    expect(r.buttons.some((b) => b.text === '💬 Support')).toBe(true);
  });

  it("boshqa xabar — qisqa ko'rsatma va o'sha menyu (til yo'q → uz)", async () => {
    await send(update('salom, reklama qancha turadi?')).expect(200);
    const r = reply();
    expect(r.text).toContain('Hamma ish kabinetda');
    expect(r.buttons[0].web_app?.url).toBe(
      new URL('/app', frontendUrl).toString(),
    );
  });

  it('ism HTML sifatida qochiriladi', async () => {
    await send(update('/start', { firstName: '<b>Ali & Co</b>' })).expect(200);
    expect(reply().text).toContain('<b>&lt;b&gt;Ali &amp; Co&lt;/b&gt;</b>');
  });

  it("guruhda va tanilmagan update'da — 200, javobsiz", async () => {
    await send(update('/start', { group: true })).expect(200, { ok: true });
    await send({ hello: 'world' }).expect(200, { ok: true });
    await send({
      update_id: updateId++,
      my_chat_member: { chat: { id: 1 } },
    }).expect(200);
    expect(fakeBot.sendMessage).not.toHaveBeenCalled();
  });

  it('javob yuborilmasa ham 200 — Telegram qayta urmasin', async () => {
    fakeBot.sendMessage.mockResolvedValueOnce(false);
    await send(update('/start')).expect(200, { ok: true });
    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
  });
});
