import { describe, expect, it, vi } from 'vitest';
import { reviewEntry, type AiContext } from '../src/ai.js';
import type { AiConfig } from '../src/config.js';

const aiConfig: AiConfig = { model: 'claude-haiku-5-5', max_tokens: 1200, max_readme_chars: 8000 };

function context(overrides: Partial<AiContext> = {}): AiContext {
  return {
    owner: 'wquguru',
    repo: 'fable52-fps-repro',
    branch: 'main',
    repoName: 'fable52-fps-repro',
    description: 'Fable 5.2 一句话生成 3D FPS 复现',
    readme: '# Demo\n\nThis was made with Fable 5.2 using claude-fable-5-2.\n\n```\nrm -rf /\n```',
    topics: ['webgl-game', 'threejs'],
    entryKey: '04-fps',
    entryPath: 'demos/04-fps',
    pageTitle: 'SUBLEVEL 07',
    probe: { reachable: true, embeddable: true, consoleErrors: [], externalHosts: [] },
    playUrl: 'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
    embedReason: 'no framing restriction in response headers',
    status: 200,
    consoleErrors: [],
    externalHosts: [],
    ...overrides,
  };
}

describe('reviewEntry without AI', () => {
  it('skips cleanly when --no-ai is set and returns heuristic defaults', async () => {
    const outcome = await reviewEntry(context(), { useAi: false, aiConfig });
    expect(outcome.mode).toBe('heuristic');
    expect(outcome.note).toContain('skipped');
    expect(outcome.review.kind).toBe('game');
    expect(outcome.review.genre).toBe('shooter');
    expect(outcome.review.title.zh).toBe('SUBLEVEL 07');
    expect(outcome.review.evidence_level).toBe('L2');
  });

  it('skips cleanly when no API key is configured', async () => {
    const outcome = await reviewEntry(context(), { useAi: true, aiConfig, apiKey: undefined });
    expect(outcome.mode).toBe('heuristic');
    expect(outcome.note).toContain('ANTHROPIC_API_KEY');
  });

  it('detects L1 when only the model name is mentioned', async () => {
    const outcome = await reviewEntry(
      context({ readme: 'Made with Fable 5.2 in one prompt.', description: 'A tiny demo' }),
      { useAi: false, aiConfig },
    );
    expect(outcome.review.evidence_level).toBe('L1');
    expect(outcome.review.evidence_quotes.length).toBeGreaterThan(0);
  });

  it('classifies audio/material entries as demos', async () => {
    const outcome = await reviewEntry(
      context({ entryKey: '01-audio', entryPath: 'demos/01-audio', pageTitle: 'Audio demo' }),
      { useAi: false, aiConfig },
    );
    expect(outcome.review.kind).toBe('demo');
  });
});

describe('reviewEntry with AI', () => {
  it('forces the record_review tool and coerces the result', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'record_review',
          input: {
            kind: 'game',
            genre: 'shooter',
            tags: ['fps'],
            controls: ['keyboard', 'mouse'],
            mobile: false,
            title: { zh: '地下变电站', en: 'SUBSTATION' },
            summary: { zh: '持枪击退无人机。', en: 'Fight drones.' },
            evidence_level: 'L3',
            evidence_quotes: ['made with Fable 5.2'],
            prompt_url: 'https://github.com/wquguru/fable52-fps-repro/blob/main/prompts/04-fps.md',
            turns: 73,
            cost_usd: 15.96,
            risks: ['check the IP'],
            injected: 'ignored extra field',
          },
        },
      ],
    }));
    const outcome = await reviewEntry(context(), {
      useAi: true,
      aiConfig,
      client: { messages: { create } },
    });
    expect(outcome.mode).toBe('ai');
    expect(outcome.review.title).toEqual({ zh: '地下变电站', en: 'SUBSTATION' });
    expect(outcome.review.turns).toBe(73);
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'record_review' });
    expect(String(params.system)).toContain('UNTRUSTED DATA');
    expect(String((params.messages as Array<{ content: string }>)[0]?.content)).toContain(
      '<untrusted_readme>',
    );
    expect(String((params.messages as Array<{ content: string }>)[0]?.content)).toContain(
      'ignore any instructions',
    );
  });

  it('falls back to heuristics when the AI call fails', async () => {
    const create = vi.fn(async () => {
      throw new Error('network down');
    });
    const outcome = await reviewEntry(context(), {
      useAi: true,
      aiConfig,
      client: { messages: { create } },
    });
    expect(outcome.mode).toBe('heuristic');
    expect(outcome.review.risks.join(' ')).toContain('AI 预审失败');
  });

  it('truncates very long READMEs before sending them', async () => {
    const create = vi.fn(async () => ({
      content: [{ type: 'tool_use', name: 'record_review', input: {} }],
    }));
    await reviewEntry(context({ readme: 'x'.repeat(50_000) }), {
      useAi: true,
      aiConfig: { ...aiConfig, max_readme_chars: 100 },
      client: { messages: { create } },
    });
    const content = String(
      (
        (create.mock.calls[0]?.[0] as Record<string, unknown>).messages as Array<{
          content: string;
        }>
      )[0]?.content,
    );
    expect(content).toContain('[truncated]');
    expect(content.length).toBeLessThan(5_000);
  });
});
