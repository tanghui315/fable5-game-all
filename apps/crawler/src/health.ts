/** `crawler health`: weekly link + repo health for published games. */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  HealthFileSchema,
  ReposFileSchema,
  listYamlFiles,
  loadGameFile,
  loadHealthFile,
  loadReposFile,
  type Game,
  type HealthFile,
  type HealthRecord,
  type ReposFile,
} from '@fable5/schema';
import { parseEmbeddable } from './embeddable.js';
import { createOctokit, getRepoLight } from './github.js';
import { findRepoRoot } from './enrich.js';
import { loadSeen } from './seen.js';

export interface HealthOptions {
  rootDir: string;
  write?: boolean;
  failuresFile?: string | null;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  logger?: (message: string) => void;
}

export interface HealthFailure {
  id: string;
  slug: string;
  title: string;
  playUrl: string;
  repoUrl: string | null;
  httpStatus: number | null;
  consecutiveFailures: number;
}

export interface HealthResult {
  health: HealthFile;
  repos: ReposFile;
  failures: HealthFailure[];
  checked: number;
}

function loadGames(rootDir: string): Game[] {
  const games: Game[] = [];
  for (const file of listYamlFiles(path.join(rootDir, 'data', 'games'))) {
    try {
      games.push(loadGameFile(file));
    } catch {
      // Invalid files are reported by validate.
    }
  }
  return games;
}

async function checkUrl(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<{ status: number | null; headers: Record<string, string>; error: string | null }> {
  const request = (method: 'HEAD' | 'GET') =>
    fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'fable5-game-all-health/0.1' },
    });
  try {
    let response = await request('HEAD');
    if (response.status === 403 || response.status === 405 || response.status === 501) {
      response = await request('GET');
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, error: null };
  } catch (error) {
    return {
      status: null,
      headers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function previousFailureCount(previous: HealthRecord | undefined): number {
  if (previous === undefined) return 0;
  const record = previous as HealthRecord & { consecutive_failures?: number };
  return typeof record.consecutive_failures === 'number' ? record.consecutive_failures : 0;
}

/** Check every published game and its repository; never throws for one bad link. */
export async function healthCheck(options: HealthOptions): Promise<HealthResult> {
  const log = options.logger ?? ((message: string) => console.log(message));
  const rootDir = findRepoRoot(options.rootDir);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const games = loadGames(rootDir).filter((game) => game.status === 'published');
  const previousHealth = loadHealthFile(path.join(rootDir, 'data', '_generated', 'health.json'));
  const previousRepos = loadReposFile(path.join(rootDir, 'data', '_generated', 'repos.json'));
  const checkedAt = new Date().toISOString();

  const byPlayUrl = new Map<string, Game[]>();
  for (const game of games) {
    const list = byPlayUrl.get(game.play.url) ?? [];
    list.push(game);
    byPlayUrl.set(game.play.url, list);
  }

  const health: HealthFile = {};
  const failures: HealthFailure[] = [];
  for (const [url, urlGames] of byPlayUrl) {
    const result = await checkUrl(url, fetchImpl, timeoutMs);
    const reachable = result.status !== null && result.status >= 200 && result.status < 400;
    const verdict = parseEmbeddable(result.headers);
    const previous = previousHealth[url];
    const previousCount = previousFailureCount(previous);
    const consecutive = reachable ? 0 : previousCount + 1;
    const record: HealthRecord = {
      checked_at: checkedAt,
      status: reachable ? 'ok' : 'broken',
      http_status: result.status,
      embeddable: verdict.embeddable,
      ...(verdict.embeddable ? {} : { note: verdict.reason }),
      consecutive_failures: consecutive,
    } as HealthRecord;
    health[url] = record;
    const statusText = result.status ?? result.error ?? 'unreachable';
    log(
      `health: ${reachable ? 'ok ' : 'FAIL'} ${url} (${statusText})${consecutive > 1 ? ` x${consecutive}` : ''}`,
    );
    if (consecutive >= 2) {
      for (const game of urlGames) {
        failures.push({
          id: game.id,
          slug: game.slug,
          title: game.title.zh,
          playUrl: game.play.url,
          repoUrl: game.repo?.url ?? null,
          httpStatus: result.status,
          consecutiveFailures: consecutive,
        });
      }
    }
  }

  const repos: ReposFile = {};
  const repoUrls = [
    ...new Set(
      games.map((game) => game.repo?.url).filter((url): url is string => url !== undefined),
    ),
  ];
  const octokit = createOctokit();
  for (const url of repoUrls) {
    const match = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i.exec(url);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    try {
      const info = await getRepoLight(octokit, match[1], match[2].replace(/\.git$/i, ''));
      repos[url] = {
        ...(info.stars !== null ? { stars: info.stars } : {}),
        ...(info.pushedAt !== null ? { last_commit: info.pushedAt } : {}),
        alive: info.exists,
        checked_at: checkedAt,
      };
      log(`health: repo ${url} alive=${info.exists} stars=${info.stars ?? '—'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = previousRepos[url];
      repos[url] = {
        ...(previous?.stars !== undefined ? { stars: previous.stars } : {}),
        ...(previous?.last_commit !== undefined ? { last_commit: previous.last_commit } : {}),
        alive: previous?.alive ?? false,
        checked_at: checkedAt,
        note: `check failed: ${message.slice(0, 200)}`,
      };
      log(`health: repo ${url} check failed (${message})`);
    }
  }

  HealthFileSchema.parse(health);
  ReposFileSchema.parse(repos);

  if (options.write === true) {
    const dir = path.join(rootDir, 'data', '_generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'health.json'), `${JSON.stringify(health, null, 2)}\n`);
    writeFileSync(path.join(dir, 'repos.json'), `${JSON.stringify(repos, null, 2)}\n`);
    log(`health: wrote ${path.join(dir, 'health.json')} and repos.json`);
  }

  if (options.failuresFile !== undefined && options.failuresFile !== null) {
    mkdirSync(path.dirname(options.failuresFile), { recursive: true });
    writeFileSync(options.failuresFile, `${JSON.stringify(failures, null, 2)}\n`);
  }

  log(
    failures.length > 0
      ? `health: ${failures.length} game(s) failing twice — ${failures.map((item) => item.slug).join(', ')}`
      : 'health: no games failing twice',
  );
  // Touch seen.json only to make sure a corrupt state file does not crash the run.
  loadSeen(rootDir);
  return { health, repos, failures, checked: byPlayUrl.size };
}
