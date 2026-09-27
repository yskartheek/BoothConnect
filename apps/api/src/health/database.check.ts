import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import type { HealthCheck } from './health-check';

@Injectable()
export class DatabaseHealthCheck implements HealthCheck {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
