import { Inject, Injectable, Logger } from '@nestjs/common';

import { HEALTH_CHECKS, type HealthCheck } from './health-check';

export type ComponentStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: Record<string, { status: ComponentStatus; latencyMs: number }>;
}

export const CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthCheck[]) {}

  async report(): Promise<HealthReport> {
    const results = await Promise.all(
      this.checks.map(async (check) => [check.name, await this.run(check)] as const),
    );
    const checks = Object.fromEntries(results);
    const status = results.every(([, result]) => result.status === 'up') ? 'ok' : 'error';
    return { status, checks };
  }

  private async run(check: HealthCheck): Promise<HealthReport['checks'][string]> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'up', latencyMs: elapsed(started) };
    } catch (error) {
      // Details go to the log only; the public response just says "down".
      this.logger.warn(
        `Health check "${check.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 'down', latencyMs: elapsed(started) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
