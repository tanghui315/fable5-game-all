import { z } from 'zod';

/** `owner--repo--entry`, lowercase. Global identifier of a game entry. */
export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/;
/** URL slug, kebab-case. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Author id, matches `data/authors/<id>.yaml`. */
export const AUTHOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Model names look like `fable-5.2` (optionally `fable-5.2.1`). */
export const MODEL_NAME_PATTERN = /^fable-5(?:\.[0-9]+)+$/;
/** Dates are stored as `YYYY-MM-DD` strings. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z.string().regex(ISO_DATE_PATTERN, 'must be a YYYY-MM-DD date');

export const LocalizedTextSchema = z
  .object({
    zh: z.string().min(1),
    en: z.string().min(1).optional(),
  })
  .strict();

/** Alias kept for readability: `title` and `summary` share the same shape. */
export const TitleSchema = LocalizedTextSchema;
/** Alias kept for readability: `title` and `summary` share the same shape. */
export const SummarySchema = LocalizedTextSchema;

export const GameKindSchema = z.enum(['game', 'demo']);
export const GameStatusSchema = z.enum(['published', 'archived']);
export const ControlSchema = z.enum(['keyboard', 'mouse', 'touch', 'gamepad']);
export const EvidenceLevelSchema = z.enum(['L1', 'L2', 'L3']);
export const DiscoveredBySchema = z.enum(['seed', 'github-search', 'submission', 'hn', 'manual']);
export const RejectedReasonSchema = z.enum([
  'not-a-game',
  'no-evidence',
  'ip-clone',
  'broken',
  'malicious',
  'duplicate',
  'author-optout',
]);
export const HealthStatusSchema = z.enum(['ok', 'broken', 'unknown']);

export const RepoSchema = z
  .object({
    url: z.string().url(),
    path: z.string().optional(),
    license: z.string().min(1).optional(),
  })
  .strict();

export const PlaySchema = z
  .object({
    url: z.string().url(),
    embeddable: z.boolean(),
    mirror_url: z.string().url().nullable().optional(),
  })
  .strict();

export const MediaSchema = z
  .object({
    cover: z.string().min(1),
    preview: z.string().min(1).optional(),
  })
  .strict();

export const ModelSchema = z
  .object({
    name: z.string().regex(MODEL_NAME_PATTERN, 'must look like fable-5.2'),
    evidence: EvidenceLevelSchema,
    evidence_notes: z.string().min(1).optional(),
  })
  .strict();

export const GenerationSchema = z
  .object({
    tool: z.string().min(1).optional(),
    prompt_url: z.string().url().optional(),
    turns: z.number().int().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    duration_min: z.number().nonnegative().optional(),
    /** How many runs were merged into this entry (e.g. a task run twice). */
    runs: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const SourceSchema = z
  .object({
    discovered_by: DiscoveredBySchema,
    discovered_at: isoDate,
    published_at: isoDate.optional(),
  })
  .strict();

export const GameSchema = z
  .object({
    id: z
      .string()
      .regex(GAME_ID_PATTERN, 'must be owner--repo--entry (lowercase a-z0-9-)'),
    slug: z.string().regex(SLUG_PATTERN, 'must be kebab-case (a-z0-9 and single dashes)'),
    kind: GameKindSchema,
    status: GameStatusSchema,
    title: LocalizedTextSchema,
    summary: LocalizedTextSchema,
    author: z.string().regex(AUTHOR_ID_PATTERN, 'must be an author id (lowercase a-z0-9-)'),
    repo: RepoSchema.optional(),
    play: PlaySchema,
    media: MediaSchema,
    genre: z.string().min(1),
    tags: z.array(z.string().min(1)),
    controls: z.array(ControlSchema),
    mobile: z.boolean(),
    model: ModelSchema,
    generation: GenerationSchema.optional(),
    source: SourceSchema,
  })
  .strict();

export const AuthorSchema = z
  .object({
    id: z.string().regex(AUTHOR_ID_PATTERN, 'must be lowercase a-z0-9-'),
    name: z.string().min(1),
    github: z.string().min(1).nullable().optional(),
    x: z.string().min(1).nullable().optional(),
    website: z.string().url().nullable().optional(),
    avatar: z.string().url().nullable().optional(),
    claimed: z.boolean().default(false),
  })
  .strict();

export const RejectedSchema = z
  .object({
    repo: z.string().url(),
    reason: RejectedReasonSchema,
    note: z.string().min(1).optional(),
    date: isoDate,
  })
  .strict();

export const RejectedFileSchema = z.array(RejectedSchema);

/** `data/_generated/repos.json` — keyed by repository URL. */
export const RepoRecordSchema = z
  .object({
    stars: z.number().int().nonnegative().optional(),
    last_commit: z.string().min(1).optional(),
    alive: z.boolean().optional(),
    checked_at: z.string().min(1).optional(),
  })
  .passthrough();

export const ReposFileSchema = z.record(z.string(), RepoRecordSchema);

/** `data/_generated/health.json` — keyed by `play.url`. */
export const HealthRecordSchema = z
  .object({
    checked_at: z.string().min(1),
    status: HealthStatusSchema.optional(),
    http_status: z.number().int().nullable().optional(),
    embeddable: z.boolean().optional(),
    console_errors: z.number().int().nonnegative().optional(),
    note: z.string().min(1).optional(),
  })
  .passthrough();

export const HealthFileSchema = z.record(z.string(), HealthRecordSchema);

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
export type Title = LocalizedText;
export type Summary = LocalizedText;
export type GameKind = z.infer<typeof GameKindSchema>;
export type GameStatus = z.infer<typeof GameStatusSchema>;
export type Control = z.infer<typeof ControlSchema>;
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;
export type DiscoveredBy = z.infer<typeof DiscoveredBySchema>;
export type RejectedReason = z.infer<typeof RejectedReasonSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Play = z.infer<typeof PlaySchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Game = z.infer<typeof GameSchema>;
export type GameInput = z.input<typeof GameSchema>;
export type Author = z.infer<typeof AuthorSchema>;
export type AuthorInput = z.input<typeof AuthorSchema>;
export type Rejected = z.infer<typeof RejectedSchema>;
export type RepoRecord = z.infer<typeof RepoRecordSchema>;
export type ReposFile = z.infer<typeof ReposFileSchema>;
export type HealthRecord = z.infer<typeof HealthRecordSchema>;
export type HealthFile = z.infer<typeof HealthFileSchema>;

/**
 * Turn a ZodError into stable, human readable strings such as
 * `play.url: Invalid url`.
 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${at}: ${issue.message}`;
  });
}
