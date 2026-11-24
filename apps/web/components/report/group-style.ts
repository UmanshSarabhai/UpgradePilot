import type { ReportGroup } from '@upgradepilot/shared';

/** Colour by group. Each group also has a text label, so colour is never the only signal. */
export const GROUP_STYLE: Record<ReportGroup, { label: string; border: string; pill: string }> = {
  highRisk: { label: 'High risk', border: 'border-l-red-500', pill: 'border-red-200 bg-red-50 text-red-700' },
  review: { label: 'Review', border: 'border-l-amber-500', pill: 'border-amber-200 bg-amber-50 text-amber-800' },
  safe: { label: 'Safe', border: 'border-l-emerald-500', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
