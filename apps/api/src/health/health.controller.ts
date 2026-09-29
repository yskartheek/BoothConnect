import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../auth/decorators';
import { type HealthReport, HealthService } from './health.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

// Load balancers and Docker health checks call this without signing in.
@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // 200 when every dependency is up, 503 otherwise, so load balancers and
  // Docker healthchecks can use the status code alone.
  @ApiResult('HealthReport')
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.report();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
