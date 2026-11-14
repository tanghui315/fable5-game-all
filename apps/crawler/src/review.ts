/** Markdown review report used as the candidate PR body. */

import type { EntryReview } from './heuristics.js';
import type { ProbeResult } from './probe.js';
import type { GameDraft } from './draft.js';

export interface ReviewEntry {
  entryKey: string;
  path: string;
  playUrl: string;
  probe: ProbeResult;
  review: EntryReview;
  draft: GameDraft;
  reviewMode: 'ai' | 'heuristic';
  note: string | null;
}

export interface ReviewReportInput {
  owner: string;
  repo: string;
  repoUrl: string | null;
  description: string | null;
  stars: number | null;
  license: string | null;
  entries: readonly ReviewEntry[];
  /** Entries that were probed but never reached; listed, never written. */
  excluded?: readonly ReviewEntry[];
  issueNumber?: number | null;
  generatedAt?: Date;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function code(value: string): string {
  return `\`${value.replace(/`/g, '')}\``;
}

/** Evidence quotes are untrusted README text: keep them inert in Markdown. */
export function escapeUntrusted(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/`/g, '&#96;');
}

export function buildReviewMarkdown(input: ReviewReportInput): string {
  const lines: string[] = [];
  const repoLabel = input.repoUrl ?? `${input.owner}/${input.repo}`;
  lines.push(`# Crawler review: ${repoLabel}`);
  lines.push('');
  lines.push(
    `生成时间 ${(input.generatedAt ?? new Date()).toISOString()} · 入口 ${input.entries.length} 个 · ` +
      `星标 ${input.stars ?? '—'} · 协议 ${input.license ?? '—'}`,
  );
  lines.push('');
  lines.push('> 自动生成，仅供参考。合并前请人工核对标题、证据等级、可玩性和风险。');
  lines.push('');
  if (input.description !== null && input.description.trim() !== '') {
    lines.push(`仓库描述：${input.description.trim()}`);
    lines.push('');
  }

  lines.push('| 入口 | kind | 可玩 | 可嵌入 | 证据 | cover |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of input.entries) {
    const draft = item.draft;
    lines.push(
      `| ${code(item.entryKey)} | ${escapeCell(draft.game.kind)} | ` +
        `${item.probe.reachable ? '是' : '否'} | ${draft.game.play.embeddable ? '是' : '否'} | ` +
        `${draft.game.model.evidence} | ${code(draft.coverPath)} |`,
    );
  }
  lines.push('');

  for (const item of input.entries) {
    const { draft, probe, review } = item;
    lines.push(`## ${review.title.zh} (${item.entryKey})`);
    lines.push('');
    lines.push(`- 草稿：${code(`data/games/${draft.id}.yaml`)}（slug ${code(draft.slug)}）`);
    lines.push(`- 在线地址：${item.playUrl}`);
    lines.push(`- 入口路径：${code(item.path || '.')}`);
    lines.push(
      `- 探测：HTTP ${probe.status ?? '—'} · ${
        probe.reachable ? '可访问' : '不可访问'
      } · 可嵌入 ${probe.embeddable ? '是' : '否'}（${probe.embedReason}）`,
    );
    lines.push(`- 证据等级：${review.evidence_level}`);
    lines.push('');
    lines.push(`![cover for ${item.entryKey}](${draft.coverPath})`);
    lines.push('');
    if (review.evidence_quotes.length > 0) {
      lines.push('证据引用：');
      for (const quote of review.evidence_quotes) lines.push(`> ${escapeUntrusted(quote)}`);
      lines.push('');
    }
    if (
      review.prompt_url !== undefined ||
      review.turns !== undefined ||
      review.cost_usd !== undefined ||
      review.duration_min !== undefined
    ) {
      lines.push(
        `生成数据：${[
          review.prompt_url !== undefined ? `提示词 ${review.prompt_url}` : null,
          review.turns !== undefined ? `${review.turns} 轮` : null,
          review.cost_usd !== undefined ? `$${review.cost_usd}` : null,
          review.duration_min !== undefined ? `${review.duration_min} 分钟` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}`,
      );
      lines.push('');
    }
    if (review.risks.length > 0) {
      lines.push('风险：');
      for (const risk of review.risks) lines.push(`- ${escapeUntrusted(risk)}`);
      lines.push('');
    }
    if (probe.consoleErrors.length > 0) {
      lines.push(`控制台错误（${probe.consoleErrors.length}）：`);
      for (const error of probe.consoleErrors.slice(0, 8))
        lines.push(`- ${code(error.slice(0, 200))}`);
      lines.push('');
    }
    if (probe.externalHosts.length > 0) {
      lines.push(`外部请求域名：${probe.externalHosts.slice(0, 20).map(code).join(', ')}`);
      lines.push('');
    }
    if (item.note !== null) {
      lines.push(`> ${item.note}`);
      lines.push('');
    }
  }

  const excluded = input.excluded ?? [];
  if (excluded.length > 0) {
    lines.push('## 已排除');
    lines.push('');
    lines.push('以下入口探测不可达，没有写进这个 PR：');
    lines.push('');
    for (const item of excluded) {
      lines.push(
        `- ${code(item.path || '.')} · ${code(item.playUrl)} · HTTP ${item.probe.status ?? '—'}`,
      );
    }
    lines.push('');
  }

  const notes = input.entries
    .map((item) => item.note)
    .filter((note): note is string => note !== null);
  lines.push('## 预审说明');
  lines.push('');
  const aiEntries = input.entries.filter((item) => item.reviewMode === 'ai').length;
  lines.push(
    `- AI 预审：${aiEntries}/${input.entries.length} 个入口使用模型判断；其余使用启发式默认值。`,
  );
  if (notes.length > 0) {
    lines.push(`- ${[...new Set(notes)].join(' ')}`);
  }
  lines.push('- README 作为不可信数据输入；AI 没有工具权限，结果只出现在本报告里。');
  lines.push('- 本 PR 不会自动合并；请按 `docs/design.md` §2.3 的收录标准人工审核。');
  lines.push('');
  if (input.issueNumber !== undefined && input.issueNumber !== null) {
    lines.push(`Closes #${input.issueNumber}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
