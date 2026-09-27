import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env';

// apps/api/.env (optional local override) wins over the repository-root .env.
// Real environment variables win over both. The paths work from src/ and dist/.
const appRoot = join(__dirname, '..', '..');
const repoRoot = join(appRoot, '..', '..');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [join(appRoot, '.env'), join(repoRoot, '.env')],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
