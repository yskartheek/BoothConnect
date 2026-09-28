import type { ConnectionOptions } from 'bullmq';

/** BullMQ connection options from a redis:// or rediss:// URL. */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    // Required by BullMQ for blocking connections; harmless for the others.
    maxRetriesPerRequest: null,
  };
}
