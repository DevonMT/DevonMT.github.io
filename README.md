# devontroedel.com

Personal website for Devon Troedel — software developer. Built with [Astro](https://astro.build),
styled with a minimal dark + teal theme, and deployed to GitHub Pages on every push to `main`.

## Status

**Task 1 complete** — deployable "coming soon" landing page (hero, tagline, links, SEO meta, JSON-LD).

## Tech stack

- **Astro 4** — static site generation, zero JS by default
- **Vanilla CSS** with design tokens (`src/styles/variables.css`)
- **@astrojs/sitemap** — sitemap generated at build
- Markdown blog (added in a later task)
- **GitHub Pages** hosting with custom domain

## Local development

> Requires **Node.js 18+** and npm. Install Node from https://nodejs.org if it isn't on this machine.

```bash
npm install      # install dependencies (generates package-lock.json)
npm run dev      # start dev server at http://localhost:4321
npm run build    # type-check + build static site to ./dist
npm run preview  # preview the production build locally
```

## Project structure

```
src/
  components/        reusable .astro components (Header, Footer, cards — added later)
  layouts/
    BaseLayout.astro  <head>, SEO meta, OG tags, JSON-LD, font loading
  pages/
    index.astro       home / landing page
  styles/
    variables.css     design tokens (colors, spacing, fonts)
    global.css        global styles + UI primitives (.btn, .tag, .section)
public/
  CNAME             custom domain for GitHub Pages (devontroedel.com)
  favicon.svg       site icon
  robots.txt        crawl directives + sitemap pointer
.github/workflows/
  deploy.yml        CI: build + deploy to GitHub Pages
```

## Deployment

1. Create a GitHub repo (e.g. `devontroedel.github.io` or any repo with Pages enabled).
2. In **Settings → Pages**, set **Source = GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and deploys automatically.
4. Configure DNS for `devontroedel.com`:
   - Apex `A` records → GitHub Pages IPs (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`), **or**
   - `CNAME` for `www` → `<username>.github.io`
5. Verify: open https://devontroedel.com and run `nslookup devontroedel.com` to confirm DNS.

The `public/CNAME` file tells GitHub Pages which custom domain to serve.

## Design tokens

| Token | Value | Use |
|-------|-------|-----|
| `--color-bg` | `#0a0e27` | near-black background |
| `--color-accent` | `#14b8a6` | teal accent (links, highlights) |
| `--font-sans` | Inter | body text |
| `--font-mono` | JetBrains Mono | code & accents |
