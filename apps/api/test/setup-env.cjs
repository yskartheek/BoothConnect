// Runs before each test file. AppConfigModule validates the environment when
// it is imported, so the required variables must exist before any import.
// Real values from the shell or a .env file are overridden: tests never touch
// real services.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
});
