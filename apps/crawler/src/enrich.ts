/** `crawler enrich`: dedupe → metadata → entries → probe → review → drafts → PR. */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import {
  listYamlFiles,
  loadGameFile,
  loadRejectedFile,
  type DiscoveredBy,
  type Game,
} from '@fable5/schema';
import { reviewEntry, type AiContext } from './ai.js';
import { readConfig, type CrawlerConfig } from './config.js';
import { buildGameDraft, type GameDraft } from './draft.js';
import {
  branchExists,
  createOctokit,
  getFileText,
  getReadmeText,
  getRepoMetadata,
  getTreeFiles,
  type OctokitLike,
  type RepoMetadata,
} from './github.js';
import {
  pagesBaseUrl,
  parseGithubPagesUrl,
  parseInputUrl,
  repoKey,
  repoUrl,
} from './github-url.js';
import { detectModelName } from './heuristics.js';
import { discoverEntries, type PlayableEntry } from './entries.js';
import { closeBrowser, probeEntry, type ProbeResult } from './probe.js';
import { candidateBranchName, createCandidatePr, type DraftFile } from './pr.js';
import { buildReviewMarkdown, type ReviewEntry } from './review.js';
import { loadSeen, needsReevaluation } from './seen.js';
import { dedupeStrings, idSegment, normalizeUrl, slugify } from './util.js';

const GAME_SCHEMA_HEADER =
  '# yaml-language-server: $schema=../../packages/schema/json/game.schema.json\n';
const AUTHOR_SCHEMA_HEADER =
  '# yaml-language-server: $schema=../../packages/schema/json/author.schema.json\n';

export interface EnrichOptions {
  url: string;
  /** Repository root (contains data/). Defaults to the discovered workspace root. */
  rootDir: string;
  outDir?: string | undefined;
  pr?: boolean;
  useAi?: boolean;
  force?: boolean;
  issueNumber?: number | null;
  discoveredBy?: DiscoveredBy;
  /** Evidence text supplied by a submission issue. */
  submissionEvidence?: string | null;
  /** Injectable for tests. */
  client?: OctokitLike;
  config?: CrawlerConfig;
  apiKey?: string | undefined;
  logger?: (message: string) => void;
}

export interface EnrichResult {
  repo: string | null;
  skipped: string | null;
  entries: ReviewEntry[];
  drafts: GameDraft[];
  outDir: string | null;
  reviewMarkdown: string;
  pr: { number: number; url: string; branch: string; created: boolean } | null;
}

interface ExistingGameIndex {
  games: Game[];
  repoPaths: Set<string>;
  playUrls: Set<string>;
  slugs: Set<string>;
}

function defaultRootDir(): string {
  // src/ or dist/ -> apps/crawler -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function loadExisting(rootDir: string): ExistingGameIndex {
  const games: Game[] = [];
  const repoPaths = new Set<string>();
  const playUrls = new Set<string>();
  const slugs = new Set<string>();
  for (const file of listYamlFiles(path.join(rootDir, 'data', 'games'))) {
    try {
      const game = loadGameFile(file);
      games.push(game);
      slugs.add(game.slug);
      playUrls.add(normalizeUrl(game.play.url));
      if (game.repo !== undefined) {
        repoPaths.add(`${normalizeUrl(game.repo.url)}#${game.repo.path ?? ''}`);
      }
    } catch {
      // Invalid existing data is reported by `pnpm validate`; the crawler skips it.
    }
  }
  return { games, repoPaths, playUrls, slugs };
}

function existingRejection(rootDir: string, repoUrlValue: string | null): string | null {
  if (repoUrlValue === null) return null;
  const rejected = loadRejectedFile(path.join(rootDir, 'data', 'rejected.yaml'));
  const key = normalizeUrl(repoUrlValue);
  const hit = rejected.find((item) => normalizeUrl(item.repo) === key);
  return hit === undefined ? null : `repository is rejected (${hit.reason})`;
}

function identityForOnline(url: string): { owner: string; repo: string } {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? 'online';
    const owner = idSegment(parsed.hostname.split('.').slice(-2).join('-'), 'online');
    return { owner, repo: slugify(last, 'online') };
  } catch {
    return { owner: 'online', repo: 'online' };
  }
}

function promptCandidates(treePaths: readonly string[], entryKey: string): string[] {
  return treePaths.filter(
    (file) =>
      /(^|\/)prompts?\//i.test(file) ||
      /prompt/i.test(file) ||
      (file.toLowerCase().endsWith('.md') && file.toLowerCase().includes(entryKey.toLowerCase())),
  );
}

