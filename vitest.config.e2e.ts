import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      // Testlar o'z imzosini yaratadi — haqiqiy bot tokeni kerak emas.
      TELEGRAM_BOT_TOKEN: '123456789:AAE2E_TEST_TOKEN_xxxxxxxxxxxxxxxxxxxxx',
      INTERNAL_API_SECRET: 'e2e-internal-secret-0123456789abcdef0123456789',
    },
  },
});
