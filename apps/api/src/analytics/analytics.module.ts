import { Module } from '@nestjs/common';

import { NodeStatsService } from './node-stats.service';
import { NodeStatsRefresh } from './stats-refresh';

/** Per-node analytics (#102): `node_stats` and its refresh queue. */
@Module({
  providers: [NodeStatsService, { provide: NodeStatsRefresh, useExisting: NodeStatsService }],
  exports: [NodeStatsService, NodeStatsRefresh],
})
export class AnalyticsModule {}
