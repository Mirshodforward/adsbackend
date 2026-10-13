/**
 * Paynet ilovasiga to'g'ridan-to'g'ri olib kiradigan havola — hisob raqami va
 * summa oldindan to'ldirilgan:
 *
 *   https://app.paynet.uz/?m=<merchant>&c=<hisob>&a=<so'm>
 *
 * Parametrlar Paynet sahifasining o'z kodidan aniqlangan va StarsPaymee'da
 * jonli tasdiqlangan (2026-09-28): ilova `c` ni hisob maydoniga qo'yadi va
 * Paylinker'ga `GetInformation` yuboradi. `a` — SO'MDA, tiyinda emas.
 *
 * Paylinker PAYNET invoice'i uchun `payUrl` qaytarmaydi: Paynet protokolida
 * havola yo'q, `m` esa Paynet ilovadagi xizmat raqami (Paylinker uni bilmaydi).
 */
export function buildPaynetAppUrl(
  merchant: string,
  account: string,
  amountUzs: number,
): string {
  const url = new URL('https://app.paynet.uz/');
  url.searchParams.set('m', merchant);
  url.searchParams.set('c', account);
  const a = Math.round(amountUzs);
  if (a > 0) url.searchParams.set('a', String(a));
  return url.toString();
}
