/**
 * Read-only X lookups for review work: find an author's posts about a game and
 * check the model evidence quoted in them. Uses FixTweet's public JSON API
 * (`api.fxtwitter.com`), which needs no key and no login; keep the volume low.
 */

export const X_API_BASE = 'https://api.fxtwitter.com';
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'fable5-game-all-crawler/0.1 (+https://stubhall.com)';

/** Terms worth surfacing in a post: model names and the words around them. */
const EVIDENCE_TERMS = [
  'fable',
  'claude',
  'opus',
  'sonnet',
  'haiku',
  'gpt',
  'codex',
  'gemini',
  'deepseek',
  'shader',
  '模型',
] as const;

export interface XProfile {
  handle: string;
  name: string;
  bio: string;
  website: string | null;
  followers: number | null;
  posts: number | null;
}

export interface XPost {
  id: string;
  url: string;
  author: string;
  text: string;
  createdAt: string | null;
  likes: number | null;
  retweets: number | null;
}

export interface XLookup {
  kind: 'profile' | 'post' | 'search';
  query: string;
  profile: XProfile | null;
  posts: XPost[];
}

export class XApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XApiError';
  }
}

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `https://x.com/<handle>/status/<id>` (also twitter.com and /i/web/status/). */
export function parseStatusInput(input: string): { handle: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const marker = parts.indexOf('status');
  if (marker < 1 || marker + 1 >= parts.length) return null;
  const id = parts[marker + 1] ?? '';
  if (!/^\d+$/.test(id)) return null;
  const handle = parts[marker - 1] ?? '';
  if (handle === '' || handle === 'i') return null;
  return { handle, id };
}

/** `@FiniYang` / `FiniYang` → `FiniYang`, anything else → null. */
export function normalizeHandle(input: string): string | null {
  const value = input.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{2,15}$/.test(value) ? value : null;
}

/** Model / tool terms mentioned by a post, lowercased and de-duplicated. */
export function evidenceKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return EVIDENCE_TERMS.filter((term) => lower.includes(term));
}

export function parseProfile(payload: unknown): XProfile | null {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.user)) return null;
  const user = payload.user;
  const handle = asString(user.screen_name);
  if (handle === null) return null;
  const website = isRecord(user.website) ? asString(user.website.url) : null;
  return {
    handle,
    name: asString(user.name) ?? handle,
    bio: asString(user.description) ?? '',
    website,
    followers: asNumber(user.followers),
    posts: asNumber(user.tweets),
  };
}

export function parsePost(payload: unknown): XPost | null {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.tweet)) return null;
  return toPost(payload.tweet);
}

function toPost(raw: unknown): XPost | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (id === null) return null;
  const author = isRecord(raw.author) ? asString(raw.author.screen_name) : null;
  return {
    id,
    url: asString(raw.url) ?? `https://x.com/i/status/${id}`,
    author: author ?? 'unknown',
    text: asString(raw.text) ?? '',
    createdAt: asString(raw.created_at),
    likes: asNumber(raw.likes),
    retweets: asNumber(raw.retweets),
  };
}

export function parseSearch(payload: unknown): XPost[] {
  if (!isRecord(payload) || payload.code !== 200 || !Array.isArray(payload.results)) return [];
  return payload.results.map((item) => toPost(item)).filter((post): post is XPost => post !== null);
}

async function fetchJson(
  path: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(`${X_API_BASE}${path}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) ? asString(body.message) : null;
    throw new XApiError(message ?? `X lookup failed: HTTP ${response.status} for ${path}`);
  }
  if (isRecord(body) && body.code !== undefined && body.code !== 200) {
    const message = asString(body.message) ?? `X lookup failed: code ${String(body.code)}`;
    throw new XApiError(message);
  }
  return body;
}

export interface XLookupOptions {
  limit?: number;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
}

/**
 * One read-only lookup. Status URLs fetch that post, `@handle` reads the
 * profile, everything else is a post search (supports `from:handle`).
 */
export async function lookupX(input: string, options: XLookupOptions = {}): Promise<XLookup> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const query = input.trim();
  if (query === '') throw new XApiError('empty query');

  const status = parseStatusInput(query);
  if (status !== null) {
    const post = parsePost(await fetchJson(`/${status.handle}/status/${status.id}`, fetchImpl));
    return { kind: 'post', query, profile: null, posts: post === null ? [] : [post] };
  }

  const handle = query.startsWith('@') ? normalizeHandle(query) : null;
  if (handle !== null) {
    const profile = parseProfile(await fetchJson(`/${handle}`, fetchImpl));
    if (profile === null) throw new XApiError(`no X profile found for @${handle}`);
    return { kind: 'profile', query, profile, posts: [] };
  }

  const posts = parseSearch(await fetchJson(`/2/search?q=${encodeURIComponent(query)}`, fetchImpl));
  return { kind: 'search', query, profile: null, posts: posts.slice(0, limit) };
}

/** Human-readable block for one post, used by the CLI. */
export function formatPost(post: XPost): string[] {
  const terms = evidenceKeywords(post.text);
  const when = post.createdAt ?? '';
  const markers = terms.length > 0 ? ` · evidence: ${terms.join(', ')}` : '';
  return [`@${post.author} ${when}${markers}`, post.url, post.text.replace(/\n+/g, '\n')];
}
