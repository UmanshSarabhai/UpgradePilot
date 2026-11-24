import type { DependencyType } from '@upgradepilot/shared';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '../../lib/guards';

export const DEPENDENCY_TYPES: readonly DependencyType[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export interface ManifestEntry {
  name: string;
  /** Raw value from package.json. May be a non-string when the manifest is malformed. */
  spec: unknown;
  type: DependencyType;
}

export interface ParsedManifest {
  packageName: string | null;
  workspaces: string[];
  entries: ManifestEntry[];
}

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Parses package.json. Each section is read loosely so one bad entry does not discard the file. */
export function parseManifest(text: string): ParsedManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ManifestParseError('package.json is not valid JSON');
  }
  if (!isRecord(data)) throw new ManifestParseError('package.json is not a JSON object');

  const entries: ManifestEntry[] = [];
  for (const type of DEPENDENCY_TYPES) {
    const section = data[type];
    if (!isRecord(section)) continue;
    for (const [name, spec] of Object.entries(section)) entries.push({ name, spec, type });
  }

  // "workspaces" is either an array (npm, yarn) or { packages: [...] } (yarn classic).
  const workspaces = Array.isArray(data.workspaces)
    ? stringArray(data.workspaces)
    : isRecord(data.workspaces)
      ? stringArray(data.workspaces.packages)
      : [];

  return { packageName: typeof data.name === 'string' ? data.name : null, workspaces, entries };
}

/** Reads the `packages` globs from pnpm-workspace.yaml. Returns [] when the file is malformed. */
export function parsePnpmWorkspace(text: string): string[] {
  try {
    const data: unknown = parseYaml(text);
    return isRecord(data) ? stringArray(data.packages) : [];
  } catch {
    return [];
  }
}
