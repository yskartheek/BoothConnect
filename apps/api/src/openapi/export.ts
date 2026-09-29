import 'reflect-metadata';
// First: the settings must be in place before the app module is loaded.
import './load-env';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { API_PREFIX } from '../app.setup';
import { buildDocument } from './document';

/**
 * Writes `docs/api/openapi.json` (`pnpm --filter api openapi`), or with
 * `--check` fails if the committed file differs from the code (CI). Runs
 * from the build, where the swagger plugin has added the DTO metadata. The
 * app is created in preview mode: nothing connects to a database or Redis;
 * the example environment fills in any settings that aren't set.
 */
const PACKAGE_ROOT = join(__dirname, '..', '..');
const SPEC_PATH = join(PACKAGE_ROOT, '..', '..', 'docs', 'api', 'openapi.json');

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  app.setGlobalPrefix(API_PREFIX);
  const spec = `${JSON.stringify(buildDocument(app, PACKAGE_ROOT), null, 2)}\n`;
  await app.close();

  if (process.argv.includes('--check')) {
    let committed = '';
    try {
      committed = readFileSync(SPEC_PATH, 'utf8');
    } catch {
      // missing: out of date
    }
    if (committed !== spec) {
      console.error(
        'docs/api/openapi.json is out of date. Run `pnpm --filter api openapi` and commit the result.',
      );
      process.exit(1);
    }
    process.stdout.write('docs/api/openapi.json is up to date.\n');
  } else {
    writeFileSync(SPEC_PATH, spec);
    process.stdout.write(`Wrote ${SPEC_PATH}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
