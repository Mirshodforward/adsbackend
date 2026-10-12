import type {
  Account,
  AccountInfo,
  AccountTransactionsList,
  Ad,
  AdBudgetParams,
  AdList,
  AdStatItem,
  CreateAdParams,
  EditAdParams,
  PeerRef,
  StatsRange,
  TargetBot,
  TargetChannel,
  TargetCountry,
  TargetLanguage,
  TargetTopic,
} from './telegram-ads.types.js';

/**
 * API xatosi. `code` — Telegram qaytargan satr (masalan `NOT_ENOUGH_BUDGET`,
 * `MAIN_ACCOUNT_REQUIRED`) yoki tarmoq/javob muammosida o'zimizniki:
 * `NETWORK_ERROR`, `HTTP_<status>`.
 *
 * Diqqat: API mantiqiy xatolarni ham HTTP 200 bilan qaytaradi — status emas,
 * `ok` maydoni hal qiladi.
 */
export class TelegramAdsError extends Error {
  constructor(
    readonly code: string,
    readonly method: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`Telegram Ads ${method}: ${code}`, options);
    this.name = 'TelegramAdsError';
  }
}

export interface TelegramAdsClientOptions {
  /** ads.telegram.org/account/api dagi token. */
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type Envelope<T> = { ok: true; result: T } | { ok: false; error?: string };

/**
 * Telegram Ads API klienti (https://promoteapi.telegram.org/<method>).
 * Nest'ga bog'liq emas — skriptlarda ham ishlatiladi.
 *
 * Pul o'tkazadigan metodlarga (`createAd`, `increaseAdBudget`, ...) har doim
 * `idempotency_key` bering: timeout'dan keyin xuddi shu kalit bilan qayta
 * yuborish xavfsiz (server 24 soat davomida birinchi javobni qaytaradi).
 */
export class TelegramAdsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: TelegramAdsClientOptions) {
    this.baseUrl = (
      options.baseUrl ?? 'https://promoteapi.telegram.org'
    ).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async call<T>(method: string, params: object = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new TelegramAdsError('NETWORK_ERROR', method, undefined, { cause });
    }

    let body: Envelope<T>;
    try {
      body = (await res.json()) as Envelope<T>;
    } catch (cause) {
      throw new TelegramAdsError(`HTTP_${res.status}`, method, res.status, {
        cause,
      });
    }
    if (!body.ok) {
      throw new TelegramAdsError(
        body.error ?? `HTTP_${res.status}`,
        method,
        res.status,
      );
    }
    return body.result;
  }

  // ─── Hisob ─────────────────────────────────────────────────────────────────

  getCurrentAccount() {
    return this.call<Account>('getCurrentAccount');
  }

  getAccountInfo() {
    return this.call<AccountInfo>('getAccountInfo');
  }

  getAccountTransactionsList(params: { offset?: number; limit?: number } = {}) {
    return this.call<AccountTransactionsList>(
      'getAccountTransactionsList',
      params,
    );
  }

  getAccountStats(params: StatsRange) {
    return this.call<AdStatItem[]>('getAccountStats', params);
  }

  // ─── E'lonlar ──────────────────────────────────────────────────────────────

  createAd(params: CreateAdParams) {
    return this.call<Ad>('createAd', params);
  }

  editAd(params: EditAdParams) {
    return this.call<Ad>('editAd', params);
  }

  /** Faqat `ready_for_review` holatidagi e'lon uchun. */
  submitAdForReview(params: { ad_id: number; return_target?: boolean }) {
    return this.call<Ad>('submitAdForReview', params);
  }

  /** Hisob budjetidan e'lon budjetiga. */
  increaseAdBudget(params: AdBudgetParams) {
    return this.call<Ad>('increaseAdBudget', params);
  }

  /** E'lon budjetidan hisobga qaytarish — e'lon kamida 10 daqiqa nofaol bo'lishi kerak. */
  decreaseAdBudget(params: AdBudgetParams) {
    return this.call<Ad>('decreaseAdBudget', params);
  }

  /** E'lon kamida 10 daqiqa nofaol bo'lishi kerak. */
  deleteAd(params: { ad_id: number }) {
    return this.call<true>('deleteAd', params);
  }

  getAdsById(params: { ad_ids: number[]; return_target?: boolean }) {
    return this.call<Ad[]>('getAdsById', params);
  }

  getAdsList(
    params: { offset?: string; limit?: number; return_target?: boolean } = {},
  ) {
    return this.call<AdList>('getAdsList', params);
  }

  getAdStats(params: { ad_id: number } & StatsRange) {
    return this.call<AdStatItem[]>('getAdStats', params);
  }

  // ─── Targeting lug'atlari ──────────────────────────────────────────────────

  getTargetLanguagesList() {
    return this.call<TargetLanguage[]>('getTargetLanguagesList');
  }

  getTargetTopicsList() {
    return this.call<TargetTopic[]>('getTargetTopicsList');
  }

  getTargetCountriesList() {
    return this.call<TargetCountry[]>('getTargetCountriesList');
  }

  getTargetChannel(params: { channel_id: PeerRef; for_excluding?: boolean }) {
    return this.call<TargetChannel>('getTargetChannel', params);
  }

  getTargetBot(params: { bot_id: PeerRef }) {
    return this.call<TargetBot>('getTargetBot', params);
  }
}
