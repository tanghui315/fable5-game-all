/** Input URL parsing: repo URLs, GitHub Pages URLs and plain online URLs. */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Repo-relative directory parsed from a `/tree/<branch>/<path>` URL. */
  path?: string;
  branch?: string;
}

export interface ParsedInput {
  kind: 'repo' | 'pages' | 'online';
  original: string;
  repo?: RepoRef;
  /** Directory below the Pages site root, e.g. `demos/04-fps`. */
  pagesPath?: string;
  /** Full playable URL when the input itself is an online entry. */
  onlineUrl?: string;
}

const RESERVED_GITHUB_PATHS = new Set([
  'about',
  'features',
  'topics',
  'explore',
  'marketplace',
  'pricing',
  'login',
  'join',
  'settings',
  'sponsors',
  'orgs',
  'users',
]);

function cleanSegment(value: string): string {
  return value.replace(/\.git$/i, '');
}

function cleanPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/');
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Parse `https://github.com/owner/repo[/tree/branch/path]`.
 * Returns `null` for non-repository GitHub URLs.
 */
export function parseGithubRepoUrl(input: string): RepoRef | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const [owner, repo, keyword, branch, ...rest] = parts;
  if (owner === undefined || repo === undefined) return null;
  if (RESERVED_GITHUB_PATHS.has(owner.toLowerCase())) return null;
  const ref: RepoRef = { owner, repo: cleanSegment(repo) };
  if (keyword === 'tree' && branch !== undefined) {
    ref.branch = decodeURIComponent(branch);
    const path = cleanPath(rest.join('/'));
    if (path !== undefined) ref.path = path;
  }
  return ref;
}

/**
 * Parse `https://owner.github.io/repo/path/` back to a repository.
 * `owner.github.io` user sites (no repo segment) cannot be mapped.
 */
export function parseGithubPagesUrl(
  input: string,
): { owner: string; repo: string; path?: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const match = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname);
  if (match?.[1] === undefined) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const repo = parts[0];
  if (repo === undefined) return null;
  const path = cleanPath(
    parts
      .slice(1)
      .join('/')
      .replace(/(?:^|\/)index\.html$/i, ''),
  );
  return { owner: match[1], repo: cleanSegment(repo), ...(path !== undefined ? { path } : {}) };
}

/**
 * Accept a repo URL, a `<owner>.github.io/<repo>/` URL, or any online URL.
 * `*.github.io/<repo>/` is mapped back to its repository.
 */
export function parseInputUrl(input: string): ParsedInput {
  const trimmed = input.trim();
  const repo = parseGithubRepoUrl(trimmed);
  if (repo !== null) return { kind: 'repo', original: trimmed, repo };

  const pages = parseGithubPagesUrl(trimmed);
  if (pages !== null) {
    return {
      kind: 'pages',
      original: trimmed,
      repo: { owner: pages.owner, repo: pages.repo },
      ...(pages.path !== undefined ? { pagesPath: pages.path } : {}),
    };
  }

  return { kind: 'online', original: trimmed, onlineUrl: trimmed };
}

/** Stable key for a repository, e.g. `wquguru/fable52-fps-repro`. */
export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

export function repoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

/** GitHub Pages base URL for a repository. */
export function pagesBaseUrl(owner: string, repo: string, htmlUrl?: string | null): string {
  if (htmlUrl !== null && htmlUrl !== undefined && htmlUrl.trim() !== '') {
    return htmlUrl.endsWith('/') ? htmlUrl : `${htmlUrl}/`;
  }
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}
