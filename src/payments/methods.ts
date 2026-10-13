import type { PaylinkerProvider } from './paylinker/paylinker.client.js';

/** Paylinker orqali o'tadigan usullar. Karta, Stars va СБП — keyingi bosqichlarda. */
export type GatewayCode = 'CLICK' | 'PAYME' | 'UZUM' | 'PAYNET';

export interface GatewayMethod {
  code: GatewayCode;
  label: string;
  provider: PaylinkerProvider;
  /**
   * Faqat telefon ilovasida to'lanadi (veb sahifa yo'q). Kompyuterdan kirgan
   * mijozga frontend hisob raqamini ko'rsatadi — havola u yerda ilovani ocholmaydi.
   */
  appOnly: boolean;
}

/** Tartib — mijoz ekranidagi tartib. */
export const GATEWAY_METHODS: readonly GatewayMethod[] = [
  { code: 'CLICK', label: 'Click', provider: 'CLICK', appOnly: false },
  { code: 'PAYME', label: 'Payme', provider: 'PAYME', appOnly: false },
  // `UZUM_MERCHANT` — Uzum Bank ilovasi (deeplink, raqam oldindan to'ldirilgan).
  // `UZUM` (Uzum Checkout) boshqa mahsulot, uni ishlatmaymiz.
  {
    code: 'UZUM',
    label: 'Uzum Bank',
    provider: 'UZUM_MERCHANT',
    appOnly: true,
  },
  { code: 'PAYNET', label: 'Paynet', provider: 'PAYNET', appOnly: true },
];

/**
 * Mijoz to'laydigan summa. Komissiya 0 bo'lsa — aynan balansga tushadigan summa.
 * Yuqoriga yaxlitlanadi: komissiya hech qachon kam olinmasin.
 */
export function payAmount(creditUzs: number, feePercent: number): number {
  if (!feePercent) return creditUzs;
  return Math.ceil((creditUzs * (100 + feePercent)) / 100);
}
