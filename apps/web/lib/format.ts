import type { DependencyType, ScanStatus, UnresolvedReason } from '@upgradepilot/shared';

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : '';
}

/** "3 min ago" style, falling back to a date after a week. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  return formatDate(iso);
}

export const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  PENDING: 'Queued',
  FETCHING_REPOSITORY: 'Fetching repository',
  DISCOVERING_DEPENDENCIES: 'Discovering dependencies',
  RESOLVING_VERSIONS: 'Resolving versions',
  COLLECTING_RELEASE_NOTES: 'Collecting release notes',
  ANALYZING_UPGRADES: 'Analysing upgrades',
  GENERATING_REPORT: 'Generating report',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export const DEPENDENCY_TYPE_LABEL: Record<DependencyType, string> = {
  dependencies: 'dependencies',
  devDependencies: 'devDependencies',
  optionalDependencies: 'optionalDependencies',
  peerDependencies: 'peerDependencies',
};

export const UNRESOLVED_REASON_LABEL: Record<UnresolvedReason, string> = {
  NO_LOCKFILE: 'No lockfile, and the range is not an exact version',
  NOT_IN_LOCKFILE: 'Not found in the lockfile',
  LOCKFILE_UNREADABLE: 'Lockfile could not be read',
  WORKSPACE_PACKAGE: 'Workspace package',
  LOCAL_PACKAGE: 'Local file or link',
  NON_REGISTRY_SOURCE: 'Git or URL source',
  INVALID_VERSION_SPEC: 'Invalid version spec',
};

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
