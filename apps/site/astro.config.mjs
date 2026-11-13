import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mediaIntegration from './src/integrations/media.mjs';
import headersIntegration from './src/integrations/headers.mjs';
import cleanIntegration from './src/integrations/clean.mjs';
import sitemapIntegration from './src/integrations/sitemap.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://stubhall.com',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      // English is the default and lives at `/`; Chinese is mirrored under `/zh/`.
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    react(),
    cleanIntegration(),
    mediaIntegration(),
    headersIntegration(),
    sitemapIntegration(),
  ],
  build: {
    // Keep all CSS in external files so the CSP can use style-src 'self'.
    inlineStylesheets: 'never',
  },
});
