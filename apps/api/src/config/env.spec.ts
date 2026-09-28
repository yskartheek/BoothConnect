import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(validateEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: [],
      JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-change-me',
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_REFRESH_TTL_SECONDS: 2592000,
      OTP_TTL_SECONDS: 300,
      OTP_DEV_MODE: false,
      OTP_MAX_ATTEMPTS: 5,
      OTP_REQUEST_LIMIT: 3,
      OTP_REQUEST_WINDOW_SECONDS: 600,
      IDEMPOTENCY_TTL_SECONDS: 604800,
    });
  });

  it('parses OTP_DEV_MODE as a boolean', () => {
    expect(validateEnv({ ...valid, OTP_DEV_MODE: 'true' }).OTP_DEV_MODE).toBe(true);
    expect(validateEnv({ ...valid, OTP_DEV_MODE: 'false' }).OTP_DEV_MODE).toBe(false);
  });

  describe('in production', () => {
    const strong = {
      ...valid,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };

    it('accepts strong, distinct secrets', () => {
      expect(() => validateEnv(strong)).not.toThrow();
    });

    it.each([
      ['the development default', { JWT_ACCESS_SECRET: undefined }, 'JWT_ACCESS_SECRET'],
      ['a short secret', { JWT_REFRESH_SECRET: 'short' }, 'JWT_REFRESH_SECRET'],
      ['the same secret twice', { JWT_REFRESH_SECRET: 'a'.repeat(32) }, 'JWT_REFRESH_SECRET'],
      ['OTP dev mode', { OTP_DEV_MODE: 'true' }, 'OTP_DEV_MODE'],
    ])('refuses %s', (_name, override, key) => {
      expect(() => validateEnv({ ...strong, ...override })).toThrow(key);
    });
  });

  it('coerces the port and splits CORS origins', () => {
    const env = validateEnv({
      ...valid,
      API_PORT: '8080',
      CORS_ORIGINS: 'http://localhost:3000, https://admin.example.org,',
    });
    expect(env.API_PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://admin.example.org']);
  });

  it('fails fast and names every missing variable', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['API_PORT', '70000'],
    ['NODE_ENV', 'staging'],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => validateEnv({ ...valid, [key]: value })).toThrow(key);
  });
});
