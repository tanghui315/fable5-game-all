/** Deterministic fallback when the AI review is unavailable. */

import type { Control, EvidenceLevel, GameKind } from '@fable5/schema';
import type { ProbeResult } from './probe.js';
import { dedupeStrings, slugify } from './util.js';

export interface LocalizedDraft {
  zh: string;
  en?: string;
}

export interface EntryReview {
  kind: GameKind | 'not-game';
  genre: string;
  tags: string[];
  controls: Control[];
  mobile: boolean;
  title: LocalizedDraft;
  summary: LocalizedDraft;
  evidence_level: EvidenceLevel;
  evidence_quotes: string[];
  prompt_url?: string;
  turns?: number;
  cost_usd?: number;
  duration_min?: number;
  risks: string[];
}

export interface HeuristicContext {
  owner: string;
  repo: string;
  branch: string;
  repoName: string;
  description: string | null;
  readme: string | null;
  topics: readonly string[];
  entryKey: string;
  entryPath: string;
  pageTitle: string | null;
  probe: Pick<ProbeResult, 'reachable' | 'embeddable' | 'consoleErrors' | 'externalHosts'>;
  promptCandidates?: readonly string[];
  /** Extra evidence text from a submission issue. */
  submissionEvidence?: string | null;
}

const MODEL_ID = /claude-fable-5-(\d+(?:[.-]\d+)*)/i;
const FABLE_VERSION = /fable[ -]?5[.\s-](\d+(?:[.-]\d+)*)/i;
const GAME_WORDS =
  /\b(fps|shooter|platformer|puzzle|rogue(?:lite)?|runner|racer|racing|rpg|game|games)\b/i;
const SUSPICIOUS_IP =
  /\b(minecraft|mario|pokemon|zelda|doom|halo|fortnite|among us|tetris|pac-?man|sonic|star wars|marvel|disney)\b/i;
const SUSPICIOUS_HOSTS = /(coinhive|cryptonight|miner|mining|coin-hive)/i;

export function detectModelName(text: string): string {
  const id = MODEL_ID.exec(text);
  if (id?.[1] !== undefined) return `fable-5.${id[1].replace(/-/g, '.')}`;
  const version = FABLE_VERSION.exec(text);
  if (version?.[1] !== undefined) return `fable-5.${version[1].replace(/[.-]/g, '.')}`;
  return 'fable-5.2';
}

export function detectEvidence(text: string): EvidenceLevel {
  if (MODEL_ID.test(text)) return 'L2';
  if (FABLE_VERSION.test(text) || /\bfable-5\b/i.test(text)) return 'L1';
  return 'L1';
}

/** Up to three short lines that mention the model, used as evidence quotes. */
export function extractEvidenceQuotes(text: string, limit = 3): string[] {
  const quotes: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s#>*_-]+/, '').trim();
    if (line.length < 6 || line.length > 240) continue;
    if (!/fable/i.test(line) && !MODEL_ID.test(line)) continue;
    quotes.push(line);
    if (quotes.length >= limit) break;
  }
  return dedupeStrings(quotes);
}

function detectKind(entryText: string, descriptionText: string): GameKind | 'not-game' {
  if (/\b(not[- ]a[- ]game|library|sdk|toolkit|documentation)\b/i.test(entryText))
    return 'not-game';
  // The entry name/page title is stronger evidence than the repository blurb.
  if (
    /\b(audio|sound|music|material|materials|model|models|shader|demo|visual|tech)\b/i.test(
      entryText,
    )
  ) {
    return 'demo';
  }
  if (GAME_WORDS.test(entryText)) return 'game';
  return GAME_WORDS.test(descriptionText) ? 'game' : 'demo';
}

function detectGenre(
  entryText: string,
  descriptionText: string,
  kind: GameKind | 'not-game',
): string {
  const entryGenre = (text: string): string | null => {
    if (/\baudio|sound|music\b/i.test(text)) return 'audio-demo';
    if (/\bmaterial|materials|shader|lighting\b/i.test(text)) return 'graphics-demo';
    if (/\bmodel|models|asset|procedural\b/i.test(text)) return 'procedural-demo';
    if (/\bfps\b|first[- ]person/i.test(text)) return 'shooter';
    if (/\bracing|racer|driving\b/i.test(text)) return 'racing';
    if (/\bpuzzle\b/i.test(text)) return 'puzzle';
    if (/\bplatformer|jump/i.test(text)) return 'platformer';
    if (/\brpg|role[- ]playing/i.test(text)) return 'rpg';
    return null;
  };
  return (
    entryGenre(entryText) ??
    entryGenre(descriptionText) ??
    (kind === 'game' ? 'arcade' : 'tech-demo')
  );
}

