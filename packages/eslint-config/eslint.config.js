import globals from 'globals';

import base from './base.js';

export default [
  ...base,
  { ignores: ['test/fixtures/**'] },
  { languageOptions: { globals: globals.node } },
];
