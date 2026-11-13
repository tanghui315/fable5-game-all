/** `crawler discover`: GitHub code/repo search + Hacker News, ranked and deduped. */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { listYamlFiles, loadGameFile, loadRejectedFile } from '@fable5/schema';
import { readQueries, type QueryConfig } from './config.js';
import { enrich } from './enrich.js';
import {
  createOctokit,
  getRepoMetadata,
  getTreeFiles,
  searchCode,
  searchRepos,
  type OctokitLike,
} from './github.js';
import { parseGithubPagesUrl, parseGithubRepoUrl, repoKey, repoUrl } from './github-url.js';
import { findRepoRoot } from './enrich.js';
import { loadSeen, markSeen, needsReevaluation, saveSeen } from './seen.js';
import { normalizeUrl } from './util.js';

export interface CandidateSignals {
  sources: string[];
  modelIdHit: boolean;
  repoSearchHit: boolean;
  hnHit: boolean;
  codeHit: boolean;
  homepage: string | null;
  hasPagesUrl: boolean;
  hasIndexHtml: boolean;
  stars: number;
  /** Repository text looks like a playable web game. */
  gameHint?: boolean;
  /** Repository text looks like an agent/library/tooling repo. */
  toolHint?: boolean;
  /** Repository text looks like a curated list/aggregator rather than one game. */
  listHint?: boolean;
}

export interface CandidateScore {
  score: number;
  reasons: string[];
}

/** Rank by evidence of a Fable-generated, playable web game. */
export function scoreCandidate(signals: CandidateSignals): CandidateScore {
  let score = 0;
  const reasons: string[] = [];
  if (signals.codeHit) {
    score += 20;
    reasons.push('code-search hit');
  }
  if (signals.modelIdHit) {
    score += 30;
    reasons.push('model id in repository');
  }
  if (signals.repoSearchHit) {
    score += 10;
    reasons.push('repo-search hit');
  }
  if (signals.hnHit) {
    score += 20;
    reasons.push('Hacker News mention');
  }
  if (signals.hasPagesUrl) {
    score += 15;
    reasons.push('Pages URL');
  } else if (signals.homepage !== null) {
    score += 8;
    reasons.push('homepage URL');
  }
  if (signals.hasIndexHtml) {
    score += 10;
    reasons.push('index.html');
  }
  if (signals.gameHint === true && signals.listHint !== true) {
    score += 20;
    reasons.push('game/webgl hint');
  }
  if (signals.listHint === true) {
    // Curated lists/awesome-lists aggregate many projects; they are not a game
    // themselves, even when their name or description mentions "game".
    score -= 35;
    reasons.push('aggregator/list repo');
  }
  if (signals.toolHint === true) {
    score -= 45;
    reasons.push('tool/library repo');
  }
  // Star counts are evidence that a *game* is popular; popular tooling or
  // aggregator repos would otherwise drown out the actual games.
  if (signals.toolHint !== true && signals.listHint !== true) {
    const starBonus = Math.min(Math.max(signals.stars, 0), 100) / 5;
    if (starBonus > 0) {
      score += starBonus;
      reasons.push(`${signals.stars} stars`);
    }
  }
  return { score: Math.round(score * 10) / 10, reasons };
}

export interface Candidate {
  repo: string;
  url: string;
  homepage: string | null;
  stars: number;
  pushedAt: string | null;
  description: string | null;
  signals: CandidateSignals;
  score: number;
  reasons: string[];
}

/** Shorter descriptions are too generic to prove two repos are the same game. */
const CLONE_DESCRIPTION_MIN_LENGTH = 24;

/** Lowercase, strip punctuation/symbols and collapse whitespace. */
function normalizeCloneText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Repo name (after `owner/`) + description, or null when too generic. */
function cloneGroupKey(candidate: Candidate): string | null {
  const slash = candidate.repo.indexOf('/');
  const name = slash === -1 ? candidate.repo : candidate.repo.slice(slash + 1);
  const description = normalizeCloneText(candidate.description ?? '');
  if (description.length < CLONE_DESCRIPTION_MIN_LENGTH) return null;
  return `${normalizeCloneText(name)}\u0000${description}`;
}

