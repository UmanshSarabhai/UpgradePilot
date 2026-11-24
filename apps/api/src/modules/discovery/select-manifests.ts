export const MAX_MANIFESTS = 20;

/** Folders that hold sample or test projects rather than the repository's own packages. */
const NON_PROJECT_FOLDERS = new Set([
  'examples',
  'example',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  '__fixtures__',
  'e2e',
  'docs',
]);

export interface ManifestSelection {
  selected: string[];
  /** Manifests that matched the rules but were cut by MAX_MANIFESTS. */
  skipped: string[];
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Workspace globs come from the repository, so they are untrusted: bounded in number and length. */
const MAX_GLOBS = 50;
const MAX_GLOB_LENGTH = 200;

/**
 * Matches one path segment against a pattern with `*` wildcards. Two-pointer matching with no regex,
 * so a hostile pattern such as `**a**a**a**b` cannot trigger catastrophic backtracking.
 */
function matchSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.');
}

/** Matches a folder path against a glob segment by segment. A `**` segment spans any number of segments. */
function matchGlob(glob: string[], path: string[]): boolean {
  const memo = new Map<number, boolean>();
  const match = (i: number, j: number): boolean => {
    const key = i * (path.length + 1) + j;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === glob.length) result = j === path.length;
    else if (glob[i] === '**') result = match(i + 1, j) || (j < path.length && match(i, j + 1));
    else result = j < path.length && matchSegment(glob[i] ?? '', path[j] ?? '') && match(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}

/**
 * Picks the package.json files that describe the repository's own packages:
 * - with workspace globs: the root plus every folder the globs match (negated globs exclude);
 * - without: the root plus manifests one folder deep, ignoring example and test folders.
 * Manifests inside node_modules are never selected. The root always comes first.
 */
export function selectManifests(paths: readonly string[], workspaceGlobs: readonly string[]): ManifestSelection {
  const manifests = paths.filter(
    (path) => (path === 'package.json' || path.endsWith('/package.json')) && !path.split('/').includes('node_modules'),
  );

  const globs = workspaceGlobs.slice(0, MAX_GLOBS).filter((glob) => glob.length <= MAX_GLOB_LENGTH);
  const include = globs.filter((glob) => !glob.startsWith('!')).map(splitPath);
  const exclude = globs.filter((glob) => glob.startsWith('!')).map((glob) => splitPath(glob.slice(1)));

  const matches = (path: string): boolean => {
    if (path === 'package.json') return true;
    const folder = dirname(path);
    if (include.length > 0) {
      const parts = splitPath(folder);
      return include.some((glob) => matchGlob(glob, parts)) && !exclude.some((glob) => matchGlob(glob, parts));
    }
    return !folder.includes('/') && !NON_PROJECT_FOLDERS.has(folder.toLowerCase());
  };

  // Root first, then the repository's own packages, then example and test projects that workspaces may include.
  const rank = (path: string): number =>
    path === 'package.json' ? 0 : dirname(path).split('/').some((part) => NON_PROJECT_FOLDERS.has(part.toLowerCase())) ? 2 : 1;
  const ordered = manifests.filter(matches).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { selected: ordered.slice(0, MAX_MANIFESTS), skipped: ordered.slice(MAX_MANIFESTS) };
}
