import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { APP_DIR, resolveDataRoot } from '../lib/data-root.mjs';

const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif']);

function hasValidSignature(file) {
  const bytes = readFileSync(file).subarray(0, 16);
  const ascii = (start, end) => bytes.toString('ascii', start, end);
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true;
  if (ascii(1, 4) === 'PNG') return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (ascii(4, 8) === 'ftyp') return true;
  return false;
}

async function usableOrPlaceholder(file) {
  if (hasValidSignature(file)) return;
  try {
    await sharp({
      create: {
        width: 800,
        height: 500,
        channels: 3,
        background: { r: 0xd8, g: 0xda, b: 0xd2 },
      },
    })
      .webp({ quality: 80 })
      .toFile(file);
  } catch {
    // Never fail a build because of a placeholder image.
  }
}

/**
 * Recursively copy `media/` from the data root into `public/media` so covers
 * resolve at `/media/<game-id>/cover.webp` in dev and in the production build.
 */
async function copyMediaTree(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyMediaTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    copyFileSync(from, to);
    if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      // Test fixtures ship tiny fake .webp files; unreadable images get a
      // neutral placeholder so local builds do not show broken-image icons.
      await usableOrPlaceholder(to);
    }
  }
}

export default function mediaIntegration() {
  let copying;
  const copy = () => {
    copying ??= (async () => {
      const source = path.join(resolveDataRoot(), 'media');
      const destination = path.join(APP_DIR, 'public', 'media');
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(destination, { recursive: true });
      // Remove media from a previous build so previews never serve stale covers.
      rmSync(path.join(APP_DIR, 'dist', 'media'), { recursive: true, force: true });
      await copyMediaTree(source, destination);
    })();
    return copying;
  };

  return {
    name: 'fable5-media-copy',
    hooks: {
      // `astro preview` also runs config:setup; copying then would delete the built dist/media.
      'astro:config:setup': ({ command }) => (command === 'preview' ? undefined : copy()),
      'astro:server:setup': copy,
    },
  };
}