function writeDraftFiles(
  outDir: string,
  drafts: readonly GameDraft[],
  existingAuthorIds: ReadonlySet<string>,
): DraftFile[] {
  const files: DraftFile[] = [];
  const seenAuthors = new Set<string>();
  for (const draft of drafts) {
    const gamePath = path.join(outDir, 'data', 'games', `${draft.id}.yaml`);
    mkdirSync(path.dirname(gamePath), { recursive: true });
    writeFileSync(gamePath, `${GAME_SCHEMA_HEADER}${stringifyYaml(draft.game, { lineWidth: 0 })}`);
    files.push({
      path: `data/games/${draft.id}.yaml`,
      content: `${GAME_SCHEMA_HEADER}${stringifyYaml(draft.game, { lineWidth: 0 })}`,
    });

    const coverPath = path.join(outDir, draft.coverPath);
    mkdirSync(path.dirname(coverPath), { recursive: true });
    writeFileSync(coverPath, draft.coverBytes);
    files.push({ path: draft.coverPath, content: draft.coverBytes });

    if (!seenAuthors.has(draft.author.id) && !existingAuthorIds.has(draft.author.id)) {
      seenAuthors.add(draft.author.id);
      const authorText = `${AUTHOR_SCHEMA_HEADER}${stringifyYaml(draft.author, { lineWidth: 0 })}`;
      const authorPath = path.join(outDir, 'data', 'authors', `${draft.author.id}.yaml`);
      mkdirSync(path.dirname(authorPath), { recursive: true });
      writeFileSync(authorPath, authorText);
      files.push({ path: `data/authors/${draft.author.id}.yaml`, content: authorText });
    }
  }
  return files;
}

function highestEvidence(entries: readonly ReviewEntry[]): string {
  const order = ['L1', 'L2', 'L3'];
  let best = 'L1';
  for (const item of entries) {
    if (order.indexOf(item.review.evidence_level) > order.indexOf(best))
      best = item.review.evidence_level;
  }
  return best;
}

function findRepoRoot(start = defaultRootDir()): string {
  let current = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      (existsSync(path.join(current, 'data')) && existsSync(path.join(current, 'apps')))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}

function safeExistingAuthorIds(rootDir: string): Set<string> {
  const dir = path.join(rootDir, 'data', 'authors');
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((file) => /\.ya?ml$/i.test(file))
      .map((file) => file.replace(/\.ya?ml$/i, '')),
  );
}

function mergeAuthorFiles(files: DraftFile[]): DraftFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (!file.path.startsWith('data/authors/')) return true;
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

/**
 * Enrich one repository (or one standalone online URL). Never opens a real PR
 * unless `pr` is true.
 */
