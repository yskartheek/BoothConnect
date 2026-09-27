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
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
  },
});
