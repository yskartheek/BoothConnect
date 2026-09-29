import { Injectable, Logger } from '@nestjs/common';

/**
 * Asks for the analytics of some geography nodes (and so their ancestors)
 * to be recomputed, e.g. after an import file is committed. The `node_stats`
 * table and its refresh job come in #102, which replaces this provider.
 */
export abstract class NodeStatsRefresh {
  abstract request(nodeIds: string[]): Promise<void>;
}

/** Until #102: only logs which nodes changed. */
@Injectable()
export class LoggingNodeStatsRefresh extends NodeStatsRefresh {
  private readonly logger = new Logger('NodeStatsRefresh');

  request(nodeIds: string[]): Promise<void> {
    this.logger.log(`stats refresh requested for ${nodeIds.length} node(s)`);
    return Promise.resolve();
  }
}
