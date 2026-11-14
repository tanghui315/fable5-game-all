import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  AuthorSchema,
  FeaturedFileSchema,
  GameSchema,
  HealthFileSchema,
  RejectedFileSchema,
  ReposFileSchema,
  formatZodIssues,
  type Author,
  type Featured,
  type Game,
  type HealthFile,
  type Rejected,
  type ReposFile,
} from './schema.js';

/** Error raised when a single data file cannot be parsed or validated. */
export class DataFileError extends Error {
  readonly file: string;
  readonly issues: readonly string[];

  constructor(file: string, issues: readonly string[]) {
    super(`${file}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'DataFileError';
    this.file = file;
    this.issues = issues;
  }
}

export interface LoadedData {
  authors: Author[];
  games: Game[];
  rejected: Rejected[];
  /** Ordered game ids for the home hero; empty means "pick automatically". */
  featured: Featured;
  generated: {
    repos: ReposFile;
    health: HealthFile;
  };
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new DataFileError(file, [`cannot read file: ${(error as Error).message}`]);
  }
}

/** Parse YAML text, wrapping syntax errors in a `DataFileError`. */
export function parseYamlText(text: string, file = '<yaml>'): unknown {
  if (text.trim() === '') return null;
  try {
    return parseYaml(text);
  } catch (error) {
    throw new DataFileError(file, [`invalid YAML: ${(error as Error).message}`]);
  }
}

function parseWith<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown, file: string, fallback?: T): T {
  const result = schema.safeParse(value ?? fallback);
  if (!result.success) throw new DataFileError(file, formatZodIssues(result.error));
  return result.data;
}

export function parseGame(value: unknown, file = '<game>'): Game {
  return parseWith(GameSchema, value, file);
}

export function parseGameYaml(text: string, file = '<game>'): Game {
  return parseGame(parseYamlText(text, file), file);
}

export function parseAuthor(value: unknown, file = '<author>'): Author {
  return parseWith(AuthorSchema, value, file);
}

export function parseAuthorYaml(text: string, file = '<author>'): Author {
  return parseAuthor(parseYamlText(text, file), file);
}

export function parseRejected(value: unknown, file = '<rejected>'): Rejected[] {
  return parseWith(RejectedFileSchema, value, file, []);
}

export function parseRejectedYaml(text: string, file = '<rejected>'): Rejected[] {
  return parseRejected(parseYamlText(text, file), file);
}

export function loadGameFile(file: string): Game {
  return parseGame(parseYamlText(readText(file), file), file);
}

export function loadAuthorFile(file: string): Author {
  return parseAuthor(parseYamlText(readText(file), file), file);
}

export function loadRejectedFile(file: string): Rejected[] {
  if (!existsSync(file)) return [];
  return parseRejected(parseYamlText(readText(file), file), file);
}

export function parseFeatured(value: unknown, file = '<featured>'): Featured {
  return parseWith(FeaturedFileSchema, value, file, []);
}

export function parseFeaturedYaml(text: string, file = '<featured>'): Featured {
  return parseFeatured(parseYamlText(text, file), file);
}

export function loadFeaturedFile(file: string): Featured {
  if (!existsSync(file)) return [];
  return parseFeaturedYaml(readText(file), file);
}

function parseJsonFile<T>(file: string, schema: ZodType<T, ZodTypeDef, unknown>, fallback: T): T {
  if (!existsSync(file)) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(readText(file));
  } catch (error) {
    throw new DataFileError(file, [`invalid JSON: ${(error as Error).message}`]);
  }
  return parseWith(schema, value, file, fallback);
}

export function loadReposFile(file: string): ReposFile {
  return parseJsonFile(file, ReposFileSchema, {});
}

export function loadHealthFile(file: string): HealthFile {
  return parseJsonFile(file, HealthFileSchema, {});
}

/** Sorted `*.yaml` / `*.yml` files in `dir`; missing directories are empty. */
export function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/**
 * Read and validate a whole `data/` tree.
 *
 * Missing directories or files are treated as empty, so an empty repository
 * validates cleanly. Throws `DataFileError` on the first invalid file.
 */
export function loadData(rootDir: string): LoadedData {
  const dataDir = path.join(rootDir, 'data');
  return {
    authors: listYamlFiles(path.join(dataDir, 'authors')).map(loadAuthorFile),
    games: listYamlFiles(path.join(dataDir, 'games')).map(loadGameFile),
    rejected: loadRejectedFile(path.join(dataDir, 'rejected.yaml')),
    featured: loadFeaturedFile(path.join(dataDir, 'featured.yaml')),
    generated: {
      repos: loadReposFile(path.join(dataDir, '_generated', 'repos.json')),
      health: loadHealthFile(path.join(dataDir, '_generated', 'health.json')),
    },
  };
}
