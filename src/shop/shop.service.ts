import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceService } from '../balance/balance.service.js';
import { fail } from '../common/http.js';
import type { ShopOrder, ShopProduct } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService } from '../settings/pricing.service.js';
import { AdminAlertsService } from '../telegram-bot/admin-alerts.service.js';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import {
  normalizeUsername,
  packageUzs,
  PREMIUM_MONTHS,
  SHOP_SETTINGS_KEY,
  shopSettingsSchema,
  STARS_PRESETS,
  starsUnitUzs,
  type ShopSettings,
} from './shop-pricing.js';
import {
  PartnerError,
  StarsPaymeeClient,
  type PartnerGift,
  type PartnerOrder,
  type PartnerPricing,
} from './starspaymee.client.js';

/** Hamkor javob bermasa yoki "processing" qolsa — shundan keyin qayta so'raladi. */
const RETRY_AFTER_MS = 6 * 60_000;
/** ~3 soat: shundan keyin admin qo'lda hal qiladi (yetkazildimi — noma'lum). */
const MAX_ATTEMPTS = 30;
const CATALOG_TTL_MS = 60_000;
const CATALOG_STALE_MS = 10 * 60_000;

export type OrderInput =
  | { product: 'STARS'; recipient: string; recipientName?: string; quantity: number }
  | { product: 'PREMIUM'; recipient: string; recipientName?: string; months: number }
  | { product: 'GIFT'; recipient: string; recipientName?: string; giftId: string; message?: string; hideName?: boolean };

