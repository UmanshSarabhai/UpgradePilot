import type { ScanStatus } from '@upgradepilot/shared';
import { AppError, UpstreamError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { ScanRecord, ScanStore, ScanUpdate } from '../storage/scan-store';

export type ActiveStatus = Exclude<ScanStatus, 'COMPLETED' | 'FAILED'>;

export interface StageResult {
  update: ScanUpdate;
  /** Idempotent writes committed together with the scan update. */
  writes: D1PreparedStatement[];
}

export type StageHandlers = Record<ActiveStatus, (scan: ScanRecord) => Promise<StageResult>>;

export type StepOutcome =
  | { kind: 'continue'; step: number }
  | { kind: 'retry'; step: number; delaySeconds: number }
  | { kind: 'finished'; status: 'COMPLETED' | 'FAILED' }
  | { kind: 'skipped' };

export interface ScanRunnerOptions {
  store: ScanStore;
  stages: StageHandlers;
  logger: Logger;
  nowMs?: () => number;
  leaseMs?: number;
  maxAttempts?: number;
}

const MIN_RATE_LIMIT_WAIT_S = 30;
const MAX_RATE_LIMIT_WAIT_S = 3600;
const MAX_BACKOFF_S = 300;

/**
 * Advances a scan by one bounded step: lease → run the stage → commit writes and the next state together.
 * The caller (queue consumer) enqueues the next step from the outcome. A lost lease or a stale step number
 * returns `skipped`, so duplicate messages never run the same step twice at once.
 */
export function createScanRunner(options: ScanRunnerOptions) {
  const { store, stages, logger } = options;
  const nowMs = options.nowMs ?? Date.now;
  const leaseMs = options.leaseMs ?? 120_000;
  const maxAttempts = options.maxAttempts ?? 4;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function handleFailure(scan: ScanRecord, leaseUntil: string, error: unknown, log: Logger): Promise<StepOutcome> {
    if (error instanceof UpstreamError && error.kind === 'rate_limited') {
      const wait = Math.ceil((error.retryAfterMs ?? 60_000) / 1000);
      const delaySeconds = Math.min(MAX_RATE_LIMIT_WAIT_S, Math.max(MIN_RATE_LIMIT_WAIT_S, wait));
      log.warn('scan step rate limited', { url: error.url, delaySeconds });
      await store.release(scan.id, leaseUntil, {
        nextAttemptAt: iso(nowMs() + delaySeconds * 1000),
        errorMessage: 'Waiting for the GitHub or npm rate limit to reset.',
        countAttempt: false,
      });
      return { kind: 'retry', step: scan.stepSeq, delaySeconds };
    }

    const message = error instanceof AppError || error instanceof UpstreamError ? error.message : 'Unexpected error while scanning.';
    // AppErrors (branch deleted, repository made private) will not fix themselves on retry.
    if (error instanceof AppError || scan.attemptCount >= maxAttempts) {
      log.error('scan failed', { error, attempt: scan.attemptCount });
      await store.fail(scan.id, leaseUntil, message);
      return { kind: 'finished', status: 'FAILED' };
    }

    const delaySeconds = Math.min(MAX_BACKOFF_S, 15 * 2 ** (scan.attemptCount - 1));
    log.warn('scan step failed, will retry', { error, attempt: scan.attemptCount, delaySeconds });
    await store.release(scan.id, leaseUntil, {
      nextAttemptAt: iso(nowMs() + delaySeconds * 1000),
      errorMessage: message,
      countAttempt: true,
    });
    return { kind: 'retry', step: scan.stepSeq, delaySeconds };
  }

  return {
    async step(scanId: string, expectedStep: number): Promise<StepOutcome> {
      const leaseUntil = iso(nowMs() + leaseMs);
      const scan = await store.lease(scanId, expectedStep, leaseUntil);
      if (!scan || scan.status === 'COMPLETED' || scan.status === 'FAILED') return { kind: 'skipped' };

      const log = logger.child({ scanId, status: scan.status, step: scan.stepSeq });
      let result: StageResult;
      try {
        result = await stages[scan.status](scan);
      } catch (error) {
        return handleFailure(scan, leaseUntil, error, log);
      }

      if (!(await store.commit(scan.id, leaseUntil, result.update, result.writes))) {
        log.warn('scan lease lost before commit');
        return { kind: 'skipped' };
      }
      log.info('scan step committed', { next: result.update.status, progress: result.update.progress });
      return result.update.status === 'COMPLETED'
        ? { kind: 'finished', status: 'COMPLETED' }
        : { kind: 'continue', step: scan.stepSeq + 1 };
    },
  };
}
