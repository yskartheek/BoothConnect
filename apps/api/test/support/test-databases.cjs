// Shared by the integration-test global setup/teardown and the per-file setup.
//
// Each integration run builds one template database (migrated and seeded), and
// every test file gets its own copy of it, named <db>_it_<random>. Copying a
// template takes about 100 ms, so each file starts from the same clean data
// and files can run in parallel without seeing each other's rows. The
// database in DATABASE_URL itself is never touched.
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

const { config: loadEnv } = require('dotenv');
const { Client } = require('pg');

const API_DIR = join(__dirname, '..', '..');

/** DATABASE_URL from the shell or the .env files (same order as prisma.config.ts). */
function baseDatabaseUrl() {
  loadEnv({ path: [join(API_DIR, '.env'), join(API_DIR, '..', '..', '.env')], quiet: true });
  const url = process.env.IT_BASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see infra/env/.env.example)');
  return url;
}

function withDatabase(url, name) {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

function baseName(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

const templateName = (url) => `${baseName(url)}_it_template`;
const suiteName = (url) => `${baseName(url)}_it_${randomBytes(6).toString('hex')}`;

/** Runs `fn` with a client connected to the server's `postgres` database. */
async function withAdmin(url, fn) {
  const client = new Client({ connectionString: withDatabase(url, 'postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

async function dropDatabase(admin, name) {
  await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
}

/** Drops the template and any per-file databases left over by an interrupted run. */
async function dropTestDatabases(admin, url) {
  const { rows } = await admin.query(
    "SELECT datname FROM pg_database WHERE datname LIKE $1 ESCAPE '\\'",
    [`${baseName(url).replaceAll('_', '\\_')}\\_it\\_%`],
  );
  for (const { datname } of rows) await dropDatabase(admin, datname);
}

module.exports = {
  API_DIR,
  baseDatabaseUrl,
  withDatabase,
  templateName,
  suiteName,
  withAdmin,
  quote,
  dropDatabase,
  dropTestDatabases,
};
