// Runs before each integration test file, before any import. AppConfigModule
// reads DATABASE_URL when it is imported, so the file's own database (a copy
// of the template, see test/support/test-databases.cjs) is chosen here; it is
// created by test/setup-int-database.cjs before the first test runs. REDIS_URL
// comes from the shell or the repo-root .env; only logging is quietened.
const { baseDatabaseUrl, suiteName, withDatabase } = require('./support/test-databases.cjs');

const base = baseDatabaseUrl();
process.env.IT_BASE_DATABASE_URL = base;
process.env.IT_SUITE_DATABASE = suiteName(base);
process.env.DATABASE_URL = withDatabase(base, process.env.IT_SUITE_DATABASE);
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'fatal';