export interface ShopOrderDto {
  id: string;
  product: ShopProduct;
  recipient: string;
  recipientName: string | null;
  quantity: number;
  giftId: string | null;
  giftEmoji: string | null;
  giftStars: number | null;
  message: string | null;
  hideName: boolean;
  priceUzs: number;
  status: ShopOrder['status'];
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface RecipientDto {
  username: string;
  name: string | null;
  photo: string | null;
  /** Premium qidiruvida: profil allaqachon Premium'mi (`null` — noma'lum). */
  premium: boolean | null;
  /** `false` — profil tekshirilmadi (sovg'a uchun Fragment'da yo'q bo'lsa ham yuboriladi). */
  verified: boolean;
}

const toDto = (o: ShopOrder): ShopOrderDto => ({
  id: o.id,
  product: o.product,
  recipient: o.recipient,
  recipientName: o.recipientName,
  quantity: o.quantity,
  giftId: o.giftId,
  giftEmoji: o.giftEmoji,
  giftStars: o.giftStars,
  message: o.message,
  hideName: o.hideName,
  priceUzs: o.priceUzs.toNumber(),
  status: o.status,
  error: o.error,
  createdAt: o.createdAt,
  completedAt: o.completedAt,
});

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ');

/** Bot xabarlari va jurnal uchun: "100 ⭐ Stars", "Telegram Premium — 3 oy", "💝 sovg'a (15⭐)". */
export function describeOrder(o: Pick<ShopOrder, 'product' | 'quantity' | 'giftEmoji' | 'giftStars'>): string {
  if (o.product === 'STARS') return `${fmt(o.quantity)} ⭐ Stars`;
  if (o.product === 'PREMIUM') return `Telegram Premium — ${o.quantity} oy`;
  return `${o.giftEmoji ?? '🎁'} sovg'a (${o.giftStars ?? '?'}⭐)`;
}

/** Hamkor xatosini mijozga tushunarli matnga aylantiradi. */
function reasonOf(e: PartnerError): string {
  switch (e.code) {
    case 'recipient_refuses':
      return "Qabul qiluvchi Telegram sozlamalarida sovg'a qabul qilishni yopib qo'ygan";
    case 'recipient_not_found':
      return 'Qabul qiluvchi topilmadi — username to\'g\'riligini tekshiring';
    case 'gift_unavailable':
    case 'out_of_stock':
      return "Bu sovg'a tugadi — boshqasini tanlang";
  }
  if (e.status === 402 || e.status === 503) return "Xizmat vaqtincha ishlamayapti — birozdan so'ng urinib ko'ring";
  return e.message || "Yetkazib bo'lmadi";
}

class InsufficientFunds extends Error {}

interface Catalog {
  pricing: PartnerPricing;
  gifts: PartnerGift[];
  at: number;
}

type Context =
  | { ok: true; settings: ShopSettings; catalog: Catalog; usdUzs: number }
  | { ok: false; settings: ShopSettings; reason: 'not_configured' | 'disabled' | 'unavailable' };

/**
 * Do'kon: Telegram Stars, Premium va sovg'alar — mijoz balansidan (so'm),
 * yetkazish StarsPaymee Partner API orqali.
 *
 * Pul oqimi (har qadam takrorga chidamli):
 *  1) narx serverda hisoblanadi (mijoz yuborgan narxga ishonilmaydi);
 *  2) hamkor balansi oldindan tekshiriladi — yetmasa mijozdan pul olinmaydi;
 *  3) buyurtma yaratish va balansdan yechish — BITTA tranzaksiyada;
 *  4) yetkazish fonda (HTTP so'rov kutmaydi), `idempotency_key = order.id`;
 *  5) muvaffaqiyat → COMPLETED; aniq rad → FAILED + qaytarish (bir marta);
 *     javob kelmadi → PROCESSING qoladi, cron o'sha kalit bilan qayta so'raydi.
 */
@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);
  private catalog: Catalog | null = null;
  private catalogPromise: Promise<Catalog> | null = null;
  private partnerBal: { usdt: number; at: number } | null = null;
  private readonly recipients = new Map<string, { at: number; found: RecipientDto | null; error?: [string, number] }>();
  private readonly stickers = new Map<string, { at: number; body: Buffer | null }>();

  constructor(
    private readonly db: PrismaService,
    private readonly balance: BalanceService,
    private readonly client: StarsPaymeeClient,
    private readonly pricing: PricingService,
    private readonly bot: TelegramBotService,
    private readonly alerts: AdminAlertsService,
  ) {}

  /* ─── Sozlamalar ─────────────────────────────────────────────────────── */

  async settings(): Promise<ShopSettings> {
    const row = await this.db.setting.findUnique({ where: { key: SHOP_SETTINGS_KEY } });
    const parsed = shopSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : shopSettingsSchema.parse({});
  }

  async updateSettings(patch: Partial<ShopSettings>) {
    const next = shopSettingsSchema.parse({ ...(await this.settings()), ...patch });
    await this.db.setting.upsert({
      where: { key: SHOP_SETTINGS_KEY },
      create: { key: SHOP_SETTINGS_KEY, value: next },
      update: { value: next },
    });
    return this.adminStatus();
  }

  /* ─── Katalog va narx ────────────────────────────────────────────────── */

  private async getCatalog(): Promise<Catalog | null> {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) return this.catalog;
    try {
      this.catalogPromise ??= Promise.all([this.client.pricing(), this.client.gifts()])
        .then(([pricing, gifts]) => ({ pricing, gifts, at: Date.now() }))
        .finally(() => {
          this.catalogPromise = null;
        });
      this.catalog = await this.catalogPromise;
      return this.catalog;
    } catch (e) {
      this.logger.warn(`Katalog olinmadi: ${e instanceof Error ? e.message : e}`);
      return this.catalog && Date.now() - this.catalog.at < CATALOG_STALE_MS ? this.catalog : null;
    }
  }

  /** Hamkor (OsonTarget) USDT balansi. Sandbox'da cheklov yo'q. `null` — so'rov yiqildi. */
  private async partnerBalance(fresh = false): Promise<number | null> {
    if (this.client.sandbox) return Number.POSITIVE_INFINITY;
    if (!fresh && this.partnerBal && Date.now() - this.partnerBal.at < 15_000) return this.partnerBal.usdt;
    try {
      const b = await this.client.balance();
      this.partnerBal = { usdt: Number(b.balance_usdt) || 0, at: Date.now() };
      return this.partnerBal.usdt;
    } catch (e) {
      this.logger.warn(`Hamkor balansi olinmadi: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async context(): Promise<Context> {
    const settings = await this.settings();
    if (!this.client.configured) return { ok: false, settings, reason: 'not_configured' };
    if (!settings.enabled) return { ok: false, settings, reason: 'disabled' };
    const [catalog, pricing] = await Promise.all([this.getCatalog(), this.pricing.getPricing()]);
    if (!catalog || !pricing.usdUzs) return { ok: false, settings, reason: 'unavailable' };
    return { ok: true, settings, catalog, usdUzs: pricing.usdUzs };
  }

  /** Kabinet: mahsulotlar, narxlar (so'm) va hozir sotib olish mumkinmi. */
  async options() {
    const ctx = await this.context();
    if (!ctx.ok) {
      return { enabled: false, available: false, reason: ctx.reason, stars: null, premium: [], gifts: [] };
    }
    const { pricing, gifts } = ctx.catalog;
    const s = ctx.settings;
    const bal = await this.partnerBalance();
    const can = (usdt: number) => bal !== null && bal >= usdt;
    const perStar = pricing.stars.usdt_per_star;
    const unitUzs = starsUnitUzs(perStar, ctx.usdUzs, s.starsMarkupPercent);
    const stars = {
      min: pricing.stars.min,
      max: pricing.stars.max,
      unitUzs,
      /** Hamkor balansi bilan hozir yuborish mumkin bo'lgan eng ko'p Stars. */
      maxAvailable: bal === null ? 0 : Math.min(pricing.stars.max, Math.floor(bal / perStar + 1e-9)),
      presets: STARS_PRESETS.filter((n) => n >= pricing.stars.min && n <= pricing.stars.max).map((n) => ({
        quantity: n,
        priceUzs: unitUzs * n,
        available: can(n * perStar),
      })),
    };
    const premium = PREMIUM_MONTHS.flatMap((m) => {
      const usdt = pricing.premium.usdt[String(m)];
      return usdt ? [{ months: m, priceUzs: packageUzs(usdt, ctx.usdUzs, s.premiumMarkupPercent), available: can(usdt) }] : [];
    });
    const giftList = gifts.map((g) => ({
      id: g.gift_id,
      emoji: g.emoji,
      title: g.title,
      stars: g.stars,
      priceUzs: packageUzs(g.price_usdt, ctx.usdUzs, s.giftMarkupPercent),
      limited: g.limited,
      remains: g.remains,
      available: can(g.price_usdt) && g.remains !== 0,
    }));
    const available = stars.presets.some((p) => p.available) || premium.some((p) => p.available) || giftList.some((g) => g.available);
    return { enabled: true, available, reason: available ? null : 'unavailable', stars, premium, gifts: giftList };
  }

  /** Sayt (landing) uchun: "…dan" narxlar. Do'kon o'chiq bo'lsa `null`. */
  async publicPrices() {
    const ctx = await this.context();
    if (!ctx.ok) return null;
    const { pricing, gifts } = ctx.catalog;
    const s = ctx.settings;
    const giftPrices = gifts.map((g) => packageUzs(g.price_usdt, ctx.usdUzs, s.giftMarkupPercent));
    return {
      starsUnitUzs: starsUnitUzs(pricing.stars.usdt_per_star, ctx.usdUzs, s.starsMarkupPercent),
      starsMin: pricing.stars.min,
      premium: PREMIUM_MONTHS.flatMap((m) => {
        const usdt = pricing.premium.usdt[String(m)];
        return usdt ? [{ months: m, priceUzs: packageUzs(usdt, ctx.usdUzs, s.premiumMarkupPercent) }] : [];
      }),
      giftFromUzs: giftPrices.length ? Math.min(...giftPrices) : null,
      giftCount: gifts.length,
    };
  }

  /* ─── Qabul qiluvchi ─────────────────────────────────────────────────── */

  async findRecipient(product: ShopProduct, raw: string): Promise<RecipientDto> {
    const username = normalizeUsername(raw);
    if (!username) fail("Username noto'g'ri — masalan @durov", 400);
    if (!this.client.configured) fail("Do'kon vaqtincha ishlamayapti", 503);
    const type = product === 'PREMIUM' ? 'premium' : 'stars';
    const key = `${type}:${username.toLowerCase()}`;
    const hit = this.recipients.get(key);
    if (hit && Date.now() - hit.at < 60_000) {
      if (hit.found) return hit.found;
      if (product === 'GIFT') return { username, name: null, photo: null, premium: null, verified: false };
      fail(hit.error?.[0] ?? 'Topilmadi', hit.error?.[1] ?? 404);
    }
    try {
      const f = await this.client.search(type, username);
      const found: RecipientDto = {
        username: (f.recipient || username).replace(/^@/, ''),
        name: f.name || null,
        photo: f.photo || null,
        premium: f.premium ?? null,
        verified: true,
      };
      this.remember(key, { at: Date.now(), found });
      return found;
    } catch (e) {
      if (e instanceof PartnerError && (e.status === 404 || e.status === 400)) {
        this.remember(key, { at: Date.now(), found: null, error: [e.message, e.status] });
        // Sovg'a Fragment'siz yuboriladi — profil tekshirilmasa ham urinish mumkin.
        if (product === 'GIFT') return { username, name: null, photo: null, premium: null, verified: false };
        fail(e.message || 'Foydalanuvchi topilmadi', e.status);
      }
      if (e instanceof PartnerError && e.status === 429) fail("Juda ko'p qidiruv — bir daqiqadan so'ng urinib ko'ring", 429);
      this.logger.warn(`Qidiruv @${username}: ${e instanceof Error ? e.message : e}`);
      fail("Qidiruv vaqtincha ishlamayapti — birozdan so'ng urinib ko'ring", 502);
    }
  }

  private remember(key: string, v: { at: number; found: RecipientDto | null; error?: [string, number] }) {
    if (this.recipients.size > 500) this.recipients.clear();
    this.recipients.set(key, v);
  }

  /* ─── Buyurtma ───────────────────────────────────────────────────────── */

  async createOrder(userId: string, input: OrderInput): Promise<ShopOrderDto> {
    const ctx = await this.context();
    if (!ctx.ok) fail("Do'kon vaqtincha ishlamayapti", 503);
    const recipient = normalizeUsername(input.recipient);
    if (!recipient) fail("Username noto'g'ri — masalan @durov", 400);
    const s = ctx.settings;
    const { pricing, gifts } = ctx.catalog;

    let quantity: number;
    let priceUzs: number;
    let costUsdt: number;
    let gift: PartnerGift | undefined;
    if (input.product === 'STARS') {
      const { min, max, usdt_per_star } = pricing.stars;
      if (!Number.isInteger(input.quantity) || input.quantity < min || input.quantity > max) {
        fail(`Stars soni ${fmt(min)} – ${fmt(max)} oralig'ida bo'lsin`);
      }
      quantity = input.quantity;
      priceUzs = starsUnitUzs(usdt_per_star, ctx.usdUzs, s.starsMarkupPercent) * quantity;
      costUsdt = usdt_per_star * quantity;
    } else if (input.product === 'PREMIUM') {
      const usdt = pricing.premium.usdt[String(input.months)];
      if (!(PREMIUM_MONTHS as readonly number[]).includes(input.months) || !usdt) fail('Premium muddati: 3, 6 yoki 12 oy');
      quantity = input.months;
      priceUzs = packageUzs(usdt, ctx.usdUzs, s.premiumMarkupPercent);
      costUsdt = usdt;
    } else {
      gift = gifts.find((g) => g.gift_id === input.giftId);
      if (!gift) fail("Bu sovg'a hozir sotuvda yo'q — ro'yxatni yangilang", 409);
      if (gift.remains === 0) fail("Bu sovg'a tugadi — boshqasini tanlang", 409);
      quantity = 1;
      priceUzs = packageUzs(gift.price_usdt, ctx.usdUzs, s.giftMarkupPercent);
      costUsdt = gift.price_usdt;
    }

    // Hamkor balansi yetmasa mijozdan pul olinmaydi.
    const bal = await this.partnerBalance(true);
    if (bal === null || bal < costUsdt) {
      void this.alerts.send(
        `⚠️ Do'kon: StarsPaymee hamkor balansi yetmaydi — ${bal === null ? "noma'lum" : bal.toFixed(2)} USDT, ` +
          `kerak ${costUsdt.toFixed(2)} USDT. Mijozlar xarid qila olmayapti — hamkor balansini to'ldiring.`,
        { key: 'shop-partner-balance', everyMs: 60 * 60_000 },
      );
      fail("Bu xizmat vaqtincha ishlamayapti — birozdan so'ng urinib ko'ring", 503);
    }

    // Ikki marta bosish — o'sha buyurtma qaytadi.
    const dup = await this.db.shopOrder.findFirst({
      where: {
        userId,
        product: input.product,
        recipient,
        quantity,
        giftId: gift?.gift_id ?? null,
        status: 'PROCESSING',
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (dup) return toDto(dup);

    const message = input.product === 'GIFT' ? input.message?.trim().slice(0, 200) || null : null;
    let order: ShopOrder;
    try {
      order = await this.db.$transaction(async (tx) => {
        const o = await tx.shopOrder.create({
          data: {
            userId,
            product: input.product,
            recipient,
            recipientName: input.recipientName?.trim().slice(0, 128) || null,
            quantity,
            giftId: gift?.gift_id ?? null,
            giftEmoji: gift?.emoji ?? null,
            giftStars: gift?.stars ?? null,
            message,
            hideName: input.product === 'GIFT' ? Boolean(input.hideName) : false,
            priceUzs,
            costUsdt,
            attempts: 1,
            attemptedAt: new Date(),
          },
        });
        const ok = await this.balance.debitForShop(tx, userId, priceUzs, {
          orderId: o.id,
          note: `${describeOrder(o)} → @${recipient}`,
        });
        if (!ok) throw new InsufficientFunds();
        return o;
      });
    } catch (e) {
      if (e instanceof InsufficientFunds) {
        const { balanceUzs } = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { balanceUzs: true } });
        const need = Math.ceil(priceUzs - balanceUzs.toNumber());
        throw new HttpException({ error: `Balans yetarli emas — yana ${fmt(need)} so'm kerak`, needUzs: need }, 402);
      }
      throw e;
    }

    this.logger.log(`Do'kon ${order.id}: ${describeOrder(order)} → @${recipient}, ${fmt(priceUzs)} so'm`);
    void this.deliver(order.id);
    return toDto(order);
  }

  async list(userId: string): Promise<ShopOrderDto[]> {
    const rows = await this.db.shopOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map(toDto);
  }

  async get(userId: string, id: string): Promise<ShopOrderDto> {
    const o = await this.db.shopOrder.findFirst({ where: { id, userId } });
    if (!o) fail('Buyurtma topilmadi', 404);
    return toDto(o);
  }

  /* ─── Yetkazish ──────────────────────────────────────────────────────── */

  /** Hamkorga yuboradi. Takror chaqirilsa xavfsiz: o'sha `idempotency_key`. */
  async deliver(orderId: string): Promise<void> {
    const order = await this.db.shopOrder.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'PROCESSING') return;
    try {
      const r: PartnerOrder =
        order.product === 'STARS'
          ? await this.client.stars(order.recipient, order.quantity, order.id)
          : order.product === 'PREMIUM'
            ? await this.client.premium(order.recipient, order.quantity, order.id)
            : await this.client.gift({
                recipient: order.recipient,
                giftId: order.giftId!,
                message: order.message ?? undefined,
                hideName: order.hideName,
                idempotencyKey: order.id,
              });
      if (r.status === 'completed') await this.complete(order, r);
      else if (r.status === 'failed') await this.failAndRefund(order, r.error || "Yetkazib bo'lmadi");
      // processing — cron keyinroq o'sha kalit bilan so'raydi
    } catch (e) {
      if (!(e instanceof PartnerError)) {
        this.logger.error(`Do'kon ${order.id}: ${e instanceof Error ? e.message : e}`);
        return;
      }
      // Javob kelmadi / hamkor ichki xatosi / navbat — natija noma'lum: qayta so'raladi.
      if (e.status === 0 || e.status === 429 || e.status === 409 || (e.status >= 500 && e.status !== 502 && e.status !== 503)) {
        this.logger.warn(`Do'kon ${order.id}: ${e.status} ${e.message} — keyinroq qayta urinamiz`);
        return;
      }
      if (e.status === 402) {
        void this.alerts.send(
          `⚠️ Do'kon: StarsPaymee hamkor balansi tugadi (buyurtma ${order.id}, ${describeOrder(order)}). Pul mijozga qaytarildi — balansni to'ldiring.`,
          { key: 'shop-partner-balance', everyMs: 60 * 60_000 },
        );
      }
      // 400/404/402/502/503 — hamkor aniq rad etdi (pul hamkor tomonda ham yechilmagan/qaytgan).
      await this.failAndRefund(order, reasonOf(e));
    }
  }

  private async complete(order: ShopOrder, r: PartnerOrder) {
    const done = await this.db.shopOrder.updateMany({
      where: { id: order.id, status: 'PROCESSING' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        error: null,
        partnerOrderId: r.order_id ?? null,
        transactionId: r.transaction_id ?? null,
        ...(r.usdt_charged != null && { costUsdt: r.usdt_charged }),
      },
    });
    if (!done.count) return;
    this.logger.log(`Do'kon ${order.id}: yetkazildi (hamkor #${r.order_id ?? '?'})`);
    void this.notify(order.userId, `✅ ${describeOrder(order)} @${order.recipient} ga yuborildi.`);
  }

  /** FAILED + pulni qaytarish — bitta tranzaksiyada, faqat PROCESSING'dan (ikki marta qaytmaydi). */
  async failAndRefund(order: ShopOrder, reason: string, note?: string): Promise<boolean> {
    const refunded = await this.db.$transaction(async (tx) => {
      const r = await tx.shopOrder.updateMany({
        where: { id: order.id, status: 'PROCESSING' },
        data: { status: 'FAILED', error: reason.slice(0, 300), completedAt: new Date() },
      });
      if (!r.count) return false;
      await this.balance.refundShop(tx, order.userId, order.priceUzs, {
        orderId: order.id,
        note: note ?? `${describeOrder(order)} → @${order.recipient} yetkazilmadi`,
      });
      return true;
    });
    if (refunded) {
      this.logger.warn(`Do'kon ${order.id}: yetkazilmadi (${reason}) — ${fmt(order.priceUzs.toNumber())} so'm qaytarildi`);
      void this.notify(
        order.userId,
        `❌ ${describeOrder(order)} @${order.recipient} ga yuborilmadi: ${reason}.\n💰 ${fmt(order.priceUzs.toNumber())} so'm balansingizga qaytarildi.`,
      );
    }
    return refunded;
  }

  /** Javobsiz qolgan buyurtmalar — o'sha `idempotency_key` bilan qayta so'raladi. */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    if (!this.client.configured) return;
    const stale = await this.db.shopOrder.findMany({
      where: {
        status: 'PROCESSING',
        attempts: { lt: MAX_ATTEMPTS },
        attemptedAt: { lt: new Date(Date.now() - RETRY_AFTER_MS) },
      },
      orderBy: { attemptedAt: 'asc' },
      take: 10,
    });
    for (const o of stale) {
      // "Ijara": bir vaqtda ikki jarayon bitta buyurtmani yubormasin.
      const lease = await this.db.shopOrder.updateMany({
        where: { id: o.id, status: 'PROCESSING', attemptedAt: o.attemptedAt },
        data: { attemptedAt: new Date(), attempts: { increment: 1 } },
      });
      if (!lease.count) continue;
      if (o.attempts + 1 >= MAX_ATTEMPTS) {
        void this.alerts.send(
          `⚠️ Do'kon: buyurtma ${o.id} (${describeOrder(o)} → @${o.recipient}) ${MAX_ATTEMPTS} urinishda yakunlanmadi. ` +
            `Admin panel → Do'kon: hamkorda tekshirib, qo'lda hal qiling.`,
        );
      }
      await this.deliver(o.id);
    }
  }

  private async notify(userId: string, text: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
    if (user) await this.bot.sendMessage(user.telegramId, text);
  }

  /* ─── Sovg'a animatsiyasi ────────────────────────────────────────────── */

  async giftSticker(giftId: string): Promise<Buffer | null> {
    if (!/^\d{1,32}$/.test(giftId)) return null;
    const hit = this.stickers.get(giftId);
    if (hit && Date.now() - hit.at < (hit.body ? 24 * 3600_000 : 10 * 60_000)) return hit.body;
    let body: Buffer | null = null;
    try {
      body = await this.client.giftSticker(giftId);
    } catch (e) {
      this.logger.warn(`Stiker ${giftId}: ${e instanceof Error ? e.message : e}`);
    }
    if (this.stickers.size > 200) this.stickers.clear();
    this.stickers.set(giftId, { at: Date.now(), body });
    return body;
  }

  /* ─── Admin ──────────────────────────────────────────────────────────── */

  async adminStatus() {
    const [settings, pricing, counts, stuck] = await Promise.all([
      this.settings(),
      this.pricing.getPricing(),
      this.db.shopOrder.groupBy({ by: ['status'], _count: true, _sum: { priceUzs: true } }),
      this.db.shopOrder.count({ where: { status: 'PROCESSING', attempts: { gte: MAX_ATTEMPTS } } }),
    ]);
    const bal = this.client.configured ? await this.partnerBalance(true) : null;
    return {
      settings,
      configured: this.client.configured,
      sandbox: this.client.sandbox,
      partnerBalanceUsdt: Number.isFinite(bal) ? bal : null,
      usdUzs: pricing.usdUzs,
      stuck,
      totals: counts.map((c) => ({ status: c.status, count: c._count, sumUzs: c._sum.priceUzs?.toNumber() ?? 0 })),
      prices: await this.publicPrices(),
    };
  }

  async adminOrders() {
    const rows = await this.db.shopOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, clientId: true, firstName: true, username: true } } },
    });
    return rows.map((o) => ({
      ...toDto(o),
      costUsdt: o.costUsdt?.toNumber() ?? null,
      partnerOrderId: o.partnerOrderId,
      attempts: o.attempts,
      user: o.user,
    }));
  }

  /** Admin: hamkorda yetkazilmagani tasdiqlansa — pulni qaytarish. */
  async adminRefund(id: string) {
    const o = await this.db.shopOrder.findUnique({ where: { id } });
    if (!o) fail('Buyurtma topilmadi', 404);
    if (o.status !== 'PROCESSING') fail('Faqat yakunlanmagan buyurtmani qaytarish mumkin');
    await this.failAndRefund(o, 'Admin tomonidan bekor qilindi', `${describeOrder(o)} → @${o.recipient}: admin qaytardi`);
    return { ok: true };
  }

  /** Admin: urinishlar sonini tiklab, darhol qayta yuborish. */
  async adminRetry(id: string) {
    const r = await this.db.shopOrder.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { attempts: 1, attemptedAt: new Date() },
    });
    if (!r.count) fail('Faqat yakunlanmagan buyurtmani qayta yuborish mumkin');
    await this.deliver(id);
    return toDto(await this.db.shopOrder.findUniqueOrThrow({ where: { id } }));
  }
}
