import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'hero');

/** `data.ts` caches its dataset per module instance, so reset between roots. */
async function loadDataModule(root: string): Promise<typeof import('../src/lib/data')> {
  process.env.DATA_ROOT = root;
  vi.resetModules();
  return import('../src/lib/data');
}

describe('heroSlides', () => {
  afterAll(() => {
    delete process.env.DATA_ROOT;
  });

  it('follows the curated order and skips ids it cannot show', async () => {
    // The fixture lists alpha, an unknown id, gamma (no preview) and delta.
    const { heroSlides } = await loadDataModule(fixture);
    expect(heroSlides().map((view) => view.game.id)).toEqual([
      'alpha--repo--one',
      'delta--repo--four',
    ]);
  });

  it('respects the slide limit', async () => {
    const { heroSlides } = await loadDataModule(fixture);
    expect(heroSlides(1).map((view) => view.game.id)).toEqual(['alpha--repo--one']);
  });

  it('fills with the newest previews when the file is empty', async () => {
    const tempBase = path.join(here, '.tmp');
    mkdirSync(tempBase, { recursive: true });
    const root = mkdtempSync(path.join(tempBase, 'hero-'));
    cpSync(fixture, root, { recursive: true });
    rmSync(path.join(root, 'data', 'featured.yaml'));
    try {
      const { heroSlides } = await loadDataModule(root);
      // Archived entries and entries without a preview never rotate.
      expect(heroSlides().map((view) => view.game.id)).toEqual([
        'beta--repo--two',
        'delta--repo--four',
        'alpha--repo--one',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
