import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const tones = {
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  red: 'bg-red-50 text-red-600 ring-red-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const;

export type IconTone = keyof typeof tones;

/** A small tinted tile holding an icon. Colour reinforces meaning; nearby text always states it. */
export function IconChip({
  icon: Icon,
  tone = 'indigo',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: IconTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = { sm: 'size-7 rounded-md', md: 'size-9 rounded-lg', lg: 'size-11 rounded-xl' }[size];
  const glyph = { sm: 'size-3.5', md: 'size-4.5', lg: 'size-5' }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center ring-1 ring-inset', box, tones[tone], className)}>
      <Icon className={glyph} aria-hidden />
    </span>
  );
}
