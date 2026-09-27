import next from '@boothconnect/eslint-config/next';

export default [...next, { ignores: ['next-env.d.ts', 'playwright-report/**', 'test-results/**'] }];
