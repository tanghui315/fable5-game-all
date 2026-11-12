/** Playable-entry discovery from a repository tree. */

import { pagesBaseUrl } from './github-url.js';
import { normalizeUrl, slugify, withTrailingSlash } from './util.js';

export type EntrySource = 'tree' | 'gh-pages' | 'homepage' | 'online';

export interface PlayableEntry {
  /** Short entry name, e.g. `04-fps`. */
  key: string;
  /** Repo-relative directory; empty string for the repository root. */
  path: string;
  /** Absolute playable URL. */
  playUrl: string;
  source: EntrySource;
  /** Branch the entry came from, when known. */
  branch?: string;
}

export interface EntryDiscoveryInput {
  owner: string;
  repo: string;
  /** Paths from the default branch tree. */
  treePaths: readonly string[];
  /** Paths from the `gh-pages` branch tree, when that branch exists. */
  ghPagesPaths?: readonly string[];
  /** Branch that GitHub Pages serves, when known. */
  pagesSourceBranch?: string | null;
  /** Pages site base URL. */
  pagesBase?: string | null;
  homepageUrl?: string | null;
  /** Raw `index.html` at the repo root, used for hub detection. */
  rootHtml?: string | null;
  maxEntries?: number;
}

const IGNORED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'vendor', '.git']);

/** True for `index.html` files outside dependency/build directories. */
export function isPlayableIndexPath(filePath: string): boolean {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const base = segments[segments.length - 1];
  if (base === undefined || base.toLowerCase() !== 'index.html') return false;
  return !segments.slice(0, -1).some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()));
}

/** Directory of an `index.html` path (`''` for a root index). */
export function entryDirectory(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

/** Last path segment, used as the entry key (`demos/04-fps` -> `04-fps`). */
export function entryKey(dirPath: string, repo: string): string {
  if (dirPath === '') return slugify(repo, 'root');
  const parts = dirPath.split('/').filter(Boolean);
  return slugify(parts[parts.length - 1] ?? repo, 'entry');
}

/** Absolute URL of a directory below the Pages root. */
export function entryUrl(base: string, dirPath: string): string {
  const normalised = withTrailingSlash(base);
  if (dirPath === '') return normalised;
  return new URL(`${dirPath.replace(/^\/+|\/+$/g, '')}/`, normalised).toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A root `index.html` that merely links to at least two sub-entries is a hub,
 * not a playable entry itself.
 */
export function isHubIndex(html: string, subEntryDirs: readonly string[]): boolean {
  let links = 0;
  for (const dir of subEntryDirs) {
    const pattern = new RegExp(
      `(?:href|src)\\s*=\\s*["'][^"']*${escapeRegExp(dir)}(?:/|["'#?])`,
      'i',
    );
    if (pattern.test(html)) links += 1;
  }
  return links >= 2;
}

function uniqueKey(baseKey: string, dirPath: string, used: Set<string>): string {
  let key = baseKey;
  if (used.has(key)) key = slugify(dirPath.replace(/\//g, '-'), baseKey);
  let suffix = 2;
  const first = key;
  while (used.has(key)) {
    key = `${first}-${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function indexEntries(
  paths: readonly string[],
  base: string,
  source: EntrySource,
  repo: string,
  branch: string | undefined,
  used: Set<string>,
  skipRoot: boolean,
): PlayableEntry[] {
  const indexes = paths
    .filter(isPlayableIndexPath)
    .map((path) => entryDirectory(path))
    .filter((dir) => (skipRoot ? dir !== '' : true));
  const entries: PlayableEntry[] = [];
  for (const dir of indexes) {
    const key = uniqueKey(entryKey(dir, repo), dir, used);
    entries.push({
      key,
      path: dir,
      playUrl: entryUrl(base, dir),
      source,
      ...(branch !== undefined ? { branch } : {}),
    });
  }
  return entries;
}

function homepageEntry(homepageUrl: string, repo: string, used: Set<string>): PlayableEntry | null {
  let url: URL;
  try {
    url = new URL(homepageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  const dir = path.replace(/(?:^|\/)index\.html$/i, '').replace(/\/+$/, '');
  const key = uniqueKey(slugify(dir.split('/').filter(Boolean).pop() ?? repo, repo), dir, used);
  return {
    key,
    path: dir,
    playUrl: withTrailingSlash(homepageUrl),
    source: 'homepage',
  };
}

/**
 * Find playable entries:
 *   - `homepageUrl` when configured,
 *   - the `gh-pages` branch root / sub-entries,
 *   - every non-vendored `index.html` on the default branch,
 * mapping all of them to GitHub Pages URLs.
 *
 * The repo-root `index.html` is dropped when it only links to sub-entries.
 */
export function discoverEntries(input: EntryDiscoveryInput): PlayableEntry[] {
  const {
    owner,
    repo,
    treePaths,
    ghPagesPaths = [],
    pagesSourceBranch = null,
    homepageUrl = null,
    rootHtml = null,
    maxEntries = 20,
  } = input;
  const base = input.pagesBase ?? pagesBaseUrl(owner, repo);
  const used = new Set<string>();
  const entries: PlayableEntry[] = [];

  const mainIndexes = treePaths.filter(isPlayableIndexPath);
  const rootSubDirs = mainIndexes.map((path) => entryDirectory(path)).filter((dir) => dir !== '');
  const rootIsHub =
    rootHtml !== null && rootSubDirs.length > 0 && isHubIndex(rootHtml, rootSubDirs);

  const pagesServesGhPages = pagesSourceBranch === 'gh-pages' && ghPagesPaths.length > 0;
  if (!pagesServesGhPages) {
    entries.push(...indexEntries(treePaths, base, 'tree', repo, undefined, used, rootIsHub));
  }
  if (ghPagesPaths.length > 0) {
    entries.push(...indexEntries(ghPagesPaths, base, 'gh-pages', repo, 'gh-pages', used, false));
  }

  if (homepageUrl !== null && homepageUrl.trim() !== '') {
    const normalizedHome = normalizeUrl(homepageUrl);
    const normalizedBase = normalizeUrl(base);
    const isRootHubHome = rootIsHub && normalizedHome === normalizedBase;
    if (!isRootHubHome) {
      const existing = entries.find((entry) => normalizeUrl(entry.playUrl) === normalizedHome);
      if (existing !== undefined) {
        existing.source = 'homepage';
      } else {
        const entry = homepageEntry(homepageUrl, repo, used);
        if (entry !== null) entries.push(entry);
      }
    }
  }

  // Keep a stable order: sub-entries first, root last, then extras.
  entries.sort((a, b) => {
    if (a.path === b.path) return a.playUrl.localeCompare(b.playUrl);
    if (a.path === '') return 1;
    if (b.path === '') return -1;
    return a.path.localeCompare(b.path);
  });

  const deduped: PlayableEntry[] = [];
  const seenUrls = new Set<string>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.playUrl);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    deduped.push(entry);
  }
  return deduped.slice(0, maxEntries);
}
