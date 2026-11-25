import { intVar } from './limits';

/** Days a scan and its results are kept before automatic deletion (DATA_RETENTION_DAYS, default 10, minimum 1). */
export function retentionDays(env: { DATA_RETENTION_DAYS?: string }): number {
  return Math.max(1, intVar(env.DATA_RETENTION_DAYS, 10));
}

/** When a scan created at `createdAt` is deleted. */
export function expiresAt(createdAt: string, days: number): string {
  return new Date(new Date(createdAt).getTime() + days * 86_400_000).toISOString();
}

/** Scans created before this moment are past retention. */
export function retentionCutoff(days: number, nowMs = Date.now()): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}
