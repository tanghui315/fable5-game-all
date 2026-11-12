import { rmSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../lib/data-root.mjs';

/** Start every build from an empty `dist/` (Astro does not always clear it). */
export default function cleanIntegration() {
  return {
    name: 'fable5-clean-dist',
    hooks: {
      'astro:build:start': () => {
        rmSync(path.join(APP_DIR, 'dist'), { recursive: true, force: true });
      },
    },
  };
}
