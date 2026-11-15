#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFileError, listYamlFiles, loadAuthorFile, loadFeaturedFile, loadGameFile, loadHealthFile, loadRejectedFile, loadReposFile } from './load.js';
import type { Author, Game, HealthFile, Rejected, ReposFile } from './schema.js';

/** Upper bound for `media/<id>/cover.webp` (150 KB). */
export const COVER_MAX_BYTES = 150 * 1024;
/** Upper bound for `media/<id>/preview.webp` (1 MB). */
export const PREVIEW_MAX_BYTES = 1024 * 1024;
/** Timeout for `--online` reachability checks. */
export const ONLINE_TIMEOUT_MS = 10_000;

export interface ValidationIssue {
  /** Path relative to the repository root. */
  file: string;
  message: string;
}

export interface ValidateOptions {
  /** Repository root containing `data/` and `media/`. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Also check that every `play.url` resolves to a 2xx/3xx response. */
  online?: boolean;
  /** Injectable fetch, used by tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Timeout for online checks, in milliseconds. */
  timeoutMs?: number;
}

export interface ValidationResult {
  ok: boolean;
  rootDir: string;
  games: number;
  authors: number;
  rejected: number;
  errors: ValidationIssue[];
}

interface MediaCheck {
  label: 'cover' | 'preview';
  relativePath: string;
  maxBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function probeUrl(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<string | null> {
  const request = (method: 'HEAD' | 'GET') =>
    fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'fable5-game-all-validate/0.1' },
    });

  try {
    let response = await request('HEAD');
    // Some static hosts reject HEAD requests; retry with GET before giving up.
    if (response.status === 403 || response.status === 405 || response.status === 501) {
      response = await request('GET');
    }
    if (response.status >= 200 && response.status < 400) return null;
    return `play.url ${url} returned HTTP ${response.status}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `play.url ${url} unreachable: ${detail}`;
  }
}

function mediaChecks(game: Game): MediaCheck[] {
  const checks: MediaCheck[] = [
    { label: 'cover', relativePath: game.media.cover, maxBytes: COVER_MAX_BYTES },
  ];
  if (game.media.preview !== undefined) {
    checks.push({
      label: 'preview',
      relativePath: game.media.preview,
      maxBytes: PREVIEW_MAX_BYTES,
    });
  }
  return checks;
}

/**
 * Validate the `data/` tree and referenced media of a repository.
 *
 * Never throws for bad data: every problem is returned as a `ValidationIssue`
 * so callers can print all of them at once. An empty/missing `data/` dir passes.
 */
export async function validateData(options: ValidateOptions = {}): Promise<ValidationResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const dataDir = path.join(rootDir, 'data');
  const errors: ValidationIssue[] = [];

  const relative = (file: string) => path.relative(rootDir, file) || file;
  const addIssue = (file: string, message: string) => {
    errors.push({ file: relative(file), message });
  };
  const addLoadError = (error: unknown, file: string) => {
    if (error instanceof DataFileError) {
      for (const issue of error.issues) addIssue(file, issue);
      return;
    }
    addIssue(file, error instanceof Error ? error.message : String(error));
  };

  // Authors first: games refer to them by id.
  const authors: Author[] = [];
  const authorFiles = new Map<string, string>();
  for (const file of listYamlFiles(path.join(dataDir, 'authors'))) {
    let author: Author;
    try {
      author = loadAuthorFile(file);
    } catch (error) {
      addLoadError(error, file);
      continue;
    }
    const previous = authorFiles.get(author.id);
    if (previous !== undefined) {
      addIssue(file, `duplicate author id "${author.id}" (also in ${relative(previous)})`);
    } else {
      authorFiles.set(author.id, file);
    }
    authors.push(author);
  }

  const games: Game[] = [];
  const gameFiles = new Map<string, string>();
  const slugFiles = new Map<string, string>();
  const mediaErrors: Array<{ file: string; message: string }> = [];

  for (const file of listYamlFiles(path.join(dataDir, 'games'))) {
    let game: Game;
    try {
      game = loadGameFile(file);
    } catch (error) {
      addLoadError(error, file);
      continue;
    }
    games.push(game);

    const expectedName = `${game.id}${path.extname(file)}`;
    if (path.basename(file) !== expectedName) {
      addIssue(
        file,
        `file name must be "${expectedName}" to match id "${game.id}" (found "${path.basename(file)}")`,
      );
    }

    const previousId = gameFiles.get(game.id);
    if (previousId !== undefined) {
      addIssue(file, `duplicate game id "${game.id}" (also in ${relative(previousId)})`);
    } else {
      gameFiles.set(game.id, file);
    }

    const previousSlug = slugFiles.get(game.slug);
    if (previousSlug !== undefined) {
      addIssue(file, `duplicate slug "${game.slug}" (also in ${relative(previousSlug)})`);
    } else {
      slugFiles.set(game.slug, file);
    }

    if (!authorFiles.has(game.author)) {
      addIssue(file, `author "${game.author}" not found in data/authors/${game.author}.yaml`);
    }

    for (const check of mediaChecks(game)) {
      const absolute = path.resolve(rootDir, check.relativePath);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        mediaErrors.push({
          file,
          message: `${check.label} file not found: ${check.relativePath}`,
        });
        continue;
      }
      const size = statSync(absolute).size;
      if (size > check.maxBytes) {
        mediaErrors.push({
          file,
          message: `${check.label} file ${check.relativePath} is ${formatBytes(size)} (max ${formatBytes(check.maxBytes)})`,
        });
      }
    }
  }
  errors.push(...mediaErrors);

  // `data/featured.yaml` drives the home hero; every id must exist and be
  // publishable, otherwise the cover silently drops to an empty slot.
  const featuredFile = path.join(dataDir, 'featured.yaml');
  if (existsSync(featuredFile)) {
    let featured: string[] = [];
    try {
      featured = loadFeaturedFile(featuredFile);
    } catch (error) {
      addLoadError(error, featuredFile);
    }
    const seen = new Set<string>();
    for (const id of featured) {
      if (seen.has(id)) addIssue(featuredFile, `duplicate id "${id}"`);
      seen.add(id);
      const game = games.find((candidate) => candidate.id === id);
      if (game === undefined) {
        addIssue(featuredFile, `id "${id}" not found in data/games`);
      } else if (game.status !== 'published') {
        addIssue(featuredFile, `id "${id}" is ${game.status}, the hero only shows published entries`);
      }
    }
  }

  let rejected: Rejected[] = [];
  try {
    rejected = loadRejectedFile(path.join(dataDir, 'rejected.yaml'));
  } catch (error) {
    addLoadError(error, path.join(dataDir, 'rejected.yaml'));
  }

  const generated: Array<[(file: string) => ReposFile | HealthFile, string]> = [
    [loadReposFile, 'repos.json'],
    [loadHealthFile, 'health.json'],
  ];
  for (const [load, name] of generated) {
    const file = path.join(dataDir, '_generated', name);
    try {
      load(file);
    } catch (error) {
      addLoadError(error, file);
    }
  }

  if (options.online && games.length > 0) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? ONLINE_TIMEOUT_MS;
    const byUrl = new Map<string, Set<string>>();
    for (const game of games) {
      const file = gameFiles.get(game.id);
      if (file === undefined) continue;
      const files = byUrl.get(game.play.url) ?? new Set<string>();
      files.add(file);
      byUrl.set(game.play.url, files);
    }
    const results = await Promise.all(
      [...byUrl.entries()].map(async ([url, files]) => ({
        files: [...files],
        error: await probeUrl(url, fetchImpl, timeoutMs),
      })),
    );
    for (const result of results) {
      if (result.error === null) continue;
      for (const file of result.files) addIssue(file, result.error);
    }
  }

  return {
    ok: errors.length === 0,
    rootDir,
    games: games.length,
    authors: authors.length,
    rejected: rejected.length,
    errors,
  };
}

export interface CliOptions {
  rootDir: string;
  online: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let rootDir = process.cwd();
  let online = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--online') {
      online = true;
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--root requires a directory argument');
      rootDir = path.resolve(value);
      index += 1;
    } else if (arg?.startsWith('--root=')) {
      rootDir = path.resolve(arg.slice('--root='.length));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { rootDir, online };
}

/** CLI entrypoint: prints per-file errors and returns the process exit code. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const { rootDir, online } = parseCliArgs(argv);
  const result = await validateData({ rootDir, online });
  const scope = online ? ' (online)' : '';
  const summary = `${result.games} game(s), ${result.authors} author(s), ${result.rejected} rejected entr${
    result.rejected === 1 ? 'y' : 'ies'
  }`;

  if (result.ok) {
    console.log(`validate: ok${scope} — ${summary}`);
    return 0;
  }

  console.error(`validate: ${result.errors.length} error(s)${scope} — ${summary}`);
  for (const issue of result.errors) {
    console.error(`  ${issue.file}: ${issue.message}`);
  }
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
