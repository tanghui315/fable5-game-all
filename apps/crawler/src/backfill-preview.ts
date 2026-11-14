/** `crawler preview`: record animated previews for entries that lack one. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listYamlFiles, loadGameFile, type Game } from '@fable5/schema';
import { readConfig, type CrawlerConfig } from './config.js';
import { closeBrowser, probeEntry } from './probe.js';
import { DEFAULT_PREVIEW, hasFfmpeg, type PreviewConfig } from './preview.js';

export interface BackfillOptions {
  rootDir: string;
  /** Only these game ids; empty means every candidate. */
  ids?: readonly string[];
  /** `game` (default), `demo`, or `all`. */
  kind?: 'game' | 'demo' | 'all';
  limit?: number;
  concurrency?: number;
  /** Re-record entries that already have a preview. */
  force?: boolean;
  dryRun?: boolean;
  /** Open a real browser window instead of headless Chromium. */
  headed?: boolean;
  config?: CrawlerConfig;
  preview?: PreviewConfig;
  logger?: (message: string) => void;
}

export interface BackfillResult {
  updated: { id: string; bytes: number; motion: number }[];
  /** Recorded but dropped: the clip never moved. */
  static: string[];
  failed: { id: string; reason: string }[];
  candidates: number;
}

/** Hard budget for one entry, including navigation, waiting and encoding. */
const ENTRY_TIMEOUT_MS = 150_000;

function gameFile(rootDir: string): string {
  return path.join(rootDir, 'data', 'games');
}

/** Insert `preview:` under the `media:` block without reformatting the file. */
export function addPreviewToYaml(file: string, relativePath: string): void {
  const text = readFileSync(file, 'utf8');
  if (/^\s+preview:/m.test(text)) return;
  const lines = text.split('\n');
  const mediaIndex = lines.findIndex((line) => line.trimEnd() === 'media:');
  if (mediaIndex === -1) throw new Error(`${file}: no media: block`);
  let insertAt = mediaIndex + 1;
  while (insertAt < lines.length && /^\s+\S/.test(lines[insertAt] ?? '')) insertAt += 1;
  lines.splice(insertAt, 0, `  preview: ${relativePath}`);
  writeFileSync(file, lines.join('\n'));
}

function isCandidate(game: Game, kind: 'game' | 'demo' | 'all', force: boolean): boolean {
  if (game.status !== 'published') return false;
  if (kind !== 'all' && game.kind !== kind) return false;
  if (!force && game.media.preview !== undefined) return false;
  return /^https?:\/\//i.test(game.play.url);
}

interface Job {
  id: string;
  url: string;
  file: string;
}

/**
 * Record previews for every entry that has none.
 *
 * Each entry is probed in its own browser context; a recording that never moves
 * is discarded instead of being written, so a title screen is never mistaken
 * for a preview. YAML is patched only after the file is on disk.
 */
export async function backfillPreviews(options: BackfillOptions): Promise<BackfillResult> {
  const rootDir = path.resolve(options.rootDir);
  const config = options.config ?? readConfig();
  const preview = options.preview ?? DEFAULT_PREVIEW;
  const kind = options.kind ?? 'game';
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const log = options.logger ?? ((message: string) => console.log(message));

  if (!(await hasFfmpeg())) {
    throw new Error('ffmpeg is required to encode animated previews (brew install ffmpeg)');
  }

  const ids = new Set(options.ids ?? []);
  const jobs: Job[] = [];
  for (const file of listYamlFiles(gameFile(rootDir))) {
    const game = loadGameFile(file);
    if (ids.size > 0 && !ids.has(game.id)) continue;
    if (!isCandidate(game, kind, options.force === true)) continue;
    jobs.push({ id: game.id, url: game.play.url, file });
  }
  const limited = options.limit !== undefined ? jobs.slice(0, options.limit) : jobs;
  log(`preview: ${limited.length} candidate(s) of ${jobs.length}, concurrency ${concurrency}`);
  if (options.dryRun === true) {
    for (const job of limited) log(`  ${job.id}  ${job.url}`);
    return { updated: [], static: [], failed: [], candidates: limited.length };
  }

  const result: BackfillResult = { updated: [], static: [], failed: [], candidates: limited.length };
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const job = limited[index];
      if (job === undefined) return;
      try {
        // A wedged renderer wedges every call on that browser; give each entry
        // its own budget and recycle the browser instead of hanging the run.
        const probe = await Promise.race([
          probeEntry(job.url, {
            config: config.probe,
            preview,
            headless: options.headed !== true,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ENTRY_TIMEOUT_MS)),
        ]);
        if (probe === null) {
          await closeBrowser();
          result.failed.push({ id: job.id, reason: `timed out after ${ENTRY_TIMEOUT_MS / 1000}s` });
          log(`  ✗ ${job.id} — timed out, browser restarted`);
          continue;
        }
        if (probe.previewWebp === null) {
          result.failed.push({ id: job.id, reason: probe.error ?? 'no preview recorded' });
          log(`  ✗ ${job.id} — ${probe.error ?? 'no preview recorded'}`);
          continue;
        }
        if (probe.previewStatic) {
          result.static.push(job.id);
          log(`  · ${job.id} — static (motion ${probe.previewMotion.toFixed(1)}), skipped`);
          continue;
        }
        const relative = `media/${job.id}/preview.webp`;
        const target = path.join(rootDir, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, probe.previewWebp);
        addPreviewToYaml(job.file, relative);
        result.updated.push({
          id: job.id,
          bytes: probe.previewBytes,
          motion: probe.previewMotion,
        });
        log(
          `  ✓ ${job.id} — ${Math.round(probe.previewBytes / 1024)}KB ` +
            `motion ${probe.previewMotion.toFixed(1)} in ${Math.round(probe.elapsedMs / 1000)}s`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failed.push({ id: job.id, reason });
        log(`  ✗ ${job.id} — ${reason}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await Promise.race([
    closeBrowser(),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  log(
    `preview: ${result.updated.length} written, ${result.static.length} static, ` +
      `${result.failed.length} failed`,
  );
  return result;
}
