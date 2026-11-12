#!/usr/bin/env node
import { Command } from 'commander';

/**
 * Placeholder CLI for the crawler lane.
 *
 * The real subcommands (`enrich`, `discover`, `health`) land in M2/M3; this
 * entrypoint exists so `pnpm -r build` and `pnpm --filter crawler crawler`
 * work from day one.
 */
const program = new Command();

program
  .name('crawler')
  .description('fable5-game-all crawler (placeholder)')
  .version('0.0.0');

program.parse();
