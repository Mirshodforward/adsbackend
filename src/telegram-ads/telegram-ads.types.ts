/**
 * Telegram Ads API turlari — https://ads.telegram.org/docs/api (2026-09-18 holati).
 * Maydon nomlari API'dagidek (snake_case) qoldirilgan: javob to'g'ridan-to'g'ri shu turlarga tushadi.
 *
 * Pul qiymatlari hisob valyutasida, oddiy o'nlik son (Float) ko'rinishida keladi —
 * nano-birlik yoki tiyin emas. Aniqlik: TON va EUR uchun cpm/budjet 2, amount 5 xona;
 * XTR uchun 0 va 3.
 */

/** Hisob valyutasi hisob ochilganda belgilanadi va o'zgarmaydi. */
export type AdsCurrency = 'TON' | 'EUR' | 'XTR';

export interface Account {
  account_id: string;
  title: string;
  currency: AdsCurrency;
  spent_budget: number;
  remaining_budget: number;
  /** E'lonlar budjetida qolgan pul. */
  ads_budget: number;
}

export interface AccountInfo {
  account_id: string;
  title: string;
  full_name: string;
  email: string;
  phone_number: string;
  country: string;
  city: string;
  legal_name?: string;
}

export type AccountTransactionPeer =
  | { type: 'external'; comment?: string }
  | { type: 'main_account' }
  | { type: 'related_account'; account_id: string; account_title: string }
  | { type: 'ad'; ad_id: number; ad_title: string; ad_is_deleted?: boolean };

export interface AccountTransaction {
  peer: AccountTransactionPeer;
  date: number;
  currency: AdsCurrency;
  /** Manfiy — hisob budjetidan yechilgan. */
  amount: number;
}

export interface AccountTransactionsList {
  total_count: number;
  transactions: AccountTransaction[];
  next_offset?: string;
}

// ─── E'lon ───────────────────────────────────────────────────────────────────

export type AdPlacement =
  'channel_post' | 'bot_banner' | 'search_result' | 'video_banner';

export type AdStatus =
  | 'stopped'
  | 'ready_for_review' // avtomatik yuborilmaydi — submitAdForReview kerak
  | 'in_review'
  | 'declined'
  | 'active'
  | 'on_hold';

/** Faqat tashqi (sayt) havolalari uchun. Bo'sh bo'lsa "Open Website" chiqadi. */
export type AdButton =
  | 'subscribe'
  | 'view'
  | 'read'
  | 'learn_more'
  | 'download'
  | 'open'
  | 'sign_up'
  | 'buy'
  | 'order'
  | 'play'
  | 'try'
  | 'leave_request';

export interface AdPhoto {
  photo_id: string;
  photo_url: string;
}

export interface AdVideo {
  video_id: string;
  video_url: string;
}

export interface WebsitePhoto {
  photo_id: string;
  photo_url: string;
}

export interface DeclineReason {
  text: string;
  description_html: string;
}

export interface AdSchedule {
  /** 7 ta son, dushanbadan boshlab; bit N — N:00–N+1:00 soati. Hammasi 0 — jadval yo'q. */
  week_hours_mask: number[];
  /** UTC'dan farq, soniyalarda (Toshkent: 18000). */
  timezone?: number;
  use_viewer_timezone?: boolean;
}

export type InputAdSchedule = AdSchedule;

export interface Ad {
  ad_id: number;
  title: string;
  currency: AdsCurrency;
  text: string;
  photo?: AdPhoto;
  video?: AdVideo;
  promote_url: string;
  cpm: number;
  placement: AdPlacement;
  /** Faqat `return_target: true` yuborilganda keladi. */
  target?: AdTarget;
  impression_frequency?: number;
  website_name?: string;
  website_photo?: WebsitePhoto;
  button?: AdButton;
  conversion_event_id?: string;
  additional_info?: string;
  show_userpic?: boolean;
  spent_budget: number;
  remaining_budget: number;
  daily_spent_budget?: number;
  daily_budget_limit?: number;
  views: number;
  opens?: number;
  clicks?: number;
  actions: number;
  action_type?: string;
  created_date: number;
  is_paused?: boolean;
  activate_date?: number;
  deactivate_date?: number;
  schedule?: AdSchedule;
  status: AdStatus;
  decline_reason?: DeclineReason;
}

export interface AdList {
  total_count: number;
  ads: Ad[];
  next_offset?: string;
}

export interface AdStatItem {
  /** Kiradi. */
  from_time: number;
  /** Kirmaydi. */
  to_time: number;
  views: number;
  opens: number;
  clicks: number;
  actions: number;
  currency: AdsCurrency;
  spent_budget: number;
}

// ─── Targeting ───────────────────────────────────────────────────────────────

export interface TargetLanguage {
  language_code: string;
  name: string;
}

export interface TargetTopic {
  topic_id: number;
  name: string;
}

export interface TargetCountry {
  country_code: string;
  name: string;
}

