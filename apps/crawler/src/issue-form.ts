/** Parser for GitHub Issue Form bodies (`### Label` sections). */

export interface SubmissionForm {
  onlineUrl: string | null;
  repoUrl: string | null;
  contact: string | null;
  evidence: string | null;
  ownWork: boolean | null;
  /** Raw sections keyed by their heading. */
  sections: Record<string, string>;
}

const NO_RESPONSE = /^_?\s*no response\s*_?$/i;

function clean(value: string): string | null {
  const cleaned = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
  if (cleaned === '' || NO_RESPONSE.test(cleaned)) return null;
  return cleaned;
}

function firstUrl(value: string | null): string | null {
  if (value === null) return null;
  const match = /https?:\/\/[^\s<>()]+/i.exec(value);
  if (match === null) return null;
  return match[0].replace(/[.,;，。；]+$/, '');
}

function parseOwnWork(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (/(^|\n)\s*是|yes|true|本人/.test(normalized)) return true;
  if (/(^|\n)\s*否|no|false|不是/.test(normalized)) return false;
  return null;
}

/**
 * Parse an issue form. Unknown headings are preserved in `sections`.
 * Only the five documented fields are interpreted.
 */
export function parseIssueForm(body: string | null | undefined): SubmissionForm {
  const sections: Record<string, string> = {};
  const text = body ?? '';
  const headingPattern = /^###\s+(.+?)\s*$/gm;
  const matches = [...text.matchAll(headingPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match === undefined || match.index === undefined) continue;
    const label = (match[1] ?? '').trim();
    const contentStart = match.index + match[0].length;
    const next = matches[index + 1];
    const contentEnd = next?.index ?? text.length;
    sections[label] = text.slice(contentStart, contentEnd).trim();
  }

  const find = (...labels: string[]): string | null => {
    for (const label of labels) {
      for (const [key, raw] of Object.entries(sections)) {
        if (key === label || key.includes(label)) {
          const value = clean(raw);
          if (value !== null) return value;
        }
      }
    }
    return null;
  };

  return {
    onlineUrl: firstUrl(find('在线地址', 'online url', 'online')),
    repoUrl: firstUrl(find('仓库地址', 'repo url', 'repository')),
    contact: find('作者联系方式', 'contact'),
    evidence: find('依据', 'evidence'),
    ownWork: parseOwnWork(find('是否本人作品', 'own work')),
    sections,
  };
}
