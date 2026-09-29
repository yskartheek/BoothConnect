import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { NodeStatsService } from './node-stats.service';
import { NodeStatsRefresh } from './stats-refresh';

/** Per-node analytics: `node_stats` and its refresh queue (#102), and the API (#49). */
@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    NodeStatsService,
    { provide: NodeStatsRefresh, useExisting: NodeStatsService },
  ],
  exports: [NodeStatsService, NodeStatsRefresh],
})
export class AnalyticsModule {}
