import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { encodeCover, makeFallbackCover, screenshotStats } from '../src/probe.js';
import type { ProbeConfig } from '../src/config.js';

const config: ProbeConfig = {
  viewport_width: 1280,
  viewport_height: 800,
  cover_max_bytes: 150 * 1024,
  cover_quality: 82,
  navigation_timeout_ms: 30_000,
  min_render_wait_ms: 4_000,
  max_render_wait_ms: 25_000,
};

async function noisyScreenshot(): Promise<Buffer> {
  const width = 1280;
  const height = 800;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 37) % 256;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('encodeCover', () => {
  it('produces a 1280x800 WebP under the 150 KB cap even for noisy images', async () => {
    const cover = await encodeCover(await noisyScreenshot(), config);
    expect(cover.length).toBeLessThanOrEqual(config.cover_max_bytes);
    const metadata = await sharp(cover).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(800);
  });
});

describe('screenshotStats', () => {
  it('detects a black frame and a bright frame', async () => {
    const black = await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const bright = await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 200, g: 180, b: 140 } },
    })
      .png()
      .toBuffer();
    expect((await screenshotStats(black)).nonBlack).toBe(false);
    expect((await screenshotStats(bright)).nonBlack).toBe(true);
  });
});

describe('makeFallbackCover', () => {
  it('renders a valid placeholder cover', async () => {
    const cover = await makeFallbackCover('Entry', config, 'unreachable');
    expect(cover.length).toBeGreaterThan(0);
    expect(cover.length).toBeLessThanOrEqual(config.cover_max_bytes);
    const metadata = await sharp(cover).metadata();
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(800);
  });
});
