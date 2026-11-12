import {
  loadData,
  type Author,
  type Control,
  type Game,
  type GameKind,
  type HealthRecord,
  type RepoRecord,
} from '@fable5/schema';
import { resolveDataRoot } from './data-root.mjs';

export const DATA_ROOT = resolveDataRoot();

export const SITE_NAME = 'fable5-game-all';
export const GITHUB_REPO = 'https://github.com/tanghui315/fable5-game-all';
export const SUBMIT_URL = `${GITHUB_REPO}/issues/new?template=submit-game.yml`;
export const TAKEDOWN_URL = `${GITHUB_REPO}/issues/new?template=takedown.yml`;

export interface GameView {
  game: Game;
  author: Author | null;
  health: HealthRecord | null;
  repoStats: RepoRecord | null;
  /** Site-relative URL, e.g. `/media/<id>/cover.webp`, or an absolute URL. */
  coverUrl: string;
  previewUrl: string | null;
  isBroken: boolean;
  embeddable: boolean;
  /** `YYYY-MM-DD` used for "最新" sorting and the featured pick. */
  date: string;
}

export interface SiteData {
  authors: Author[];
  games: GameView[];
  bySlug: Map<string, GameView>;
  byId: Map<string, GameView>;
  authorById: Map<string, Author>;
}

let cached: SiteData | undefined;

export function getSiteData(): SiteData {
  if (cached) return cached;
  const { authors, games, generated } = loadData(DATA_ROOT);
  const authorById = new Map(authors.map((author) => [author.id, author]));
  const views: GameView[] = games.map((game) => {
    const health = generated.health[game.play.url] ?? null;
    const repoStats = game.repo ? (generated.repos[game.repo.url] ?? null) : null;
    return {
      game,
      author: authorById.get(game.author) ?? null,
      health,
      repoStats,
      coverUrl: mediaUrl(game.media.cover) ?? '',
      previewUrl: mediaUrl(game.media.preview),
      isBroken: health?.status === 'broken',
      embeddable: game.play.embeddable,
      date: game.source.published_at ?? game.source.discovered_at,
    };
  });
  views.sort((a, b) => b.date.localeCompare(a.date) || a.game.title.zh.localeCompare(b.game.title.zh, 'zh-CN'));
  cached = {
    authors,
    games: views,
    bySlug: new Map(views.map((view) => [view.game.slug, view])),
    byId: new Map(views.map((view) => [view.game.id, view])),
    authorById,
  };
  return cached;
}

/** Data media paths are relative to the data root (`media/<id>/cover.webp`). */
export function mediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const clean = value.replace(/^\.?\//, '');
  return clean.startsWith('media/') ? `/${clean}` : `/media/${clean}`;
}

/** Lists (home, author, related) hide archived entries and broken links. */
export function isListed(view: GameView): boolean {
  return view.game.status === 'published' && !view.isBroken;
}

export function listedGames(): GameView[] {
  return getSiteData().games.filter(isListed);
}

export function byLatest(a: GameView, b: GameView): number {
  return b.date.localeCompare(a.date) || a.game.title.zh.localeCompare(b.game.title.zh, 'zh-CN');
}

export function latestGames(): GameView[] {
  return listedGames().sort(byLatest);
}

/** The featured hero: the most recent listed game, falling back to any entry. */
export function featuredGame(): GameView | null {
  const listed = listedGames();
  const gamesOnly = listed.filter((view) => view.game.kind === 'game');
  return gamesOnly[0] ?? listed[0] ?? null;
}

export function authorName(view: GameView): string {
  return view.author?.name ?? view.game.author;
}

export function gameTitle(view: GameView): string {
  return view.game.title.zh;
}

export function kindLabel(kind: GameKind): string {
  return kind === 'game' ? '游戏' : '技术演示';
}

export const CONTROL_LABELS: Record<Control, string> = {
  keyboard: '键盘',
  mouse: '鼠标',
  touch: '触屏',
  gamepad: '手柄',
};

export function controlsLabel(controls: Control[]): string {
  return controls.map((control) => CONTROL_LABELS[control]).join('、');
}

export const EVIDENCE_LABELS = {
  L1: '作者自述',
  L2: '有可检查的痕迹',
  L3: '公开了生成过程',
} as const;

export function evidenceLabel(level: 'L1' | 'L2' | 'L3', notes?: string): string {
  return notes ? `证据等级 ${level}（${EVIDENCE_LABELS[level]}）：${notes}` : `证据等级 ${level}（${EVIDENCE_LABELS[level]}）`;
}

export function formatMonthDay(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!month || !day) return '';
  return `${month} 月 ${day} 日`;
}

export function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatDuration(value: number): string {
  return `${value} 分钟`;
}

/** One meta line for a cover: author plus turns/cost when published. */
export function cardMeta(view: GameView): { author: string; extra: string | null } {
  const generation = view.game.generation;
  const extra =
    generation?.turns !== undefined
      ? `${generation.turns} 轮`
      : generation?.cost_usd !== undefined
        ? formatCost(generation.cost_usd)
        : null;
  return { author: authorName(view), extra };
}

export function tagsFor(games: GameView[]): string[] {
  const counts = new Map<string, number>();
  for (const view of games) {
    for (const tag of view.game.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([tag]) => tag);
}

export function sameRepoGames(view: GameView): GameView[] {
  const repoUrl = view.game.repo?.url;
  if (!repoUrl) return [];
  return listedGames()
    .filter((other) => other.game.id !== view.game.id && other.game.repo?.url === repoUrl)
    .sort(byLatest);
}

export function gamesByAuthor(authorId: string): GameView[] {
  return listedGames()
    .filter((view) => view.game.author === authorId)
    .sort(byLatest);
}
