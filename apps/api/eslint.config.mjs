import nest from '@boothconnect/eslint-config/nest';

export default [
  ...nest,
  {
    // Jest matchers (expect.any) and supertest's server handle are typed `any`.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.int-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];
