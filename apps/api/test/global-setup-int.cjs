// Runs once before the integration tests: builds the template database that
// every test file copies (see test/support/test-databases.cjs).
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

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

  const prisma = join(API_DIR, 'node_modules', '.bin', 'prisma');
  const env = { ...process.env, DATABASE_URL: withDatabase(url, template) };
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
