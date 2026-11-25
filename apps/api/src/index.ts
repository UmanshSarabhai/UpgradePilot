import { createApp } from './app';
import { type ScanMessage, ScanMessageSchema } from './env';
import { createLogger } from './lib/logger';
import { retentionCutoff, retentionDays } from './lib/retention';
import { buildServices } from './services';

const app = createApp();

/** Scans with no progress for this long are considered stuck and re-enqueued by the cron sweep. */
const STALE_AFTER_MS = 3 * 60_000;
const SWEEP_LIMIT = 20;
/** Scans deleted per cron run (every 5 minutes): up to 7,200 a day, well inside D1's per-invocation limits. */
const RETENTION_BATCH = 25;

export default {
  fetch: app.fetch,

  /** Runs one scan step per message, then enqueues the next one. */
  async queue(batch, env) {
    const logger = createLogger(env.LOG_LEVEL, { queue: batch.queue });
    const { runner } = buildServices(env, logger);
    for (const message of batch.messages) {
      const body = ScanMessageSchema.safeParse(message.body);
      if (!body.success) {
        logger.error('dropping malformed scan message', { body: message.body });
        message.ack();
        continue;
      }
      try {
        const outcome = await runner.step(body.data.scanId, body.data.step);
        if (outcome.kind === 'continue') {
          await env.SCAN_QUEUE.send({ scanId: body.data.scanId, step: outcome.step } satisfies ScanMessage);
        } else if (outcome.kind === 'retry') {
          await env.SCAN_QUEUE.send({ scanId: body.data.scanId, step: outcome.step } satisfies ScanMessage, {
            delaySeconds: outcome.delaySeconds,
          });
        }
        message.ack();
      } catch (error) {
        // Infrastructure failure (D1 or the queue itself). Let Queues redeliver; the sweep is the backstop.
        logger.error('scan step crashed', { scanId: body.data.scanId, error });
        message.retry();
      }
    }
  },

  /** Recovery sweep: restarts stuck scans and clears expired cache rows. */
  async scheduled(_controller, env) {
    const logger = createLogger(env.LOG_LEVEL, { cron: 'sweep' });
    const { store } = buildServices(env, logger);
    // Scans that keep getting killed are re-queued too: the runner fails them once their attempts run out.
    const stale = await store.listStale(new Date(Date.now() - STALE_AFTER_MS).toISOString(), SWEEP_LIMIT);
    for (const scan of stale) {
      await env.SCAN_QUEUE.send({ scanId: scan.id, step: scan.stepSeq } satisfies ScanMessage);
    }
    await store.purgeExpiredCache(Date.now());
    await store.purgeOldQuotaWindows(Date.now());
    await store.purgeExpiredSessions();
    // Data retention for every user: scans older than DATA_RETENTION_DAYS are hard-deleted in batches.
    const purged = await store.purgeExpiredScans(retentionCutoff(retentionDays(env)), RETENTION_BATCH);
    if (purged > 0) logger.info('deleted expired scans', { count: purged });
    if (stale.length > 0) logger.info('re-enqueued stale scans', { count: stale.length });
  },
} satisfies ExportedHandler<Env, unknown>;
