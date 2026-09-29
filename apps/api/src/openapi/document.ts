import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  AnyType,
  type BaseType,
  type Context,
  createFormatter,
  createParser,
  createProgram,
  type CompletedConfig,
  DEFAULT_CONFIG,
  type SubNodeParser,
  SchemaGenerator,
} from 'ts-json-schema-generator';
import ts from 'typescript';

/** Prisma's JSON types: any JSON value (they are defined twice, which the generator rejects). */
class PrismaJsonParser implements SubNodeParser {
  supportsNode(node: ts.Node): boolean {
    return (
      ts.isTypeReferenceNode(node) &&
      /(^|\.)(JsonValue|JsonObject|JsonArray|InputJsonValue|InputJsonObject)$/.test(
        node.typeName.getText(),
      )
    );
  }
  createType(_node: ts.Node, _context: Context): BaseType {
    return new AnyType();
  }
}

type Operation = {
  security?: Record<string, string[]>[];
  responses: Record<string, unknown>;
  'x-public'?: boolean;
  'x-result-type'?: string | null;
  [key: string]: unknown;
};

/**
 * The OpenAPI 3.1 document (#52): paths, parameters and request bodies from
 * the controllers and DTOs (the @nestjs/swagger CLI plugin reads their
 * types and comments at build time), and response schemas generated from
 * the TypeScript types in `responses.ts`.
 */
export function buildDocument(app: INestApplication, packageRoot: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('BoothConnect API')
    .setDescription(
      'REST API for the BoothConnect apps. Sign in with a one-time code (`/auth/otp/*`) and send the access token as `Authorization: Bearer …`. Errors are `{ requestId, code, message, details? }`.',
    )
    .setVersion('1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });

  const schemas = responseSchemas(packageRoot);
  const missing: string[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, op] of Object.entries(item as Record<string, Operation>)) {
      if (op['x-result-type'] === undefined) missing.push(`${method.toUpperCase()} ${path}`);
      else if (op['x-result-type'] !== null && !schemas[op['x-result-type']]) {
        missing.push(`${method.toUpperCase()} ${path} (unknown type ${op['x-result-type']})`);
      }
      // Signed in with a bearer token, except public routes.
      op.security = op['x-public'] ? [] : [{ bearer: [] }];
      op.responses.default = {
        description: 'Error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorBody' } } },
      };
      delete op['x-public'];
      delete op['x-result-type'];
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Routes without a response type (add @ApiResult/@ApiNoBody/@ApiFile, and the type to src/openapi/responses.ts):\n  ${missing.join('\n  ')}`,
    );
  }
  const components = (document.components ??= {});
  const existing = (components.schemas ??= {});
  for (const [name, schema] of Object.entries(schemas)) {
    if (existing[name]) throw new Error(`Schema ${name} is both a DTO and a response type`);
    existing[name] = schema as object;
  }
  return sortKeys(document) as OpenAPIObject;
}

/** JSON schemas for every type exported from `responses.ts`, as OpenAPI components. */
export function responseSchemas(packageRoot: string): Record<string, unknown> {
  const path = join(packageRoot, 'src/openapi/responses.ts');
  const config: CompletedConfig = {
    ...DEFAULT_CONFIG,
    path,
    tsconfig: join(packageRoot, 'tsconfig.json'),
    type: '*',
    expose: 'export',
    topRef: true,
    jsDoc: 'extended',
    skipTypeCheck: true,
  };
  const program = createProgram(config);
  const parser = createParser(program, config, (p) => p.addNodeParser(new PrismaJsonParser()));
  const generator = new SchemaGenerator(program, parser, createFormatter(config), config);
  // One exported type at a time ('*' drops some), merged; a name used by two
  // different types would be a silent mix-up, so it fails.
  const source = readFileSync(path, 'utf8');
  const names = [
    ...[...source.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]!),
    ...[...source.matchAll(/^export type \{([^}]*)\} from/gm)].flatMap((m) =>
      m[1]!
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ];
  const definitions: Record<string, unknown> = {};
  for (const name of names) {
    const schema = generator.createSchema(name);
    for (const [key, value] of Object.entries(schema.definitions ?? {})) {
      if (definitions[key] && JSON.stringify(definitions[key]) !== JSON.stringify(value)) {
        throw new Error(`Two different types are both called ${key}`);
      }
      definitions[key] = value;
    }
  }
  // `#/definitions/X` → `#/components/schemas/X`, with names OpenAPI allows
  // (a generic such as `Page<X>` becomes `Page_X`).
  const safe = (name: string) =>
    decodeURIComponent(name)
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/_+$/, '');
  const renamed = Object.fromEntries(Object.entries(definitions).map(([k, v]) => [safe(k), v]));
  return JSON.parse(
    JSON.stringify(renamed).replace(
      /"#\/definitions\/([^"]+)"/g,
      (_, name: string) => `"#/components/schemas/${safe(name)}"`,
    ),
  ) as Record<string, unknown>;
}

/** Object keys sorted at every level, so the committed file only changes when the API does. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
