# UK Website Tenders Tracker

Static site for the quality-checked 2026 UK website tender list.

Data source:
- `data/website_tenders_2026_quality_checked_final.json`
- `data/live_website_opportunities.json`
- `data/fts_search_discovery.json`

Automation:
- `.github/workflows/refresh-live-data.yml` refreshes the live feed from the official FTS OCDS API on GitHub-hosted runners
- `.github/workflows/discover-fts-search.yml` runs Playwright search discovery on a self-hosted runner, then merges the discovered notice IDs into the live feed
- `scripts/discover-fts-search.mjs` searches the live FTS UI for website-related terms and stores deduped candidate IDs
- `scripts/refresh-live-data.mjs` rebuilds the live feed from the official FTS OCDS API, the verified current seed, and persisted FTS search discoveries

Setup for the self-hosted discovery runner:
```bash
npm install
npx playwright install chromium
```

Useful commands:
```bash
npm run discover:fts
npm run refresh:live
npm run refresh:full
```

Notes:
- the Playwright discovery workflow is meant for a self-hosted runner because the FTS search UI is more likely to rate-limit or block browser automation on shared hosted runners
- the GitHub-hosted refresh workflow stays useful because it can keep merging previously discovered notice IDs even when the Playwright job is not running

Local preview:
```bash
node server.mjs
```