export async function enrich(options: EnrichOptions): Promise<EnrichResult> {
  const log = options.logger ?? ((message: string) => console.log(message));
  const config = options.config ?? readConfig();
  const rootDir = findRepoRoot(options.rootDir);
  const parsed = parseInputUrl(options.url);
  const useAi = options.useAi ?? true;

  let metadata: RepoMetadata | null = null;
  let owner = '';
  let repoName = '';
  let repoUrlValue: string | null = null;
  let readme: string | null = null;
  let treePaths: string[] = [];
  let ghPagesPaths: string[] = [];
  let branch = 'main';

  if (parsed.kind === 'online') {
    const identity = identityForOnline(parsed.onlineUrl ?? options.url);
    owner = identity.owner;
    repoName = identity.repo;
    log(`enrich: online URL ${options.url} (no repository metadata)`);
  } else if (parsed.repo !== undefined) {
    owner = parsed.repo.owner;
    repoName = parsed.repo.repo;
    repoUrlValue = repoUrl(owner, repoName);
    const octokit = options.client ?? createOctokit();
    log(`enrich: repository ${owner}/${repoName}`);
    metadata = await getRepoMetadata(octokit, owner, repoName);
    branch = metadata.defaultBranch;
    readme = await getReadmeText(octokit, owner, repoName);
    treePaths = (await getTreeFiles(octokit, owner, repoName, branch)).map((file) => file.path);
    if (await branchExists(octokit, owner, repoName, 'gh-pages')) {
      ghPagesPaths = (await getTreeFiles(octokit, owner, repoName, 'gh-pages')).map(
        (file) => file.path,
      );
      log(`enrich: gh-pages branch found (${ghPagesPaths.length} files)`);
    } else {
      log('enrich: no gh-pages branch');
    }

    const rejection = existingRejection(rootDir, repoUrlValue);
    if (rejection !== null) {
      log(`enrich: skip — ${rejection}`);
      return {
        repo: repoKey(owner, repoName),
        skipped: rejection,
        entries: [],
        drafts: [],
        outDir: null,
        reviewMarkdown: '',
        pr: null,
      };
    }
    const seen = loadSeen(rootDir);
    if (!options.force && !needsReevaluation(seen[repoKey(owner, repoName)], metadata.pushedAt)) {
      const reason = 'already processed at this pushed_at (use --force to re-evaluate)';
      log(`enrich: skip — ${reason}`);
      return {
        repo: repoKey(owner, repoName),
        skipped: reason,
        entries: [],
        drafts: [],
        outDir: null,
        reviewMarkdown: '',
        pr: null,
      };
    }

    // A root index.html may be a hub; fetch it so it can be skipped.
    let rootHtml: string | null = null;
    if (treePaths.includes('index.html')) {
      rootHtml = await getFileText(octokit, owner, repoName, 'index.html', branch);
    }
    const pagesBase = pagesBaseUrl(owner, repoName, metadata.pagesUrl);
    const entries = discoverEntries({
      owner,
      repo: repoName,
      treePaths,
      ghPagesPaths,
      pagesSourceBranch: metadata.pagesSourceBranch,
      pagesBase,
      homepageUrl: metadata.homepage,
      rootHtml,
      maxEntries: config.limits.max_entries_per_repo,
    });
    log(
      `enrich: ${entries.length} playable entr${entries.length === 1 ? 'y' : 'ies'} — ${entries
        .map((entry) => entry.path || '.')
        .join(', ')}`,
    );
    if (entries.length === 0) {
      throw new Error(`no playable entries found for ${owner}/${repoName}`);
    }
    return finishEnrichment({
      options,
      config,
      rootDir,
      owner,
      repoName,
      repoUrlValue,
      metadata,
      readme,
      branch,
      entries,
      useAi,
      log,
      promptTreePaths: treePaths,
      octokit: options.client ?? createOctokit(),
    });
  } else {
    throw new Error(`unsupported input URL: ${options.url}`);
  }

  // Standalone online entry.
  const onlineEntry: PlayableEntry = {
    key: slugify(repoName, 'online'),
    path: '',
    playUrl: options.url,
    source: 'online',
  };
  return finishEnrichment({
    options,
    config,
    rootDir,
    owner,
    repoName,
    repoUrlValue: null,
    metadata: null,
    readme: null,
    branch: 'online',
    entries: [onlineEntry],
    useAi,
    log,
    promptTreePaths: [],
    octokit: options.client ?? createOctokit(),
  });
}

interface FinishInput {
  options: EnrichOptions;
  config: CrawlerConfig;
  rootDir: string;
  owner: string;
  repoName: string;
  repoUrlValue: string | null;
  metadata: RepoMetadata | null;
  readme: string | null;
  branch: string;
  entries: readonly PlayableEntry[];
  useAi: boolean;
  log: (message: string) => void;
  promptTreePaths: readonly string[];
  octokit: OctokitLike;
}

