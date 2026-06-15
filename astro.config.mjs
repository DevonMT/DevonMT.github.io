// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Primary production domain. Used for sitemap, canonical URLs and OG tags.
const SITE = 'https://devontroedel.com';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [
    sitemap({
      // /games is a private, password-gated tool — keep it out of the sitemap.
      filter: (page) => !page.includes('/games'),
    }),
  ],
  // Build to ./dist — this is what gets deployed to GitHub Pages.
  build: {
    format: 'directory',
  },
});
