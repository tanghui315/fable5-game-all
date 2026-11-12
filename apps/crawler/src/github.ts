/** Thin, retrying wrapper around the read-only parts of the GitHub API. */

import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { repoUrl } from './github-url.js';

export type OctokitLike = Octokit;

export interface OwnerProfile {
  login: string;
  name: string | null;
  avatar: string | null;
  htmlUrl: string | null;
  blog: string | null;
  twitter: string | null;
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  fullName: string;
  repoId: number;
  description: string | null;
  homepage: string | null;
  license: string | null;
  topics: string[];
  stars: number;
  defaultBranch: string;
  hasPages: boolean;
  pagesUrl: string | null;
  pagesSourceBranch: string | null;
  pushedAt: string | null;
  createdAt: string | null;
  archived: boolean;
  ownerProfile: OwnerProfile;
}

export interface TreeFile {
  path: string;
  size?: number;
}

const GITHUB_TIMEOUT_MS = 20_000;

export function resolveGithubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    return token === '' ? undefined : token;
  } catch {
    return undefined;
  }
}

export function createOctokit(token = resolveGithubToken()): Octokit {
  return new Octokit({
    ...(token !== undefined ? { auth: token } : {}),
    userAgent: 'fable5-game-all-crawler/0.1',
    request: { timeout: GITHUB_TIMEOUT_MS },
  });
}

interface HttpError {
  status?: number;
  response?: { headers?: Record<string, string | undefined> };
}

function retryDelayMs(error: unknown, attempt: number): number | null {
  const status = (error as HttpError).status;
  if (status !== 403 && status !== 429 && status !== 502 && status !== 503) return null;
  const headers = (error as HttpError).response?.headers ?? {};
  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), 60_000);
  }
  const reset = headers['x-ratelimit-reset'];
  if (reset !== undefined && headers['x-ratelimit-remaining'] === '0') {
    const seconds = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1000), 60_000);
  }
  // Secondary rate limits have no reset header; use exponential backoff.
  return Math.min(2 ** attempt * 1000, 30_000);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry on rate-limit / transient errors, honouring `retry-after`. */
export async function withGithubRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = retryDelayMs(error, attempt);
      if (delay === null || attempt === attempts) throw error;
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function getRepoMetadata(
  octokit: OctokitLike,
  owner: string,
  repo: string,
): Promise<RepoMetadata> {
  const { data } = await withGithubRetry(() => octokit.repos.get({ owner, repo }));
  const ownerData = data.owner as unknown as Record<string, unknown>;
  const license = data.license as { spdx_id?: string | null } | null;
  let pagesUrl: string | null = null;
  let pagesSourceBranch: string | null = null;
  if (data.has_pages) {
    try {
      const pages = await withGithubRetry(() => octokit.repos.getPages({ owner, repo }));
      pagesUrl = pages.data.html_url ?? null;
      pagesSourceBranch = pages.data.source?.branch ?? null;
    } catch {
      // A Pages site that has not been built yet is fine.
    }
  }
  const description = data.description ?? null;
  return {
    owner: data.owner.login,
    repo: data.name,
    fullName: data.full_name,
    repoId: data.id,
    description,
    homepage: data.homepage ?? null,
    license: license?.spdx_id ?? null,
    topics: Array.isArray(data.topics) ? data.topics : [],
    stars: data.stargazers_count ?? 0,
    defaultBranch: data.default_branch,
    hasPages: data.has_pages,
    pagesUrl,
    pagesSourceBranch,
    pushedAt: data.pushed_at ?? null,
    createdAt: data.created_at ?? null,
    archived: data.archived ?? false,
    ownerProfile: {
      login: data.owner.login,
      name: typeof ownerData.name === 'string' ? ownerData.name : null,
      avatar: data.owner.avatar_url ?? null,
      htmlUrl: data.owner.html_url ?? null,
      blog: typeof ownerData.blog === 'string' && ownerData.blog !== '' ? ownerData.blog : null,
      twitter:
        typeof ownerData.twitter_username === 'string' && ownerData.twitter_username !== ''
          ? ownerData.twitter_username
          : null,
    },
  };
}

export async function getReadmeText(
  octokit: OctokitLike,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const { data } = await withGithubRetry(() => octokit.repos.getReadme({ owner, repo }));
    if (!('content' in data) || typeof data.content !== 'string') return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export async function getFileText(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<string | null> {
  try {
    const { data } = await withGithubRetry(() =>
      octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
        ...(ref !== undefined ? { ref } : {}),
      }),
    );
    if (Array.isArray(data) || !('content' in data) || typeof data.content !== 'string')
      return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export async function getTreeFiles(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  ref: string,
): Promise<TreeFile[]> {
  try {
    const { data } = await withGithubRetry(() =>
      octokit.git.getTree({ owner, repo, tree_sha: ref, recursive: '1' }),
    );
    return (data.tree ?? [])
      .filter((item) => item.type === 'blob' && typeof item.path === 'string')
      .map((item) => ({
        path: item.path as string,
        ...(typeof item.size === 'number' ? { size: item.size } : {}),
      }));
  } catch (error) {
    if ((error as HttpError).status === 404) return [];
    throw error;
  }
}

export async function branchExists(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  try {
    await withGithubRetry(() => octokit.repos.getBranch({ owner, repo, branch }));
    return true;
  } catch (error) {
    if ((error as HttpError).status === 404) return false;
    throw error;
  }
}

export interface CodeSearchHit {
  repo: string;
  path: string;
  repoUrl: string;
}

export async function searchCode(octokit: OctokitLike, query: string): Promise<CodeSearchHit[]> {
  const { data } = await withGithubRetry(() => octokit.search.code({ q: query, per_page: 100 }));
  return data.items.map((item) => ({
    repo: item.repository.full_name,
    path: item.path,
    repoUrl: item.repository.html_url ?? repoUrl(item.repository.owner.login, item.repository.name),
  }));
}

export interface RepoSearchHit {
  fullName: string;
  htmlUrl: string;
  homepage: string | null;
  stars: number;
  pushedAt: string | null;
  description: string | null;
  topics: string[];
}

export async function searchRepos(octokit: OctokitLike, query: string): Promise<RepoSearchHit[]> {
  const { data } = await withGithubRetry(() =>
    octokit.search.repos({ q: query, per_page: 100, sort: 'updated' }),
  );
  return data.items.map((item) => ({
    fullName: item.full_name,
    htmlUrl: item.html_url,
    homepage: item.homepage ?? null,
    stars: item.stargazers_count ?? 0,
    pushedAt: item.pushed_at ?? null,
    description: item.description ?? null,
    topics: Array.isArray(item.topics) ? item.topics : [],
  }));
}

export async function getRepoLight(
  octokit: OctokitLike,
  owner: string,
  repo: string,
): Promise<{ exists: boolean; stars: number | null; pushedAt: string | null }> {
  try {
    const { data } = await withGithubRetry(() => octokit.repos.get({ owner, repo }));
    return { exists: true, stars: data.stargazers_count ?? 0, pushedAt: data.pushed_at ?? null };
  } catch (error) {
    if ((error as HttpError).status === 404) return { exists: false, stars: null, pushedAt: null };
    throw error;
  }
}