async function finishEnrichment(input: FinishInput): Promise<EnrichResult> {
  const { config, options, owner, repoName, entries, log } = input;
  const existing = loadExisting(input.rootDir);
  const reservedSlugs = new Set(existing.slugs);
  const existingRepoPaths = existing.repoPaths;
  const existingPlayUrls = existing.playUrls;
  const discoveredBy = options.discoveredBy ?? 'manual';
  const discoveredAt = new Date();
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const reviewEntries: ReviewEntry[] = [];
  const drafts: GameDraft[] = [];
  const modelName = detectModelName(`${input.readme ?? ''}\n${input.metadata?.description ?? ''}`);
  const authorId = idSegment(owner);
  const authorExists = safeExistingAuthorIds(input.rootDir).has(authorId);

  for (const entry of entries) {
    const repoPathKey =
      input.repoUrlValue === null ? null : `${normalizeUrl(input.repoUrlValue)}#${entry.path}`;
    if (repoPathKey !== null && existingRepoPaths.has(repoPathKey)) {
      log(`enrich: skip ${entry.path || '.'} — already in data/games`);
      continue;
    }
    if (existingPlayUrls.has(normalizeUrl(entry.playUrl))) {
      log(`enrich: skip ${entry.path || '.'} — play.url already in data/games`);
      continue;
    }
    log(`enrich: probing ${entry.playUrl}`);
    const probe: ProbeResult = await probeEntry(entry.playUrl, { config: config.probe });
    log(
      `enrich: ${entry.path || '.'} HTTP ${probe.status ?? '—'} ` +
        `reachable=${probe.reachable} embeddable=${probe.embeddable} ` +
        `consoleErrors=${probe.consoleErrors.length} cover=${Math.round(probe.coverBytes / 1024)}KB`,
    );
    const context: AiContext = {
      owner,
      repo: repoName,
      branch: input.branch,
      repoName,
      description: input.metadata?.description ?? null,
      readme: input.readme,
      topics: input.metadata?.topics ?? [],
      entryKey: entry.key,
      entryPath: entry.path,
      pageTitle: probe.title,
      probe,
      promptCandidates: promptCandidates(input.promptTreePaths, entry.key),
      submissionEvidence: options.submissionEvidence ?? null,
      playUrl: entry.playUrl,
      embedReason: probe.embedReason,
      status: probe.status,
      consoleErrors: probe.consoleErrors,
      externalHosts: probe.externalHosts,
    };
    const outcome = await reviewEntry(context, {
      useAi: input.useAi,
      aiConfig: config.ai,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    if (outcome.review.kind === 'not-game') {
      log(`enrich: skip ${entry.path || '.'} — AI classified it as not-game`);
      continue;
    }
    const draft = buildGameDraft({
      owner,
      repoName,
      repoUrlValue: input.repoUrlValue,
      license: input.metadata?.license ?? null,
      branch: input.branch,
      entry,
      probe,
      review: outcome.review,
      modelName,
      discoveredBy,
      discoveredAt: discoveredAt.toISOString().slice(0, 10),
      reservedSlugs,
      ownerProfile: input.metadata?.ownerProfile,
    });
    drafts.push(draft);
    reviewEntries.push({
      entryKey: entry.key,
      path: entry.path,
      playUrl: entry.playUrl,
      probe,
      review: outcome.review,
      draft,
      reviewMode: outcome.mode,
      note: outcome.note,
    });
  }

  await closeBrowser().catch(() => undefined);

  if (drafts.length === 0) {
    log('enrich: nothing new to draft');
    return {
      repo: repoKey(owner, repoName),
      skipped: 'nothing new (all entries deduped or classified as not-game)',
      entries: [],
      drafts: [],
      outDir: null,
      reviewMarkdown: '',
      pr: null,
    };
  }

  const reviewMarkdown = buildReviewMarkdown({
    owner,
    repo: repoName,
    repoUrl: input.repoUrlValue,
    description: input.metadata?.description ?? null,
    stars: input.metadata?.stars ?? null,
    license: input.metadata?.license ?? null,
    entries: reviewEntries,
    issueNumber: options.issueNumber ?? null,
    generatedAt: discoveredAt,
  });

  const outDir = options.outDir ?? mkdtempSync(path.join(os.tmpdir(), 'fable5-crawler-'));
  mkdirSync(outDir, { recursive: true });
  const files = mergeAuthorFiles(
    writeDraftFiles(outDir, drafts, authorExists ? new Set([authorId]) : new Set()),
  );
  writeFileSync(path.join(outDir, 'review.md'), reviewMarkdown);
  log(`enrich: wrote ${drafts.length} draft(s) to ${outDir}`);

  let pr: EnrichResult['pr'] = null;
  if (options.pr === true) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (repository === undefined || !repository.includes('/')) {
      throw new Error('GITHUB_REPOSITORY must be set (owner/repo) when using --pr');
    }
    const [targetOwner, targetRepo] = repository.split('/');
    if (targetOwner === undefined || targetRepo === undefined) {
      throw new Error(`invalid GITHUB_REPOSITORY: ${repository}`);
    }
    const labels = dedupeStrings([
      'candidate',
      `evidence:${highestEvidence(reviewEntries)}`,
      ...reviewEntries.map((item) => `kind:${item.draft.game.kind}`),
    ]);
    const branchName = candidateBranchName(owner, repoName);
    const result = await createCandidatePr({
      client: input.octokit,
      owner: targetOwner,
      repo: targetRepo,
      branch: branchName,
      files,
      title: `Candidate: ${owner}/${repoName} (${drafts.length} entr${drafts.length === 1 ? 'y' : 'ies'})`,
      body: reviewMarkdown,
      labels,
    });
    pr = {
      number: result.number,
      url: result.url,
      branch: result.branch,
      created: result.created,
    };
    log(`enrich: ${result.created ? 'opened' : 'updated'} PR ${result.url}`);
  }

  return {
    repo: repoKey(owner, repoName),
    skipped: null,
    entries: reviewEntries,
    drafts,
    outDir,
    reviewMarkdown,
    pr,
  };
}

/** Helpers exported for tests. */
export { findRepoRoot, loadExisting, identityForOnline };
