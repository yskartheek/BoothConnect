// Creates this test file's database from the template before its first test,
// and drops it after its last one. These hooks run before the file's own
// beforeAll, so nothing has connected yet.
const { dropDatabase, quote, templateName, withAdmin } = require('./support/test-databases.cjs');

const base = process.env.IT_BASE_DATABASE_URL;
const name = process.env.IT_SUITE_DATABASE;

beforeAll(async () => {
  await withAdmin(base, (admin) =>
    admin.query(`CREATE DATABASE ${quote(name)} TEMPLATE ${quote(templateName(base))}`),
  );
});

afterAll(async () => {
  await withAdmin(base, (admin) => dropDatabase(admin, name));
});
