# UK Website Tenders Tracker

Static site for the quality-checked 2026 UK website tender list.

Data source:
- `data/website_tenders_2026_quality_checked_final.json`
- `data/live_website_opportunities.json`

Automation:
- `.github/workflows/refresh-live-data.yml` refreshes the live feed on a schedule
- `scripts/refresh-live-data.mjs` rebuilds the live feed from the official FTS OCDS API and the verified current seed

Local preview:
```bash
node server.mjs
```
