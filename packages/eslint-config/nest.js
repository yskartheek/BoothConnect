// NestJS preset: base rules plus type-aware checks for the API.
// Requires a tsconfig.json in the consuming app (found via projectService).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { ignores, sharedRules } from './base.js';

export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true },
    },
    rules: {
      ...sharedRules,
      // Unawaited promises in request handlers lose errors and audit events.
      '@typescript-eslint/no-floating-promises': 'error',
      // Nest modules are decorated empty classes by design.
      '@typescript-eslint/no-extraneous-class': 'off',
      // consistent-type-imports is deliberately NOT enabled here: Nest's
      // dependency injection reads constructor parameter types at runtime
      // (emitDecoratorMetadata), and `import type` erases them.
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
