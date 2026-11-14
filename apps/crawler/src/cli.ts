#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import type { DiscoveredBy } from '@fable5/schema';
import { backfillPreviews } from './backfill-preview.js';
import { discover } from './discover.js';
import { enrich, findRepoRoot } from './enrich.js';
import { healthCheck } from './health.js';
import { DEFAULT_PREVIEW } from './preview.js';
import { rejectFromPr } from './reject.js';
import { processSubmission } from './submission.js';

const DISCOVERED_BY = new Set<DiscoveredBy>([
  'seed',
  'github-search',
  'submission',
  'hn',
  'manual',
]);

function parseIssueNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`invalid issue number: ${value}`);
  return number;
}

function discoveredBy(value: string | undefined): DiscoveredBy {
  if (value === undefined) return 'manual';
  if (!DISCOVERED_BY.has(value as DiscoveredBy)) {
    throw new Error(`unknown --discovered-by value: ${value}`);
  }
  return value as DiscoveredBy;
}

const program = new Command();
program
  .name('crawler')
  .description('fable5-game-all crawler: enrich, discover, health check')
  .version('0.1.0')
  .showSuggestionAfterError();

program
  .command('enrich')
  .description('Enrich one repository or online URL into YAML drafts + media + review.md')
  .argument('<url>', 'GitHub repository URL, *.github.io/<repo>/ URL, or online URL')
  .option('--out <dir>', 'output directory (default: a temp directory)')
  .option('--root <dir>', 'repository root used for dedupe/state (default: discovered from cwd)')
  .option('--pr', 'commit drafts to a candidate branch and open/update a PR', false)
  .option('--no-ai', 'skip AI review and use deterministic heuristics')
  .option('--no-preview', 'skip recording the animated preview')
  .option('--force', 're-evaluate even when seen.json says the revision is processed', false)
  .option('--issue <number>', 'submission issue number to reference in the PR body')
  .option('--discovered-by <kind>', 'seed | github-search | submission | hn | manual')
  .action(async (url: string, options: Record<string, unknown>) => {
    const result = await enrich({
      url,
      rootDir: findRepoRoot(
        typeof options.root === 'string' ? path.resolve(options.root) : process.cwd(),
      ),
      outDir: typeof options.out === 'string' ? path.resolve(options.out) : undefined,
      pr: options.pr === true,
      useAi: options.ai !== false,
      preview: options.preview !== false,
      force: options.force === true,
      issueNumber: parseIssueNumber(typeof options.issue === 'string' ? options.issue : undefined),
      discoveredBy: discoveredBy(
        typeof options.discoveredBy === 'string' ? options.discoveredBy : undefined,
      ),
    });
    if (result.pr !== null) {
      console.log(`enrich: PR ${result.pr.created ? 'created' : 'updated'}: ${result.pr.url}`);
    }
    if (result.skipped !== null) console.log(`enrich: skipped — ${result.skipped}`);
  });

program
  .command('discover')
  .description('Search GitHub / Hacker News and enrich the top candidates')
  .option('--limit <number>', 'maximum candidates to process', '10')
  .option('--dry-run', 'print ranked candidates only (no probing, no PRs)', false)
  .option('--no-pr', 'enrich into a temp directory without opening PRs')
  .option('--no-ai', 'skip AI review')
  .action(async (options: Record<string, unknown>) => {
    const limit = Number(options.limit ?? 10);
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error(`invalid --limit: ${String(options.limit)}`);
    const result = await discover({
      rootDir: findRepoRoot(process.cwd()),
      limit,
      dryRun: options.dryRun === true,
      pr: options.pr !== false,
      useAi: options.ai !== false,
    });
    if (!options.dryRun) {
      console.log(
        `discover: processed ${result.processed.length} candidate(s); ` +
          `${result.processed.filter((item) => item.pr !== null).length} PR(s)`,
      );
    }
  });

