import { describe, expect, it } from 'vitest';
import { parseIssueForm } from '../src/issue-form.js';

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
});
