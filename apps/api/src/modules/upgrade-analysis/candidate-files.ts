import { dirname } from '../discovery/select-manifests';

const MAX_CANDIDATES = 20;
/** Packages whose config file is not named after them. */
const CONFIG_ALIASES: Record<string, string[]> = {
  typescript: ['tsconfig'],
  '@babel/core': ['babel'],
  '@types/node': ['tsconfig'],
};

/**
 * Repository files an upgrade might touch, by name only: the manifests that declare the package, plus config files
 * in the same folders whose name contains the package's name (eslint → eslint.config.js, .eslintrc.json).
 * This is a candidate list for the AI to choose from, not proof the file uses the package.
 */
export function candidateFilesFor(packageName: string, manifestPaths: string[], configFiles: string[]): string[] {
  const unscoped = packageName.startsWith('@') ? (packageName.split('/')[1] ?? '') : packageName;
  const scope = packageName.startsWith('@') ? (packageName.split('/')[0]?.slice(1) ?? '') : '';
  const tokens = [unscoped.split('-')[0] ?? '', scope.split('-')[0] ?? '', ...(CONFIG_ALIASES[packageName] ?? [])]
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3);
  const folders = new Set(manifestPaths.map(dirname));

  const matches = configFiles.filter((path) => {
    if (!folders.has(dirname(path))) return false;
    const base = (path.split('/').pop() ?? '').toLowerCase();
    return tokens.some((token) => base.includes(token));
  });
  return [...new Set([...manifestPaths, ...matches])].slice(0, MAX_CANDIDATES);
}
