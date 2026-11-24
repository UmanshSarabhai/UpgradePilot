import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  typescript: 'bg-blue-500',
  javascript: 'bg-yellow-400',
  python: 'bg-sky-600',
  go: 'bg-cyan-500',
  rust: 'bg-orange-600',
  java: 'bg-red-500',
  ruby: 'bg-rose-500',
  php: 'bg-indigo-400',
  html: 'bg-orange-500',
  css: 'bg-violet-500',
  vue: 'bg-emerald-500',
  shell: 'bg-lime-500',
};

/** Language name with a coloured dot. Unknown languages get a neutral dot; the name is always shown. */
export function LanguageDot({ language, className }: { language: string | null; className?: string }) {
  if (!language) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('size-2.5 shrink-0 rounded-full', COLORS[language.toLowerCase()] ?? 'bg-slate-400')} aria-hidden />
      {language}
    </span>
  );
}
