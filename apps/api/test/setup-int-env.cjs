// Integration tests use the real DATABASE_URL and REDIS_URL (from the shell or
// the repo-root .env); only logging is quietened.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'fatal';
