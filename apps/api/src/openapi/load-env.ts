import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';

// For the spec export only: the example settings fill in anything unset, so
// the app module can load (nothing connects in preview mode).
loadEnv({
  path: join(__dirname, '..', '..', '..', '..', 'infra', 'env', '.env.example'),
  quiet: true,
});