export interface TargetLocation {
  location_id: number;
  name: string;
  country_code?: string;
  region?: string;
}

export interface TargetChannel {
  channel_id: number;
  title?: string;
  username?: string;
  photo_url?: string;
}

export interface TargetBot {
  bot_id: number;
  title?: string;
  username?: string;
  photo_url?: string;
}

export interface Audience {
  audience_id: number;
  title: string;
  /** Taxminiy: 0 — bo'sh, 50 — 100 tadan kam raqam. */
  size: number;
  ads_count: number;
  created_date: number;
  updated_date: number;
}

/**
 * Kanal yoki bot: "@username" yoki raqamli id. Raqamli id faqat shu hisob
 * uni avval username orqali aniqlagan bo'lsa ishlaydi (aks holda
 * CHANNEL_ID_UNKNOWN / BOT_ID_UNKNOWN) — shuning uchun username afzal.
 */
export type PeerRef = number | string;

export type InputAdTarget =
  | {
      type: 'channels';
      language_codes?: string[];
      topic_ids?: number[];
      exclude_topic_ids?: number[];
      channel_ids?: PeerRef[];
      exclude_channel_ids?: PeerRef[];
    }
  | {
      type: 'users';
      country_codes: string[];
      location_ids?: number[];
      language_codes?: string[];
      topic_ids?: number[];
      intersect_topics?: boolean;
      exclude_topic_ids?: number[];
      channel_ids?: PeerRef[];
      exclude_channel_ids?: PeerRef[];
      audience_ids?: number[];
      exclude_audience_ids?: number[];
      device?: 'ios' | 'android' | 'mobile' | 'desktop';
      exclude_political_channels?: boolean;
      political_channels_only?: boolean;
    }
  | { type: 'bots'; bot_ids?: PeerRef[] }
  | { type: 'search'; search_queries: string[] };

export type AdTarget =
  | {
      type: 'channels';
      languages?: TargetLanguage[];
      topics?: TargetTopic[];
      exclude_topics?: TargetTopic[];
      channels?: TargetChannel[];
      exclude_channels?: TargetChannel[];
    }
  | {
      type: 'users';
      countries: TargetCountry[];
      locations?: TargetLocation[];
      languages?: TargetLanguage[];
      topics?: TargetTopic[];
      intersect_topics?: boolean;
      exclude_topics?: TargetTopic[];
      channels?: TargetChannel[];
      exclude_channels?: TargetChannel[];
      audiences?: Audience[];
      exclude_audiences?: Audience[];
      device?: 'ios' | 'android' | 'mobile' | 'desktop';
      exclude_political_channels?: boolean;
      political_channels_only?: boolean;
    }
  | { type: 'bots'; bots: TargetBot[] }
  | { type: 'search'; search_queries: string[] };

// ─── Metod parametrlari ──────────────────────────────────────────────────────

export interface CreateAdParams {
  /** 1–128 bayt; faqat Ads interfeysida ko'rinadi. */
  title: string;
  /** 1–160 belgi; `search` targetidan boshqa hamma holatda majburiy. */
  text?: string;
  /** Faqat `channels`/`users` targetida; video_id bilan birga bo'lmaydi. */
  photo_id?: string;
  video_id?: string;
  /** Kanal, post, bot yoki sayt havolasi; 1–256 belgi. */
  promote_url: string;
  /** 1000 ko'rish narxi, hisob valyutasida. */
  cpm: number;
  placement: AdPlacement;
  target: InputAdTarget;
  /** Bir foydalanuvchiga kuniga necha marta (1–4, standart 1). */
  impression_frequency?: number;
  /** Tashqi havola bo'lsa majburiy; 1–40 belgi. */
  website_name?: string;
  website_photo_id?: string;
  button?: AdButton;
  conversion_event_id?: string;
  additional_info?: string;
  show_userpic?: boolean;
  /** Hisob budjetidan e'lon budjetiga o'tkaziladigan summa. */
  initial_budget?: number;
  /** 0 — cheksiz. */
  daily_budget_limit?: number;
  is_paused?: boolean;
  activate_date?: number;
  deactivate_date?: number;
  schedule?: InputAdSchedule;
  return_target?: boolean;
  idempotency_key?: string;
}

/** editAd target, placement va initial_budget'ni o'zgartirmaydi. */
export type EditAdParams = { ad_id: number } & Partial<
  Omit<
    CreateAdParams,
    'placement' | 'target' | 'initial_budget' | 'schedule' | 'idempotency_key'
  >
> & {
    /** `false` — jadvalni olib tashlaydi. */
    schedule?: InputAdSchedule | false;
  };

export interface AdBudgetParams {
  ad_id: number;
  amount: number;
  return_target?: boolean;
  idempotency_key?: string;
}

export interface StatsRange {
  from_time: number;
  to_time: number;
  /** 5 daqiqa yoki 1 kun. Oraliq 1000 × interval'dan oshmasin. */
  interval: 300 | 86400;
}
