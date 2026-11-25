'use client';

import { Hourglass } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { daysUntil, expiryLabel } from '@/lib/expiry';
import { cn } from '@/lib/utils';

export function ExpiryBadge({ expiresAt, compact, className }: { expiresAt: string; compact?: boolean; className?: string }) {
  const days = daysUntil(expiresAt);
  const color =
    days === 0
      ? 'bg-red-50 text-red-700 border-red-200'
      : days <= 2
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-muted text-muted-foreground border-border';
  const label = expiryLabel(expiresAt);
  return (
    <Badge variant="outline" className={cn('font-medium whitespace-nowrap', color, className)}>
      <Hourglass aria-hidden />
      {compact ? (
        <>
          <span aria-hidden>{days === 0 ? 'today' : `${days}d`}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </Badge>
  );
}
