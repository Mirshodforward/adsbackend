/**
 * Telegram Ads xato kodi → mijozga ko'rinadigan matn.
 *
 * Platforma holatiga oid kodlar (hisobda TON yetmaydi va h.k.) mijozga
 * chiqmaydi — bu ichki ma'lumot; ular umumiy "vaqtincha" matniga aylanadi va
 * adminga alohida xabar ketadi. E'lonning o'ziga oid kodlar (matn, havola,
 * target) esa o'qiladigan ko'rinishda qaytadi — mijoz xatosini tuzata olsin.
 */
const PLATFORM_CODES = new Set([
  'NOT_ENOUGH_BUDGET',
  'MAIN_ACCOUNT_REQUIRED',
  'ACCOUNT_RESTRICTED',
  'ACCOUNT_BLOCKED',
  'API_KEY_INVALID',
  'UNAUTHORIZED',
  'FORBIDDEN',
]);

const KNOWN: Record<string, string> = {
  NETWORK_ERROR: "Telegram javob bermadi — birozdan so'ng urinib ko'ring",
  IDEMPOTENT_REQUEST_IN_PROGRESS:
    "Oldingi so'rov hali bajarilmoqda — birozdan so'ng urinib ko'ring",
  AD_NOT_FOUND: "E'lon Telegram'da topilmadi",
  AD_INACTIVE_TOO_RECENTLY:
    "E'lon yaqinda to'xtatilgan — Telegram 10 daqiqa kutishni talab qiladi",
  TEXT_TOO_LONG: "E'lon matni juda uzun (160 belgigacha)",
  PROMOTE_URL_INVALID: "Reklama havolasi noto'g'ri",
  CPM_TOO_LOW: "1000 ko'rish narxi juda past",
  BUDGET_TOO_LOW: "Budjet juda kichik",
};

export function tgErrorMessage(code: string | null | undefined): string {
  if (!code) return "Telegram vaqtincha javob bermadi — birozdan so'ng urinib ko'ring";
  if (PLATFORM_CODES.has(code) || /^HTTP_5\d\d$/.test(code)) {
    return "Telegram tomonida vaqtinchalik muammo — adminlarga xabar berildi, birozdan so'ng urinib ko'ring";
  }
  if (KNOWN[code]) return KNOWN[code];
  // Noma'lum kod: o'qiladigan ko'rinishda (TEXT_TOO_LONG → "text too long").
  return `Telegram qabul qilmadi: ${code.toLowerCase().replace(/_/g, ' ')}`;
}
