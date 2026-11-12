import { cpSync, mkdirSync, mkdtempSync, rmSync, truncateSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COVER_MAX_BYTES,
  PREVIEW_MAX_BYTES,
  validateData,
  type ValidationResult,
} from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const tempBase = path.join(here, '.tmp');
const validCover = path.join(
  'media',
  'wquguru--fable52-fps-repro--04-fps',
  'cover.webp',
);
const validPreview = path.join(
  'media',
  'wquguru--fable52-fps-repro--04-fps',
  'preview.webp',
);

function copyFixture(name: string): string {
  mkdirSync(tempBase, { recursive: true });
  const target = mkdtempSync(path.join(tempBase, `${name}-`));
  cpSync(path.join(fixtures, name), target, { recursive: true });
  return target;
}

function messages(result: ValidationResult): string {
  return result.errors.map((issue) => `${issue.file}: ${issue.message}`).join('\n');
}

async function runFixture(
  name: string,
  options: Omit<Parameters<typeof validateData>[0], 'rootDir'> = {},
): Promise<ValidationResult> {
  return validateData({ rootDir: copyFixture(name), ...options });
}

afterEach(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('validateData', () => {
  it('passes on an empty data dir', async () => {
    const result = await runFixture('empty');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.games).toBe(0);
  });

  it('passes on a valid dataset', async () => {
    const result = await runFixture('valid');
    expect(messages(result)).toBe('');
    expect(result.ok).toBe(true);
    expect(result.games).toBe(1);
    expect(result.authors).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it('reports schema errors with field paths', async () => {
    const result = await runFixture('schema-error');
    const text = messages(result);
    expect(result.ok).toBe(false);
    expect(text).toContain('slug');
    expect(text).toContain('kind');
    expect(text).toContain('model.name');
    expect(text).toContain('controls.1');
  });

  it('reports duplicate game ids', async () => {
    const result = await runFixture('duplicate-id');
    expect(messages(result)).toContain('duplicate game id "dup--repo--entry"');
  });

  it('reports duplicate slugs', async () => {
    const result = await runFixture('duplicate-slug');
    expect(messages(result)).toContain('duplicate slug "same-slug"');
  });

  it('reports an unknown author', async () => {
    const result = await runFixture('missing-author');
    expect(messages(result)).toContain('author "ghost-author" not found');
  });

  it('reports missing media files', async () => {
    const result = await runFixture('missing-media');
    const text = messages(result);
    expect(text).toContain('cover file not found: media/nomedia--repo--entry/cover.webp');
    expect(text).toContain('preview file not found: media/nomedia--repo--entry/preview.webp');
  });

  it('reports a cover larger than 150 KB', async () => {
    const root = copyFixture('valid');
    truncateSync(path.join(root, validCover), COVER_MAX_BYTES + 1);
    const result = await validateData({ rootDir: root });
    expect(messages(result)).toContain('cover file');
    expect(messages(result)).toContain('max 150.0 KB');
  });

  it('reports a preview larger than 1 MB', async () => {
    const root = copyFixture('valid');
    truncateSync(path.join(root, validPreview), PREVIEW_MAX_BYTES + 1);
    const result = await validateData({ rootDir: root });
    expect(messages(result)).toContain('preview file');
    expect(messages(result)).toContain('max 1.00 MB');
  });

  it('reports a file name that does not match the id', async () => {
    const result = await runFixture('filename-mismatch');
    expect(messages(result)).toContain('file name must be "mismatch--repo--entry.yaml"');
  });

  it('reports an invalid rejected reason', async () => {
    const result = await runFixture('invalid-rejected');
    expect(messages(result)).toContain('reason');
  });

  it('reports invalid generated data', async () => {
    const result = await runFixture('invalid-generated');
    expect(messages(result)).toContain('checked_at');
  });

  describe('--online', () => {
    const fetchOk: typeof fetch = async () => new Response('', { status: 200 });

    it('passes when play.url returns 2xx', async () => {
      const result = await runFixture('valid', { online: true, fetchImpl: fetchOk });
      expect(result.ok).toBe(true);
    });

    it('reports a non-2xx/3xx play.url', async () => {
      const fetchNotFound: typeof fetch = async () => new Response('', { status: 404 });
      const result = await runFixture('valid', { online: true, fetchImpl: fetchNotFound });
      expect(result.ok).toBe(false);
      expect(messages(result)).toContain('play.url');
      expect(messages(result)).toContain('HTTP 404');
    });

    it('falls back to GET when HEAD is rejected', async () => {
      const calls: string[] = [];
      const fetchHeadRejected: typeof fetch = async (_input, init) => {
        const method = init?.method ?? 'GET';
        calls.push(method);
        return new Response('', { status: method === 'HEAD' ? 405 : 200 });
      };
      const result = await runFixture('valid', { online: true, fetchImpl: fetchHeadRejected });
      expect(result.ok).toBe(true);
      expect(calls).toEqual(['HEAD', 'GET']);
    });

    it('returns 3xx as reachable', async () => {
      const fetchRedirect: typeof fetch = async () => new Response('', { status: 302 });
      const result = await runFixture('valid', { online: true, fetchImpl: fetchRedirect });
      expect(result.ok).toBe(true);
    });
  });
});
