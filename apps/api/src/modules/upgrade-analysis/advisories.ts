import type { Advisory } from '@upgradepilot/shared';
import semver from 'semver';
import { z } from 'zod';
import type { HttpClient } from '../../lib/http';

/** npm's bulk advisory endpoint, the one `npm audit` uses. One POST covers every package in a scan. */
export const ADVISORY_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

const BulkResponseSchema = z.record(
  z.string(),
  z.array(
    z.object({
      id: z.number(),
      url: z.string(),
      title: z.string(),
      severity: z.enum(['info', 'low', 'moderate', 'high', 'critical']),
      vulnerable_versions: z.string(),
    }),
  ),
);

/**
 * Looks up advisories for the given installed versions.
 * Returns, per package, every advisory that affects at least one of the versions asked about.
 */
export async function fetchAdvisories(
  http: HttpClient,
  installed: Record<string, string[]>,
): Promise<Record<string, Advisory[]>> {
  if (Object.keys(installed).length === 0) return {};
  const response = await http.postJson(ADVISORY_URL, installed, BulkResponseSchema, { maxBytes: 5 * 1024 * 1024 });
  const result: Record<string, Advisory[]> = {};
  for (const [name, advisories] of Object.entries(response)) {
    result[name] = advisories.map((a) => ({
      id: a.id,
      url: a.url,
      title: a.title,
      severity: a.severity,
      vulnerableVersions: a.vulnerable_versions,
    }));
  }
  return result;
}

/** The advisories that affect one specific installed version. */
export function advisoriesFor(all: Advisory[] | undefined, version: string): Advisory[] {
  return (all ?? []).filter((advisory) => {
    try {
      return semver.satisfies(version, advisory.vulnerableVersions, { includePrerelease: true });
    } catch {
      return false;
    }
  });
}
