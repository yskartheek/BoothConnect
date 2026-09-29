import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../app.module';
import { UsersService } from './users.service';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Makes someone an admin of a node, run on the server after `build`:
 *
 *   pnpm --filter api admin:grant --phone +919876543210 --name "Their name" --node S29/6/40
 *
 * `--node` is the path of codes from the State down (a State: `S29`). This is
 * how the first admin of a deployment is set up; after that, admins add
 * people in their own area through the API (#173). Audited as a system event.
 */
async function grant(): Promise<void> {
  const { values } = parseArgs({
    options: {
      phone: { type: 'string' },
      name: { type: 'string' },
      node: { type: 'string' },
    },
  });
  if (!values.phone || !E164.test(values.phone) || !values.name?.trim() || !values.node) {
    throw new Error('Usage: admin:grant --phone +919876543210 --name "Their name" --node S29/6/40');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  try {
    const result = await app.get(UsersService).bootstrapAdmin({
      phone: values.phone,
      name: values.name.trim(),
      nodePath: values.node,
    });
    // Ids only: the phone and name stay out of the logs.
    app
      .get(Logger)
      .log(
        result.assignmentId
          ? `Admin role granted: user ${result.userId}${result.created ? ' (new)' : ''}, assignment ${result.assignmentId}`
          : `User ${result.userId} is already an admin there; nothing changed`,
        'AdminGrant',
      );
  } finally {
    await app.close();
  }
}

grant().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
