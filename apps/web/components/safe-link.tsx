import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Only http(s) URLs become links. Anything else (javascript:, data:, relative) is not linkable. */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function SafeLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!isHttpUrl(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 text-primary underline-offset-4 break-all hover:underline', className)}
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}
