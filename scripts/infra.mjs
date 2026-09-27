#!/usr/bin/env node
// Runs `docker compose` for infra/docker-compose.yml. Loads the repository-root
// `.env` when it exists; otherwise the compose file's built-in defaults apply.
//
// Usage: node scripts/infra.mjs <up|down|logs|reset>

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'infra', 'docker-compose.yml');
const envFile = join(root, '.env');

// `up --wait` treats the one-shot bucket job's exit as a failure, so wait for
// the long-running services first and then run the job on its own.
const commands = {
  up: [
    ['up', '-d', '--wait', 'postgres', 'redis', 'minio'],
    ['run', '--rm', 'minio-init'],
  ],
  down: [['down']],
  logs: [['logs', '-f']],
  reset: [['down', '--volumes']],
};

const action = process.argv[2];
if (!(action in commands)) {
  console.error(`Usage: node scripts/infra.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}

const baseArgs = ['compose', '-f', composeFile];
if (existsSync(envFile)) {
  baseArgs.push('--env-file', envFile);
}

for (const args of commands[action]) {
  const result = spawnSync('docker', [...baseArgs, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run docker: ${result.error.message}. Is Docker Desktop running?`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
