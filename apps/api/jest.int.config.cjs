// Integration tests (test/**/*.int-spec.ts) against real PostgreSQL and Redis.
// Locally: `pnpm infra:up`, then `pnpm --filter api test:int` (uses the repo-root .env).
// In CI the connection URLs come from the workflow's service containers.
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  // The generated Prisma client imports its own files with .js extensions.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/test/setup-int-env.cjs'],
};
