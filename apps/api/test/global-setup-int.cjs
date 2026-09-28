// Runs once before the integration tests: builds the template database that
// every test file copies (see test/support/test-databases.cjs).
const { execFileSync } = require('node:child_process');
const { delimiter, join } = require('node:path');

const {
  API_DIR,
  baseDatabaseUrl,
  dropTestDatabases,
  quote,
  templateName,
  withAdmin,
  withDatabase,
} = require('./support/test-databases.cjs');

module.exports = async function globalSetup() {
  const url = baseDatabaseUrl();
  const template = templateName(url);

  await withAdmin(url, async (admin) => {
    await dropTestDatabases(admin, url);
    await admin.query(`CREATE DATABASE ${quote(template)}`);
  });

  const bin = join(API_DIR, 'node_modules', '.bin');
  const prisma = join(bin, 'prisma');
  // The seed command runs `tsx`, which is only on PATH under `pnpm test:int`;
  // add it so running Jest directly (or from an editor) works too.
  // Windows names the variable `Path`.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const env = {
    ...process.env,
    DATABASE_URL: withDatabase(url, template),
    [pathKey]: [bin, process.env[pathKey]].join(delimiter),
  };
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'seed'],
  ]) {
    execFileSync(prisma, args, {
      cwd: API_DIR,
      env,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
  }
};
