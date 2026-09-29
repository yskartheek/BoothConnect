import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Swagger UI at `/v1/docs`, outside production (#52). It shows the
 * committed `docs/api/openapi.json`, so it matches what the client packages
 * are generated from.
 */
export function setupApiDocs(app: INestApplication, prefix: string): boolean {
  const spec = join(__dirname, '..', '..', '..', '..', 'docs', 'api', 'openapi.json');
  if (!existsSync(spec)) return false;
  const document = JSON.parse(readFileSync(spec, 'utf8')) as OpenAPIObject;
  SwaggerModule.setup(`${prefix}/docs`, app, document, {
    jsonDocumentUrl: `${prefix}/docs/openapi.json`,
    swaggerOptions: { persistAuthorization: true },
  });
  return true;
}
