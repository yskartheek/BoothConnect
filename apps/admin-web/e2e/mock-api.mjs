// A stand-in for the BoothConnect API in the browser tests (CI runs them
// without the API or a database). It knows two synthetic people: an admin
// and a volunteer; the code is always 123456.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 4100);
const CODE = '123456';
const PEOPLE = {
  '+919999900001': { id: 'u-admin', name: 'Test Admin', role: 'admin' },
  '+919999900002': { id: 'u-volunteer', name: 'Test Volunteer', role: 'volunteer' },
};
const tokens = new Map(); // access token -> person
let issued = 0;

const send = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
const error = (res, status, code) =>
  send(res, status, { requestId: `mock-${Date.now()}`, code, message: code });

createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const person = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
  const url = new URL(req.url, 'http://mock');

  if (req.method === 'POST' && url.pathname === '/v1/auth/otp/request') return send(res, 202);
  if (req.method === 'POST' && url.pathname === '/v1/auth/otp/verify') {
    const who = PEOPLE[body.phone];
    if (!who || body.code !== CODE || !body.deviceId) return error(res, 401, 'OTP_INVALID');
    const accessToken = `access-${(issued += 1)}`;
    tokens.set(accessToken, who);
    return send(res, 200, {
      accessToken,
      refreshToken: `refresh-${issued}`,
      tokenType: 'Bearer',
      expiresIn: 900,
    });
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    if (!person) return error(res, 401, 'UNAUTHENTICATED');
    for (const [token, who] of tokens) if (who === person) tokens.delete(token);
    return send(res, 204);
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    return error(res, 401, 'UNAUTHENTICATED');
  }
  if (req.method === 'GET' && url.pathname === '/v1/health')
    return send(res, 200, { status: 'ok', checks: {} });
  if (req.method === 'GET' && url.pathname === '/v1/me') {
    if (!person) return error(res, 401, 'UNAUTHENTICATED');
    return send(res, 200, {
      id: person.id,
      name: person.name,
      phone: '+91…',
      email: null,
      preferredLanguage: 'en',
      mfaState: 'not_enrolled',
      assignments: [
        {
          id: `a-${person.id}`,
          role: person.role,
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: null,
          node: { id: 'n-1', type: 'ac', code: '101', name: 'Demo AC', isAuxiliary: false },
          path: [],
        },
      ],
    });
  }
  return error(res, 404, 'NOT_FOUND');
}).listen(PORT);
