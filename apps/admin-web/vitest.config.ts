import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Component tests only; browser end-to-end tests live in e2e/ and run with Playwright.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // A busy CI runner can be several times slower than a laptop; see test/setup.ts.
    testTimeout: 20_000,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
  },
});
