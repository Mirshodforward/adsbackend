import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { fail } from './http.js';

/** `@Body(zodBody(schema))` — body'ni zod bilan tekshiradi va tozalangan qiymatni qaytaradi. */
export function zodBody<T extends z.ZodType>(
  schema: T,
): PipeTransform<unknown, z.output<T>> {
  return {
    transform(value: unknown) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.') || 'body';
        fail(issue ? `${field}: ${issue.message}` : "Noto'g'ri so'rov");
      }
      return parsed.data;
    },
  };
}
