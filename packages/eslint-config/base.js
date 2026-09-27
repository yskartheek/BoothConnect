// Base preset for every BoothConnect TypeScript package.
// Formatting is left to Prettier; eslint-config-prettier switches off
// any stylistic rule that would fight it, so it must stay last.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: ['**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**', '**/.turbo/**'],
};

export const sharedRules = {
  eqeqeq: ['error', 'always'],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
};

export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      ...sharedRules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
);
