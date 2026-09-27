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
