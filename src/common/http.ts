import { HttpException } from '@nestjs/common';

/** Barcha xatolar bir xil shaklda: `{ error: message }` — frontend shuni o'qiydi. */
export function fail(message: string, status = 400): never {
  throw new HttpException({ error: message }, status);
}
