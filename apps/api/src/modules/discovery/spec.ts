import type { SpecKind } from '@upgradepilot/shared';
import semver from 'semver';

export interface ClassifiedSpec {
  kind: SpecKind;
  /** npm package to look up, or null when the spec does not point at the registry. */
  registryName: string | null;
  /** Semver range for `range` and `alias` kinds, dist-tag for `tag`, else null. */
  range: string | null;
}

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const DIST_TAG = /^[a-z][a-z0-9._-]*$/i;
const GIT_PREFIX = /^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:)/i;
// "user/repo" or "user/repo#ref" is GitHub shorthand. Semver ranges never contain "/".
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+(?:#.*)?$/;

/** Classifies a dependency spec from package.json without guessing. Unknown shapes are `invalid`. */
export function classifySpec(name: string, spec: unknown): ClassifiedSpec {
  if (typeof spec !== 'string') return { kind: 'invalid', registryName: null, range: null };
  const value = spec.trim();

  if (value.startsWith('workspace:')) return { kind: 'workspace', registryName: null, range: null };
  if (value.startsWith('catalog:')) return { kind: 'catalog', registryName: name, range: null };
  if (/^(?:file|link|portal|patch):/.test(value)) return { kind: 'local', registryName: null, range: null };
  if (GIT_PREFIX.test(value) || GITHUB_SHORTHAND.test(value)) return { kind: 'git', registryName: null, range: null };
  if (/^https?:\/\//i.test(value)) return { kind: 'url', registryName: null, range: null };

  if (value.startsWith('npm:')) {
    const target = value.slice(4);
    const at = target.lastIndexOf('@');
    const aliasName = at > 0 ? target.slice(0, at) : target;
    const aliasRange = at > 0 ? target.slice(at + 1) : 'latest';
    if (!NPM_NAME.test(aliasName)) return { kind: 'invalid', registryName: null, range: null };
    if (semver.validRange(aliasRange) !== null || DIST_TAG.test(aliasRange)) {
      return { kind: 'alias', registryName: aliasName, range: aliasRange };
    }
    return { kind: 'invalid', registryName: null, range: null };
  }

  // "" and "*" are valid ranges meaning "any version".
  if (semver.validRange(value) !== null) return { kind: 'range', registryName: name, range: value };
  if (DIST_TAG.test(value)) return { kind: 'tag', registryName: name, range: value };
  return { kind: 'invalid', registryName: null, range: null };
}
