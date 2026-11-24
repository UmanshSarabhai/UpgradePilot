import type { InstalledVersionSource } from '@upgradepilot/shared';
import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '../../lib/guards';

export const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

export interface LockfileQuery {
  /** Manifest folder relative to the lockfile's folder. "" for the same folder. */
  importerPath: string;
  name: string;
  spec: string;
}

export interface LockfileIndex {
  source: InstalledVersionSource;
  /** Installed version for a direct dependency, or null when the lockfile does not record one. */
  installedVersion(query: LockfileQuery): string | null;
}

export class LockfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockfileParseError';
  }
}

export function parseLockfile(fileName: LockfileName, text: string): LockfileIndex {
  switch (fileName) {
    case 'package-lock.json':
      return parsePackageLock(text);
    case 'pnpm-lock.yaml':
      return parsePnpmLock(text);
    case 'yarn.lock':
      return parseYarnLock(text);
  }
}

/**
 * package-lock.json v1 to v3. v2+ keys installs by path ("node_modules/x", "apps/web/node_modules/x").
 * A workspace's own copy wins over the hoisted root copy, matching npm's resolution.
 * Entries are checked when looked up rather than validating the whole file, to save CPU.
 */
export function parsePackageLock(text: string): LockfileIndex {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LockfileParseError('package-lock.json is not valid JSON');
  }
  if (!isRecord(data)) throw new LockfileParseError('package-lock.json is not a JSON object');
  const packages = isRecord(data.packages) ? data.packages : null;
  const legacy = isRecord(data.dependencies) ? data.dependencies : null;

  return {
    source: 'package-lock',
    installedVersion({ importerPath, name }) {
      if (packages) {
        const prefix = importerPath ? `${importerPath}/` : '';
        for (const key of [`${prefix}node_modules/${name}`, `node_modules/${name}`]) {
          const entry = packages[key];
          if (isRecord(entry) && typeof entry.version === 'string') return semver.valid(entry.version);
        }
        return null;
      }
      // v1 only records the root project.
      if (legacy && importerPath === '') {
        const entry = legacy[name];
        if (isRecord(entry) && typeof entry.version === 'string') return semver.valid(entry.version);
      }
      return null;
    },
  };
}

/**
 * pnpm-lock.yaml v5 to v9. Direct dependency versions live under `importers` (or top-level sections for
 * single-project v5/v6 files), which come before the large `packages`/`snapshots` sections. Only that
 * top part is parsed.
 */
export function parsePnpmLock(text: string): LockfileIndex {
  // pnpm 11+ writes two YAML documents: a small environment lockfile, then the project lockfile. Use the last one.
  const documents = text.split(/^---\s*$/m).filter((doc) => doc.trim() !== '');
  const main = documents[documents.length - 1] ?? '';
  const cut = main.search(/^(?:packages|snapshots):\s*$/m);
  let data: unknown;
  try {
    data = parseYaml(cut === -1 ? main : main.slice(0, cut));
  } catch {
    throw new LockfileParseError('pnpm-lock.yaml is not valid YAML');
  }
  if (!isRecord(data)) throw new LockfileParseError('pnpm-lock.yaml is not a YAML mapping');
  const importers = isRecord(data.importers) ? data.importers : { '.': data };

  return {
    source: 'pnpm-lock',
    installedVersion({ importerPath, name }) {
      const importer = importers[importerPath || '.'];
      if (!isRecord(importer)) return null;
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const deps = importer[section];
        if (!isRecord(deps)) continue;
        const entry = deps[name];
        // v6+: { specifier, version }. v5: plain version string.
        const raw = typeof entry === 'string' ? entry : isRecord(entry) ? entry.version : undefined;
        if (typeof raw === 'string') return normalisePnpmVersion(raw);
      }
      return null;
    },
  };
}

/**
 * Turns pnpm's version notation into a plain semver version, or null for links:
 * "18.2.0(react@18.2.0)" (v6+ peer suffix), "1.0.0_react@18.2.0" (v5 peer suffix),
 * "string-width@4.2.3" (v9 alias), "/string-width/4.2.3" (v5 alias), "link:../pkg".
 */
export function normalisePnpmVersion(raw: string): string | null {
  if (/^(?:link|file|workspace):/.test(raw)) return null;
  let version = raw.split('(')[0] ?? raw;
  if (version.startsWith('/')) version = version.split('/').pop() ?? version;
  // A value that does not start with a digit is an alias ("name@1.2.3"). Peer suffixes ("_react@18") come after the
  // version, so the alias split must only apply when the version is not already at the front.
  if (!/^\d/.test(version)) version = version.slice(version.lastIndexOf('@') + 1);
  const leading = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/.exec(version);
  return leading ? semver.valid(leading[0]) : null;
}

/**
 * yarn.lock, classic (v1) and Berry (v2+), with one line scanner. Entries start with an unindented key line
 * listing every spec they satisfy ("a@^1, a@^1.2":), followed by an indented `version` line.
 */
export function parseYarnLock(text: string): LockfileIndex {
  const versions = new Map<string, string>();
  let pendingKeys: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      pendingKeys = line.endsWith(':')
        ? line
            .slice(0, -1)
            .split(/,\s*/)
            .map((key) => key.trim().replace(/^"|"$/g, ''))
            .filter(Boolean)
        : [];
      continue;
    }
    const match = /^ {2}version:? "?([^"\s]+)"?\s*$/.exec(line);
    if (match?.[1] && pendingKeys.length > 0) {
      for (const key of pendingKeys) versions.set(key, match[1]);
      pendingKeys = [];
    }
  }

  return {
    source: 'yarn-lock',
    installedVersion({ name, spec }) {
      // Berry prefixes registry ranges with "npm:" in keys; classic does not.
      const version = versions.get(`${name}@${spec}`) ?? versions.get(`${name}@npm:${spec}`);
      return version ? semver.valid(version) : null;
    },
  };
}
