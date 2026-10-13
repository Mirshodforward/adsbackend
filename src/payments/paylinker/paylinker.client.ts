/**
 * Paylinker — bitta API orqali Click, Payme, Uzum Bank va Paynet.
 * Hujjat: https://api.paylinker.uz/seedocs  ·  `Authorization: Bearer pk_live_…`
 *
 * OsonTarget faqat invoice yaratadi va holatini so'raydi; to'lov natijasi
 * `invoice.paid` webhook'i bilan keladi (paylinker-webhook.controller.ts).
 */

/** Paylinker'dagi provider nomi. `UZUM_MERCHANT` — Uzum Bank ilovasi (Checkout emas). */
export type PaylinkerProvider = 'CLICK' | 'PAYME' | 'UZUM_MERCHANT' | 'PAYNET';

export type PaylinkerInvoiceStatus =
  | 'PENDING'
  | 'PREPARED'
  | 'PAID'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'REFUNDED';

export interface PaylinkerInvoice {
  id: string;
  externalId: string;
  status: PaylinkerInvoiceStatus;
  provider: PaylinkerProvider;
  /** So'mda */
  amount: number;
  /**
   * Mijozni yo'naltiriladigan manzil. Click/Payme — veb sahifa, Uzum — ilova
   * deeplink'i. PAYNET'da doim `null` (havolani o'zimiz quramiz).
   */
  payUrl: string | null;
  /** Provider bu to'lovni taniydigan raqam (Payme, Paynet, Uzum). */
  accountNumber: string | null;
  /** To'lov o'tgan, lekin Paylinker xavf tekshiruvida ushlab turibdi. */
  underReview: boolean;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateInvoiceParams {
  /** Bizning `Topup.id` — Paylinker'da idempotentlik kaliti. */
  externalId: string;
  amount: number;
  provider: PaylinkerProvider;
  description?: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * `code` — Paylinker qaytargan xato kodi (masalan `provider_not_configured`)
 * yoki o'zimizniki: `NOT_CONFIGURED`, `NETWORK_ERROR`, `HTTP_<status>`.
 */
export class PaylinkerError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? `Paylinker: ${code}`, options);
    this.name = 'PaylinkerError';
  }
}

export interface PaylinkerClientOptions {
  /** Bo'sh bo'lsa har bir chaqiruv `NOT_CONFIGURED` bilan yiqiladi. */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error?: { code?: string; message?: string } };

export class PaylinkerClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: PaylinkerClientOptions) {
    this.apiKey = opts.apiKey || undefined;
    this.baseUrl = (opts.baseUrl ?? 'https://api.paylinker.uz').replace(
      /\/$/,
      '',
    );
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  createInvoice(params: CreateInvoiceParams): Promise<PaylinkerInvoice> {
    return this.call<PaylinkerInvoice>('POST', '/v1/invoices', params);
  }

  /** Topilmasa `null` — boshqa xatolar tashlanadi. */
  async getInvoiceByExternalId(
    externalId: string,
  ): Promise<PaylinkerInvoice | null> {
    try {
      return await this.call<PaylinkerInvoice>(
        'GET',
        `/v1/invoices/by-external/${encodeURIComponent(externalId)}`,
      );
    } catch (e) {
      if (e instanceof PaylinkerError && e.status === 404) return null;
      throw e;
    }
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    await this.call(
      'POST',
      `/v1/invoices/${encodeURIComponent(invoiceId)}/cancel`,
    );
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey)
      throw new PaylinkerError(
        'NOT_CONFIGURED',
        undefined,
        'PAYLINKER_API_KEY sozlanmagan',
      );

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new PaylinkerError(
        'NETWORK_ERROR',
        undefined,
        'Paylinker javob bermadi',
        { cause: e },
      );
    }

    let envelope: Envelope<T> | null = null;
    try {
      envelope = (await res.json()) as Envelope<T>;
    } catch {
      /* JSON emas — pastda HTTP kodi bo'yicha xato */
    }

    if (res.ok && envelope?.success) return envelope.data;

    const err = envelope && !envelope.success ? envelope.error : undefined;
    throw new PaylinkerError(
      err?.code ?? `HTTP_${res.status}`,
      res.status,
      err?.message,
    );
  }
}