/** Best clone first: score, stars, earliest push (the original), repo name. */
function compareCloneKeep(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.stars !== a.stars) return b.stars - a.stars;
  if (a.pushedAt !== b.pushedAt) {
    if (a.pushedAt === null) return 1;
    if (b.pushedAt === null) return -1;
    return a.pushedAt < b.pushedAt ? -1 : 1;
  }
  return a.repo.localeCompare(b.repo);
}

/**
 * Collapse the same game pushed to several repos into one candidate.
 *
 * Repos are grouped by normalized name + normalized description. Only
 * descriptions of at least 24 characters participate, so generic text cannot
 * merge unrelated projects. The best candidate is kept (see
 * {@link compareCloneKeep}); its reasons gain `N clone(s) merged`, and the
 * dropped candidates are annotated in place with `duplicate of <repo>` before
 * being filtered out of the result.
 */
export function dedupeClones(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = cloneGroupKey(candidate);
    if (key === null) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }

  const dropped = new Set<Candidate>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [best, ...clones] = [...group].sort(compareCloneKeep);
    if (best === undefined) continue;
    for (const clone of clones) {
      dropped.add(clone);
      const reason = `duplicate of ${best.repo}`;
      if (!clone.reasons.includes(reason)) clone.reasons.push(reason);
    }
    const merged = `${clones.length} clone(s) merged`;
    if (!best.reasons.includes(merged)) best.reasons.push(merged);
  }
  return candidates.filter((candidate) => !dropped.has(candidate));
}

export interface DiscoverOptions {
  rootDir: string;
  limit?: number;
  dryRun?: boolean;
  pr?: boolean;
  useAi?: boolean;
  client?: OctokitLike;
  queries?: QueryConfig;
  fetchImpl?: typeof globalThis.fetch;
  logger?: (message: string) => void;
  /** Injectable sleep for tests/rate limiting. */
  sleep?: (ms: number) => Promise<void>;
}

