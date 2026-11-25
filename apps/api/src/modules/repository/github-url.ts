import { AppError } from '../../lib/errors';

export interface RepositoryRef {
  owner: string;
  name: string;
}

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);
// GitHub usernames: alphanumeric or single hyphens, max 39 chars, no leading hyphen.
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
// Git check-ref-format rules: no control characters, space, ~ ^ : ? * [ \, no "..", "@{" or "//", no leading "-" or "/",
// no segment starting with ".", no trailing "/", "." or ".lock", and not "@" alone. The branch is URL-encoded before use.
const BRANCH_PATTERN =
  /^(?![-/])(?!@$)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)(?!(?:.*\/)?\.)(?!.*[/.]$)(?!.*\.lock(?:\/|$))[^\x00-\x20\x7f~^:?*[\\]{1,255}$/;

function invalid(message: string): AppError {
  return new AppError('INVALID_REPOSITORY_URL', message, 400);
}

/**
 * Parses a public GitHub repository URL such as `https://github.com/vercel/next.js`.
 * Accepts a missing scheme, `www.`, a `.git` suffix, a trailing slash and extra path segments
 * like `/tree/main`. Rejects every other host, scheme, credentials and ports.
 */
export function parseGitHubRepoUrl(input: string): RepositoryRef {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid('Not a valid URL.');
  }

  if (url.protocol !== 'https:') throw invalid('Only https:// GitHub URLs are supported.');
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw invalid('Only github.com repositories are supported.');
  if (url.username || url.password || url.port) throw invalid('URL must not contain credentials or a port.');

  const [owner, rawName] = url.pathname.split('/').filter(Boolean);
  if (!owner || !rawName) throw invalid('URL must include the repository owner and name.');

  const name = rawName.replace(/\.git$/i, '');
  if (!OWNER_PATTERN.test(owner)) throw invalid('Repository owner is not a valid GitHub name.');
  if (!REPO_PATTERN.test(name) || name === '.' || name === '..') {
    throw invalid('Repository name is not a valid GitHub name.');
  }

  return { owner, name };
}

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch);
}
