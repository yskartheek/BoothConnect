import base from '@boothconnect/eslint-config/base';
import globals from 'globals';

export default [...base, { languageOptions: { globals: globals.node } }];
