// @vitest-environment node
import { NextRequest } from 'next/server';

import { config, proxy } from '@/proxy';

const at = (path: string, cookies: Record<string, string> = {}) => {
  const req = new NextRequest(`http://localhost:3000${path}`);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return proxy(req);
};

describe('proxy (route guard)', () => {
  it('sends a signed-out visitor to sign-in, remembering where they were going', () => {
    expect(at('/users?role=admin').headers.get('location')).toBe(
      'http://localhost:3000/sign-in?next=%2Fusers%3Frole%3Dadmin',
    );
    expect(at('/').headers.get('location')).toBe('http://localhost:3000/sign-in');
  });

  it('sends a half-signed-in admin to the MFA step', () => {
    const res = at('/audit', { bc_refresh: 'r', bc_mfa: 'pending' });
    expect(res.headers.get('location')).toBe('http://localhost:3000/sign-in/mfa');
  });

  it('lets a signed-in admin through', () => {
    const res = at('/audit', { bc_refresh: 'r', bc_mfa: 'done' });
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not run on sign-in, the denied page, /auth, /api or Next’s files', () => {
    const [pattern] = config.matcher;
    const matches = (path: string) => new RegExp(`^${pattern!.replace('/(', '/(')}$`).test(path);
    expect(matches('/users')).toBe(true);
    expect(matches('/')).toBe(true);
    for (const path of [
      '/sign-in',
      '/sign-in/mfa',
      '/denied',
      '/auth/verify',
      '/api/v1/me',
      '/_next/static/x.js',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });
});
