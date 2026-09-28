// Runs once after the integration tests: removes the template and any
// per-file databases that an interrupted test file didn't drop.
const { baseDatabaseUrl, dropTestDatabases, withAdmin } = require('./support/test-databases.cjs');

module.exports = async function globalTeardown() {
  const url = baseDatabaseUrl();
  await withAdmin(url, (admin) => dropTestDatabases(admin, url));
};
