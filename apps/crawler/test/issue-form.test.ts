import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseIssueForm } from '../src/issue-form.js';

const SUBMIT_TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.github/ISSUE_TEMPLATE/submit-game.yml',
);

interface FormField {
  type: string;
  attributes?: {
    label?: string;
    options?: Array<string | { label: string }>;
  };
}

function submitFields(): FormField[] {
  const template = parseYaml(readFileSync(SUBMIT_TEMPLATE, 'utf8')) as { body: FormField[] };
  return template.body;
}

/** Render the body the way GitHub renders an issue form submission. */
function renderSubmitBody(): string {
  const values: Record<string, string> = {
    在线地址: 'https://example.github.io/test-game/',
    仓库地址: 'https://github.com/example/test-game',
    作者联系方式: '@example on GitHub',
    依据: 'README says "made with Fable 5.2".',
    是否本人作品: '是',
  };
  return submitFields()
    .filter((field) => field.type !== 'markdown' && field.attributes?.label !== undefined)
    .map((field) => {
      const label = field.attributes?.label as string;
      if (field.type === 'checkboxes') {
        const options = (field.attributes?.options ?? []).map((option) =>
          typeof option === 'string' ? option : option.label,
        );
        return `### ${label}\n\n${options.map((option) => `- [X] ${option}`).join('\n')}\n`;
      }
      return `### ${label}\n\n${values[label] ?? '_No response_'}\n`;
    })
    .join('\n');
}

const body = `### 在线地址

https://wquguru.github.io/fable52-fps-repro/demos/04-fps/

### 仓库地址

https://github.com/wquguru/fable52-fps-repro

### 作者联系方式

@wquguru on GitHub

### 依据

README says "made with Fable 5.2" and cites claude-fable-5-2 in prompts/.

### 是否本人作品

是
`;

describe('parseIssueForm', () => {
  it('parses all documented fields', () => {
    expect(parseIssueForm(body)).toMatchObject({
      onlineUrl: 'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
      repoUrl: 'https://github.com/wquguru/fable52-fps-repro',
      ownWork: true,
    });
    const parsed = parseIssueForm(body);
    expect(parsed.contact).toContain('@wquguru');
    expect(parsed.evidence).toContain('Fable 5.2');
  });

  it('handles empty optional answers and missing optional sections', () => {
    const parsed = parseIssueForm(
      `### 在线地址\n\nhttps://example.com/game\n\n### 仓库地址\n\n_No response_\n`,
    );
    expect(parsed.onlineUrl).toBe('https://example.com/game');
    expect(parsed.repoUrl).toBeNull();
    expect(parsed.evidence).toBeNull();
    expect(parsed.ownWork).toBeNull();
  });

  it('extracts the first URL from a field with extra text', () => {
    const parsed = parseIssueForm(`### 在线地址\n\nPlay it at https://example.com/game/ now!\n`);
    expect(parsed.onlineUrl).toBe('https://example.com/game/');
  });

  it('parses a negative own-work answer', () => {
    expect(parseIssueForm(`### 是否本人作品\n\n否\n`).ownWork).toBe(false);
    expect(parseIssueForm(`### 是否本人作品\n\nNo\n`).ownWork).toBe(false);
  });

  it('returns empty fields for a null body', () => {
    expect(parseIssueForm(null)).toMatchObject({
      onlineUrl: null,
      repoUrl: null,
      contact: null,
      evidence: null,
      ownWork: null,
    });
  });

  it('parses a body rendered from the real submit-game.yml labels', () => {
    const labels = submitFields()
      .map((field) => field.attributes?.label)
      .filter((label): label is string => label !== undefined);
    expect(labels).toEqual([
      '在线地址',
      '仓库地址',
      '作者联系方式',
      '依据',
      '是否本人作品',
      '确认不是仿冒作品',
    ]);

    expect(parseIssueForm(renderSubmitBody())).toMatchObject({
      onlineUrl: 'https://example.github.io/test-game/',
      repoUrl: 'https://github.com/example/test-game',
      ownWork: true,
    });
  });
});
