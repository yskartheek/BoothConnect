import { Logger } from '@nestjs/common';

import type { HealthCheck } from './health-check';
import { CHECK_TIMEOUT_MS, HealthService } from './health.service';

const up = (name: string): HealthCheck => ({ name, check: () => Promise.resolve() });
const down = (name: string): HealthCheck => ({
  name,
  check: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
});
const hanging = (name: string): HealthCheck => ({ name, check: () => new Promise(() => {}) });

describe('HealthService', () => {
  // Failed checks log a warning; keep the test output clean.
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterEach(() => jest.useRealTimers());

  it('reports ok when every check passes', async () => {
    const report = await new HealthService([up('database'), up('redis')]).report();
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({
      database: { status: 'up', latencyMs: expect.any(Number) },
      redis: { status: 'up', latencyMs: expect.any(Number) },
    });
  });

  it('reports error when one check fails, without exposing the error', async () => {
    const report = await new HealthService([up('database'), down('redis')]).report();
    expect(report.status).toBe('error');
    expect(report.checks.database?.status).toBe('up');
    expect(report.checks.redis?.status).toBe('down');
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
  });

  it('marks a check that never answers as down after the timeout', async () => {
    jest.useFakeTimers();
    const pending = new HealthService([hanging('database')]).report();
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    const report = await pending;
    expect(report.status).toBe('error');
    expect(report.checks.database?.status).toBe('down');
  });
});