program
  .command('preview')
  .description('Record an animated preview for entries that do not have one yet')
  .option('--root <dir>', 'repository root (default: discovered from cwd)')
  .option('--id <id...>', 'only these game ids')
  .option('--kind <kind>', 'game | demo | all', 'game')
  .option('--limit <number>', 'stop after N entries')
  .option('--concurrency <number>', 'pages recorded in parallel', '3')
  .option('--seconds <number>', 'preview length in seconds')
  .option('--fps <number>', 'frames per second')
  .option('--force', 're-record entries that already have a preview', false)
  .option('--headed', 'open real browser windows (WebGL-heavy entries)', false)
  .option('--dry-run', 'list the candidates without recording', false)
  .action(async (options: Record<string, unknown>) => {
    const kind = String(options.kind ?? 'game');
    if (kind !== 'game' && kind !== 'demo' && kind !== 'all') {
      throw new Error(`invalid --kind: ${kind}`);
    }
    const preview = { ...DEFAULT_PREVIEW };
    if (typeof options.seconds === 'string') preview.seconds = Number(options.seconds);
    if (typeof options.fps === 'string') preview.fps = Number(options.fps);
    const result = await backfillPreviews({
      rootDir:
        typeof options.root === 'string' ? path.resolve(options.root) : findRepoRoot(process.cwd()),
      ids: Array.isArray(options.id) ? (options.id as string[]) : [],
      kind,
      limit: options.limit === undefined ? undefined : Number(options.limit),
      concurrency: Number(options.concurrency ?? 3),
      force: options.force === true,
      dryRun: options.dryRun === true,
      headed: options.headed === true,
      preview,
    });
    if (result.failed.length > 0) process.exitCode = 1;
    // Playwright keeps handles alive after a wedged page; do not wait on them.
    setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
  });

program
  .command('health')
  .description('Check published games and repositories, optionally writing data/_generated')
  .option('--write', 'write data/_generated/health.json and repos.json', false)
  .option('--root <dir>', 'repository root (default: discovered from cwd)')
  .option('--failures-file <file>', 'write the list of games failing twice as JSON')
  .action(async (options: Record<string, unknown>) => {
    const root =
      typeof options.root === 'string' ? path.resolve(options.root) : findRepoRoot(process.cwd());
    const result = await healthCheck({
      rootDir: root,
      write: options.write === true,
      failuresFile:
        typeof options.failuresFile === 'string' ? path.resolve(options.failuresFile) : null,
    });
    console.log(
      `health: checked ${result.checked} URL(s), ${result.failures.length} failing twice`,
    );
  });

program
  .command('reject-from-pr')
  .description('Append a repository to data/rejected.yaml after a rejected PR closes')
  .option('--repo <url>', 'repository URL (otherwise parsed from --body-file)')
  .option('--body-file <file>', 'file containing the PR body')
  .option('--reason <reason|label>', 'rejection reason or reason:<label>', 'not-a-game')
  .option('--note <note>', 'free-form note')
  .option('--root <dir>', 'repository root (default: discovered from cwd)')
  .action(async (options: Record<string, unknown>) => {
    const body =
      typeof options.bodyFile === 'string'
        ? readFileSync(path.resolve(options.bodyFile), 'utf8')
        : null;
    rejectFromPr({
      rootDir:
        typeof options.root === 'string' ? path.resolve(options.root) : findRepoRoot(process.cwd()),
      repo: typeof options.repo === 'string' ? options.repo : null,
      body,
      reason: typeof options.reason === 'string' ? options.reason : 'not-a-game',
      note: typeof options.note === 'string' ? options.note : null,
    });
  });

program
  .command('submission')
  .description('Process a submission issue form: parse fields, then enrich --pr')
  .requiredOption('--body <file>', 'file containing the issue form body')
  .requiredOption('--issue <number>', 'issue number')
  .option('--out <dir>', 'output directory (default: a temp directory)')
  .option('--pr', 'open/update a candidate PR', false)
  .option('--no-ai', 'skip AI review')
  .action(async (options: Record<string, unknown>) => {
    const body = readFileSync(path.resolve(String(options.body)), 'utf8');
    const issueNumber = parseIssueNumber(String(options.issue));
    if (issueNumber === null) throw new Error('--issue must be a positive number');
    const result = await processSubmission({
      body,
      issueNumber,
      rootDir: findRepoRoot(process.cwd()),
      outDir: typeof options.out === 'string' ? path.resolve(options.out) : undefined,
      pr: options.pr === true,
      useAi: options.ai !== false,
    });
    console.log(
      `submission: repo=${result.enrich.repo ?? '—'} drafts=${result.enrich.drafts.length}`,
    );
    if (result.enrich.pr !== null) console.log(`submission: PR ${result.enrich.pr.url}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`crawler: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
