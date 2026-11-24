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

/** Converts a workspace glob ("packages/*", "apps/**") into a regex over folder paths. */
function globToRegExp(glob: string): RegExp {
  const normalised = glob.replace(/^\.\//, '').replace(/\/+$/, '');
  const source = normalised
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`);
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

  const include = workspaceGlobs.filter((glob) => !glob.startsWith('!')).map(globToRegExp);
  const exclude = workspaceGlobs.filter((glob) => glob.startsWith('!')).map((glob) => globToRegExp(glob.slice(1)));

  const matches = (path: string): boolean => {
    if (path === 'package.json') return true;
    const folder = dirname(path);
    if (include.length > 0) {
      return include.some((re) => re.test(folder)) && !exclude.some((re) => re.test(folder));
    }
    return !folder.includes('/') && !NON_PROJECT_FOLDERS.has(folder.toLowerCase());
  };

  // Root first, then the repository's own packages, then example and test projects that workspaces may include.
  const rank = (path: string): number =>
    path === 'package.json' ? 0 : dirname(path).split('/').some((part) => NON_PROJECT_FOLDERS.has(part.toLowerCase())) ? 2 : 1;
  const ordered = manifests.filter(matches).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { selected: ordered.slice(0, MAX_MANIFESTS), skipped: ordered.slice(MAX_MANIFESTS) };
}