function splitSummary(description: string): { zh: string; en?: string } {
  const parts = description.split(/\s+\/\s+/);
  if (parts.length >= 2) {
    const zh = (parts[0] ?? '').trim();
    const en = parts.slice(1).join(' / ').trim();
    if (zh !== '') return { zh, ...(en !== '' ? { en } : {}) };
  }
  return { zh: description.trim() };
}

/** Pick the prompt file most closely matching the entry. */
export function pickPromptUrl(
  candidates: readonly string[],
  owner: string,
  repo: string,
  branch: string,
  entryKey: string,
): string | undefined {
  const files = candidates.filter((file) => /\.(md|txt|markdown)$/i.test(file));
  if (files.length === 0) return undefined;
  const scored = files
    .map((file) => {
      let score = 0;
      const lower = file.toLowerCase();
      if (lower.includes(entryKey.toLowerCase())) score += 4;
      if (/prompt/i.test(lower)) score += 2;
      if (lower.includes('readme')) score -= 3;
      return { file, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best === undefined) return undefined;
  return `https://github.com/${owner}/${repo}/blob/${branch}/${best.file}`;
}

export function heuristicReview(context: HeuristicContext): EntryReview {
  const evidenceText = [
    context.description ?? '',
    context.readme ?? '',
    context.submissionEvidence ?? '',
  ].join('\n');
  const haystack = [
    context.entryKey,
    context.entryPath,
    context.pageTitle ?? '',
    context.description ?? '',
    (context.readme ?? '').slice(0, 8_000),
  ].join('\n');

  const entryText = `${context.entryKey} ${context.entryPath} ${context.pageTitle ?? ''}`;
  const kind = detectKind(entryText, `${context.description ?? ''} ${context.repoName}`);
  const titleText = (context.pageTitle ?? '').trim();
  const fallbackTitle = context.entryKey === 'root' ? context.repoName : context.entryKey;
  const title = titleText !== '' && titleText.length <= 90 ? titleText : fallbackTitle;
  const summaryParts =
    context.description !== null && context.description.trim() !== ''
      ? splitSummary(context.description)
      : { zh: `Fable 5.x 网页作品：${title}` };
  const summary: LocalizedDraft = {
    zh: summaryParts.zh,
    ...(summaryParts.en !== undefined && /[a-z]/i.test(summaryParts.en)
      ? { en: summaryParts.en }
      : {}),
  };
  const tags = dedupeStrings([
    ...context.topics.map((topic) => slugify(topic, 'topic', 30)),
    ...context.entryKey.split('-').filter((part) => part.length > 1),
    ...(kind === 'game' ? ['game'] : ['demo']),
  ]).slice(0, 10);

  const risks: string[] = [];
  if (!MODEL_ID.test(evidenceText) && !FABLE_VERSION.test(evidenceText)) {
    risks.push('README 与描述里没有明确的 Fable 5.x 证据，需要人工确认（暂按 L1）。');
  }
  if (!context.probe.reachable) risks.push('Playwright 探测未能访问该入口。');
  if (context.probe.reachable && !context.probe.embeddable) {
    risks.push('响应头禁止跨域 iframe 嵌入，只能“新窗口打开”。');
  }
  if (context.probe.consoleErrors.length > 0) {
    risks.push(`探测发现 ${context.probe.consoleErrors.length} 条控制台错误。`);
  }
  if (context.probe.externalHosts.some((host) => SUSPICIOUS_HOSTS.test(host))) {
    risks.push('外部请求域名中出现疑似挖矿服务。');
  }
  if (SUSPICIOUS_IP.test(haystack)) risks.push('标题/简介疑似引用现有商业游戏 IP，请人工核对。');

  const promptUrl = pickPromptUrl(
    context.promptCandidates ?? [],
    context.owner,
    context.repo,
    context.branch,
    context.entryKey,
  );

  return {
    kind,
    genre: detectGenre(entryText, haystack, kind),
    tags,
    controls: kind === 'game' ? ['keyboard', 'mouse'] : ['mouse'],
    mobile: /\b(mobile|touch|phone|responsive)\b/i.test(haystack),
    title: { zh: title, ...(/[a-z]/i.test(title) ? { en: title } : {}) },
    summary,
    evidence_level: detectEvidence(evidenceText),
    evidence_quotes: extractEvidenceQuotes(evidenceText),
    ...(promptUrl !== undefined ? { prompt_url: promptUrl } : {}),
    risks,
  };
}
