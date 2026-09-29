import base from '@boothconnect/eslint-config/base';
import globals from 'globals';

export default [
  // Generated from the OpenAPI spec.
  { ignores: ['dist/**', 'src/schema.ts'] },
  ...base,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
