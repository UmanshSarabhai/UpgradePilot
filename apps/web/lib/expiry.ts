const DAY_MS = 86_400_000;

/** Whole days left until `iso`, rounded up, never below 0. */
export function daysUntil(iso: string, now = Date.now()): number {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

export function expiryLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return 'Expires today';
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`;
}
