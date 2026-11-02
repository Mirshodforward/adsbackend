/**
 * StarsPaymee Partner Purchase API — Telegram Stars, Premium va sovg'alarni
 * yetkazadi (Fragment / sovg'a ombori). Hujjat: api.starstg.uz/api/purchase/v1/docs
 *
 * Hamkor (OsonTarget) balansi USDT'da: har buyurtmada atomik yechiladi,
 * yetkazilmasa hamkor tomonda avtomatik qaytadi. `idempotency_key` — bizning
 * `ShopOrder.id`: takroriy so'rov o'sha natijani qaytaradi, ikkinchi marta
 * yetkazmaydi (tarmoq uzilsa xavfsiz qayta urinish shu).
 */

export interface PartnerPricing {
  stars: { min: number; max: number; usdt_per_star: number };
  premium: { months: number[]; usdt: Record<string, number> };
}

export interface PartnerGift {
  /** ⚠️ 64-bitli son — satr bo'lib qoladi. */
  gift_id: string;
  stars: number;
  price_usdt: number;
  emoji: string | null;
  title: string | null;
  limited: boolean;
  remains: number | null;
}

export interface PartnerRecipient {
  recipient: string;
  name: string;
  photo: string;
  myself: boolean;
  /** Faqat Premium qidiruvida: profil allaqachon Premium'mi (`null` — noma'lum). */
  premium?: boolean | null;
}

/** Stars / Premium / sovg'a javobi (kerakli maydonlar). */
export interface PartnerOrder {
  success: boolean;
  order_id?: number;
  status?: 'processing' | 'completed' | 'failed';
  usdt_charged?: number;
  transaction_id?: string | null;
  error?: string | null;
  error_code?: string | null;
  refunded?: boolean;
  test?: boolean;
}

/**
 * `status` — HTTP holati (0 — javob kelmadi). `body` — Partner API javobi
 * (`error`, `error_code`, `required_usdt` …). 402 — HAMKOR balansi yetmaydi.
 */
export class PartnerError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(message ?? (typeof body.error === 'string' ? body.error : `Partner API: HTTP ${status}`));
    this.name = 'PartnerError';
  }
  get code(): string | undefined {
    return typeof this.body.error_code === 'string' ? this.body.error_code : undefined;
  }
}

export interface StarsPaymeeClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** Stars/Premium — `/test/v1` (yetkazilmaydi). Faqat lokal. */
  sandbox?: boolean;
  timeoutMs?: number;
}

export class StarsPaymeeClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  readonly sandbox: boolean;
  private readonly timeoutMs: number;

  constructor(opts: StarsPaymeeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey || undefined;
    this.sandbox = Boolean(opts.sandbox);
    // Stars Fragment orqali ~1–60 s (hamkor 240 s gacha kutadi) — zaxira bilan.
    this.timeoutMs = opts.timeoutMs ?? 270_000;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  balance(): Promise<{ balance_usdt: number }> {
    return this.call('GET', '/v1/balance', undefined, 15_000);
  }

  pricing(): Promise<PartnerPricing> {
    return this.call('GET', '/v1/pricing', undefined, 15_000);
  }

  async gifts(): Promise<PartnerGift[]> {
    const r = await this.call<{ gifts: PartnerGift[] }>('GET', '/v1/gifts', undefined, 15_000);
    return r.gifts ?? [];
  }

  async search(productType: 'stars' | 'premium', query: string): Promise<PartnerRecipient> {
    const r = await this.call<{ found: PartnerRecipient }>(
      'POST',
      '/v1/search',
      { product_type: productType, query },
      20_000,
    );
    return r.found;
  }

  stars(username: string, stars: number, idempotencyKey: string): Promise<PartnerOrder> {
    return this.call('POST', `${this.sandbox ? '/test' : ''}/v1/stars`, {
      username,
      stars,
      idempotency_key: idempotencyKey,
    });
  }

  premium(username: string, months: number, idempotencyKey: string): Promise<PartnerOrder> {
    return this.call('POST', `${this.sandbox ? '/test' : ''}/v1/premium`, {
      username,
      months,
      idempotency_key: idempotencyKey,
    });
  }

  gift(p: { recipient: string; giftId: string; message?: string; hideName?: boolean; idempotencyKey: string }): Promise<PartnerOrder> {
    return this.call('POST', '/v1/gifts', {
      recipient: p.recipient,
      gift_id: p.giftId,
      ...(p.message ? { message: p.message } : {}),
      hide_name: Boolean(p.hideName),
      idempotency_key: p.idempotencyKey,
    });
  }

  /** Sovg'a animatsiyasi (Lottie JSON). Javob gzip — `fetch` o'zi ochadi. */
  async giftSticker(giftId: string): Promise<Buffer | null> {
    if (!this.apiKey) return null;
    const res = await fetch(`${this.baseUrl}/v1/gifts/${encodeURIComponent(giftId)}/sticker`, {
      headers: { 'X-API-Key': this.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    if (!this.apiKey) throw new PartnerError(503, {}, "Do'kon sozlanmagan");
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new PartnerError(0, {}, `Partner API javob bermadi: ${e instanceof Error ? e.message : e}`);
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* JSON emas */
    }
    if (res.ok && json.success !== false) return json as T;
    throw new PartnerError(res.status, json);
  }
}
