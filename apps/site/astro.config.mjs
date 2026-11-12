import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mediaIntegration from './src/integrations/media.mjs';
import headersIntegration from './src/integrations/headers.mjs';
import cleanIntegration from './src/integrations/clean.mjs';

// https://astro.build/config
export default defineConfig({
  integrations: [react(), cleanIntegration(), mediaIntegration(), headersIntegration()],
  build: {
    // Keep all CSS in external files so the CSP can use style-src 'self'.
    inlineStylesheets: 'never',
  },
});