export interface DiscoverResult {
  candidates: Candidate[];
  processed: Array<{ repo: string; pr: number | null; error: string | null }>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface MutableCandidate {
  repo: string;
  url: string;
  homepage: string | null;
  stars: number;
  pushedAt: string | null;
  description: string | null;
  sources: Set<string>;
  modelIdHit: boolean;
  codeHit: boolean;
  repoSearchHit: boolean;
  hnHit: boolean;
  hasIndexHtml: boolean;
}

function canonicalRepo(fullName: string): string | null {
  const parsed = parseGithubRepoUrl(`https://github.com/${fullName}`);
  if (parsed === null) return null;
  return repoKey(parsed.owner, parsed.repo);
}

function urlToRepo(url: string): string | null {
  const repo = parseGithubRepoUrl(url);
  if (repo !== null) return repoKey(repo.owner, repo.repo);
  const pages = parseGithubPagesUrl(url);
  if (pages !== null) return repoKey(pages.owner, pages.repo);
  return null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Pull repository URLs out of Algolia search hits. */
export function extractHnLinks(hits: readonly Record<string, unknown>[]): string[] {
  const urls: string[] = [];
  for (const hit of hits) {
    for (const key of ['url', 'story_url']) {
      const value = hit[key];
      if (typeof value === 'string' && value !== '') urls.push(value);
    }
    for (const key of ['comment_text', 'story_text', 'title']) {
      const value = hit[key];
      if (typeof value !== 'string') continue;
      // href/src attributes contain URLs that stripping tags would remove.
      for (const match of value.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
        if (match[0] !== undefined) urls.push(match[0]);
      }
      for (const match of stripHtml(value).matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
        if (match[0] !== undefined) urls.push(match[0]);
      }
    }
  }
  return urls;
}

async function fetchHnCandidates(
  query: string,
  fetchImpl: typeof globalThis.fetch,
  logger: (message: string) => void,
): Promise<Set<string>> {
  const repos = new Set<string>();
  for (const tag of ['story', 'comment']) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${tag}&hitsPerPage=50`;
    try {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': 'fable5-game-all-crawler/0.1' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        logger(`discover: HN ${tag} query failed (HTTP ${response.status})`);
        continue;
      }
      const payload = (await response.json()) as { hits?: Array<Record<string, unknown>> };
      for (const link of extractHnLinks(payload.hits ?? [])) {
        const repo = urlToRepo(link);
        if (repo !== null) repos.add(repo);
      }
    } catch (error) {
      logger(
        `discover: HN ${tag} query failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return repos;
}

function existingIndex(rootDir: string): { repos: Set<string>; playUrls: Set<string> } {
  const repos = new Set<string>();
  const playUrls = new Set<string>();
  for (const file of listYamlFiles(path.join(rootDir, 'data', 'games'))) {
    try {
      const game = loadGameFile(file);
      playUrls.add(normalizeUrl(game.play.url));
      if (game.repo !== undefined) repos.add(normalizeUrl(game.repo.url));
    } catch {
      // Ignore invalid data; validate reports it separately.
    }
  }
  return { repos, playUrls };
}

function rejectedRepos(rootDir: string): Set<string> {
  const file = path.join(rootDir, 'data', 'rejected.yaml');
  if (!existsSync(file)) return new Set();
  return new Set(loadRejectedFile(file).map((item) => normalizeUrl(item.repo)));
}

/**
 * Detect curated lists / aggregators (awesome-lists, indexes, collections).
 * These are not a single game, even when their text also mentions "game".
 */
function looksLikeList(repo: string, description: string | null): boolean {
  const slash = repo.lastIndexOf('/');
  const name = (slash === -1 ? repo : repo.slice(slash + 1)).toLowerCase();
  // Repo names use separators like `awesome-fable5.2-game`; split them into
  // words so the English markers respect word boundaries (`playlist` != `list`).
  const nameWords = name.replace(/[^a-z0-9]+/g, ' ');
  if (
    /\b(?:awesome|collection|collections|curated|index|directory|list|catalog|hub)\b/.test(
      nameWords,
    )
  ) {
    return true;
  }
  if (/合集|大全|索引|汇总/.test(name)) return true;
  if (description === null) return false;
  const text = description.toLowerCase();
  if (/\b(?:awesome|curated)\b/.test(text)) return true;
  if (/\b(?:collection|list|index|catalog|directory)\s+of\b/.test(text)) return true;
  if (/合集|大全|汇总|索引|收录/.test(description)) return true;
  // Aggregate claims such as "3031 source-verified games from 2724 repos".
  if (/\b\d[\d,]*\b[^.]{0,60}?\bgames?\b[^.]{0,20}?\bfrom\b[^.]{0,20}?\b\d[\d,]*\b/i.test(text)) {
    return true;
  }
  return false;
}

function toCandidate(item: MutableCandidate): Candidate {
  const text = `${item.repo} ${item.description ?? ''}`;
  const rawGameHint =
    /\b(game|games|webgl|three(?:js)?|fps|shader|canvas|platformer|puzzle|arcade|playable|demo)\b/i.test(
      text,
    );
  const listHint = looksLikeList(item.repo, item.description);
  // An awesome-list about games is still a list: it gets the list penalty,
  // not game-hint credit (and `scoreCandidate` also enforces this).
  const gameHint = rawGameHint && !listHint;
  const toolHint =
    (/\b(agents?|assistants?|tools?|toolkit|editors?|coding|sdk|library|framework|documentation|docs|cli|compiler|proxy|api|gateway|tokens?|infrastructure|databases?|harness(?:es)?|terminals?|\bide\b|prompts?|leaks?|engineering|chatbots?)\b/i.test(
      text,
    ) ||
      /notebook|robotics|research|skills|\btil\b|yolo|segmentation|classification|detection|tracking|benchmark|dataset|awesome/i.test(
        text,
      ) ||
      // Chinese-language tooling repos (API gateways, cracked clients, account
      // pools) share no English markers; these words are specific enough to
      // stay clear of game descriptions.
      /逆向|网关|中转|号池|破解|抓包|注册机|协议兼容|上游服务|接口兼容/.test(text)) &&
    !rawGameHint &&
    !listHint;
  const signals: CandidateSignals = {
    sources: [...item.sources].sort(),
    modelIdHit: item.modelIdHit,
    repoSearchHit: item.repoSearchHit,
    hnHit: item.hnHit,
    codeHit: item.codeHit,
    homepage: item.homepage,
    hasPagesUrl: item.homepage !== null && /\.github\.io\//i.test(item.homepage),
    hasIndexHtml: item.hasIndexHtml,
    stars: item.stars,
    gameHint,
    toolHint,
    listHint,
  };
  const { score, reasons } = scoreCandidate(signals);
  return {
    repo: item.repo,
    url: item.url,
    homepage: item.homepage,
    stars: item.stars,
    pushedAt: item.pushedAt,
    description: item.description,
    signals,
    score,
    reasons,
  };
}

/** Collect, score and dedupe candidates. Pure except for injected network calls. */
export async function collectCandidates(options: DiscoverOptions): Promise<Candidate[]> {
  const log = options.logger ?? ((message: string) => console.log(message));
  const queries = options.queries ?? readQueries();
  const octokit = options.client ?? createOctokit();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const rootDir = findRepoRoot(options.rootDir);
  const map = new Map<string, MutableCandidate>();

  const ensure = (repo: string): MutableCandidate => {
    const key = repo.toLowerCase();
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const created: MutableCandidate = {
      repo: key,
      url: repoUrl(...(key.split('/') as [string, string])),
      homepage: null,
      stars: 0,
      pushedAt: null,
      description: null,
      sources: new Set<string>(),
      modelIdHit: false,
      codeHit: false,
      repoSearchHit: false,
      hnHit: false,
      hasIndexHtml: false,
    };
    map.set(key, created);
    return created;
  };

  for (const term of queries.code_search) {
    try {
      const hits = await searchCode(octokit, term);
      log(`discover: code search "${term}" -> ${hits.length} hit(s)`);
      for (const hit of hits) {
        const repo = canonicalRepo(hit.repo);
        if (repo === null) continue;
        const candidate = ensure(repo);
        candidate.codeHit = true;
        candidate.sources.add('github-code');
        if (/fable-?5|claude-fable/i.test(term) || /claude-fable-5-\d|fable-5-\d/i.test(hit.path)) {
          candidate.modelIdHit = true;
        }
        if (/index\.html$/i.test(hit.path)) candidate.hasIndexHtml = true;
      }
    } catch (error) {
      log(
        `discover: code search "${term}" failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  for (const query of queries.repo_search) {
    try {
      const hits = await searchRepos(octokit, query);
      log(`discover: repo search "${query}" -> ${hits.length} hit(s)`);
      for (const hit of hits) {
        const repo = canonicalRepo(hit.fullName);
        if (repo === null) continue;
        const candidate = ensure(repo);
        candidate.repoSearchHit = true;
        candidate.sources.add('github-repo');
        candidate.homepage = candidate.homepage ?? hit.homepage;
        candidate.stars = Math.max(candidate.stars, hit.stars);
        candidate.pushedAt = candidate.pushedAt ?? hit.pushedAt;
        candidate.description = candidate.description ?? hit.description;
        if (/fable/i.test(`${hit.fullName} ${hit.description ?? ''} ${hit.topics.join(' ')}`)) {
          candidate.modelIdHit = true;
        }
      }
    } catch (error) {
      log(
        `discover: repo search "${query}" failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  for (const query of queries.hn) {
    const repos = await fetchHnCandidates(query, fetchImpl, log);
    log(`discover: HN "${query}" -> ${repos.size} repo link(s)`);
    for (const repo of repos) {
      const candidate = ensure(repo);
      candidate.hnHit = true;
      candidate.sources.add('hn');
    }
  }

  // Drop repositories already in the curated data, rejected list, or seen at
  // the same revision. Hydrate code-search-only candidates so the dedupe uses
  // a real `pushed_at`.
  const existing = existingIndex(rootDir);
  const rejected = rejectedRepos(rootDir);
  const seen = loadSeen(rootDir);

  const all = [...map.values()];
  const hydrate = all
    .filter((candidate) => candidate.pushedAt === null || candidate.homepage === null)
    .sort(
      (a, b) =>
        Number(b.codeHit) + Number(b.modelIdHit) - (Number(a.codeHit) + Number(a.modelIdHit)),
    )
    .slice(0, 30);

  for (const candidate of hydrate) {
    try {
      const [owner, repo] = candidate.repo.split('/');
      if (owner === undefined || repo === undefined) continue;
      const metadata = await getRepoMetadata(octokit, owner, repo);
      candidate.homepage = candidate.homepage ?? metadata.homepage;
      candidate.stars = Math.max(candidate.stars, metadata.stars);
      candidate.pushedAt = candidate.pushedAt ?? metadata.pushedAt;
      candidate.description = candidate.description ?? metadata.description;
      const files = await getTreeFiles(octokit, owner, repo, metadata.defaultBranch);
      if (files.some((entry) => /(^|\/)index\.html$/i.test(entry.path))) {
        candidate.hasIndexHtml = true;
      }
    } catch (error) {
      log(
        `discover: hydration failed for ${candidate.repo} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  const kept: Candidate[] = [];
  for (const item of all) {
    if (existing.repos.has(normalizeUrl(item.url))) continue;
    if (rejected.has(normalizeUrl(item.url))) continue;
    if (!needsReevaluation(seen[item.repo], item.pushedAt)) continue;
    kept.push(toCandidate(item));
  }
  const deduped = dedupeClones(kept);
  deduped.sort((a, b) => b.score - a.score || b.stars - a.stars || a.repo.localeCompare(b.repo));
  return deduped;
}

function printCandidates(
  candidates: readonly Candidate[],
  limit: number,
  log: (message: string) => void,
): void {
  const shown = candidates.slice(0, limit);
  log(`discover: ${candidates.length} candidate(s), showing ${shown.length}`);
  for (const [index, candidate] of shown.entries()) {
    log(
      `${String(index + 1).padStart(2, ' ')}. ${candidate.repo}  score=${candidate.score}` +
        `  stars=${candidate.stars}  page=${candidate.homepage ?? '—'}\n` +
        `    ${candidate.reasons.join(', ')}${candidate.description !== null ? `\n    ${candidate.description.slice(0, 160)}` : ''}`,
    );
  }
}

export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const log = options.logger ?? ((message: string) => console.log(message));
  const limit = options.limit ?? 10;
  const rootDir = findRepoRoot(options.rootDir);
  const candidates = await collectCandidates({ ...options, rootDir, logger: log });
  printCandidates(candidates, limit, log);
  if (options.dryRun === true) return { candidates, processed: [] };

  const selected = candidates.slice(0, limit);
  const processed: DiscoverResult['processed'] = [];
  const seen = loadSeen(rootDir);
  const sleep = options.sleep ?? defaultSleep;

  for (const candidate of selected) {
    log(`discover: enriching ${candidate.repo}`);
    try {
      const result = await enrich({
        url: candidate.url,
        rootDir,
        pr: options.pr !== false,
        useAi: options.useAi !== false,
        discoveredBy: candidate.signals.hnHit ? 'hn' : 'github-search',
        ...(options.client !== undefined ? { client: options.client } : {}),
        logger: log,
      });
      processed.push({ repo: candidate.repo, pr: result.pr?.number ?? null, error: null });
      if (result.repo !== null) {
        markSeen(seen, result.repo, {
          pushed_at: candidate.pushedAt,
          last_pr: result.pr?.number ?? null,
        });
      }
      saveSeen(rootDir, seen);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`discover: enrich failed for ${candidate.repo}: ${message}`);
      processed.push({ repo: candidate.repo, pr: null, error: message });
    }
    // Code search is limited to ~10 requests/minute; keep enrich bursts spaced.
    await sleep(1_000);
  }
  return { candidates, processed };
}

export { readQueries };
