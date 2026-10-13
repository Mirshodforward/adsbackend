import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paylinker 6 soatgacha qayta uradi (har safar yangi imzo) — 24 soat zaxira bilan. */
export const MAX_SIGNATURE_AGE_SEC = 24 * 3600;

export interface SignatureInput {
  /** So'rov tanasi XOM holida — JSON qayta tuzilsa imzo mos kelmaydi. */
  rawBody: Buffer | string;
  /** `X-Paylinker-Signature`: `sha256=<hex>` */
  signature?: string;
  /** `X-Paylinker-Timestamp`: unix soniya */
  timestamp?: string;
  secret: string;
  nowSec?: number;
  maxAgeSec?: number;
}

/**
 * Paylinker webhook imzosi: HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
 * Vaqt imzoga kiradi, shuning uchun eski so'rovni qayta yuborib (replay)
 * bo'lmaydi — juda eski vaqt rad etiladi.
 */
export function verifyPaylinkerSignature(input: SignatureInput): boolean {
  const { signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) return false;
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.maxAgeSec ?? MAX_SIGNATURE_AGE_SEC))
    return false;

  const body =
    typeof input.rawBody === 'string'
      ? input.rawBody
      : input.rawBody.toString('utf8');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const provided = signature
    .replace(/^sha256=/i, '')
    .trim()
    .toLowerCase();

  // Uzunlik farq qilsa timingSafeEqual xato tashlaydi
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  return timingSafeEqual(
    Buffer.from(provided, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
