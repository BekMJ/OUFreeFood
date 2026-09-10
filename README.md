# OU Free Food

A web app that helps University of Oklahoma students find free food events across campus.
Zero-maintenance by design: a static front end on GitHub Pages, with a scheduled GitHub
Actions job that refreshes event data on its own.

**Live site:** https://bekmj.github.io/OUFreeFood/

## How it works

There's no server and no database. Instead:

1. A **GitHub Actions workflow** (`.github/workflows/scrape-engage.yml`) runs every 30 minutes,
   pulls the public OU Engage RSS feed, classifies which events actually involve free food,
   and commits the result to `data/engage.json`.
2. The **static site** on GitHub Pages fetches that JSON client-side and renders it.
3. The workflow also writes `data/engage-meta.json` with scrape timestamps, event counts, and
   an error summary, so a broken selector is visible instead of silently returning nothing.

Total hosting cost is nothing, and there's no server to keep alive — which is the reason for
the architecture, since this had to keep running without anyone maintaining it.

## Features

- **Calendar views** — list, week, and month.
- **Filtering** — full-text search across title, host, description, and location; filter by
  campus (Norman, OUHSC, Tulsa, Online), by category (Breakfast, Lunch, Dinner, Snacks, Pizza,
  Pantry, Giveaway, Workshop), and by date range.
- **Sorting** — soonest, latest, or recently added.
- **Local event submission** — users can add events from the page; these stay in their browser
  and merge with the shared data rather than being uploaded.
- **Engage import** — one click merges the latest scraped events into the view.

## Stack

Vanilla JavaScript, HTML, and CSS on the front end — no framework, which keeps the Pages
deploy trivial. The scraper is Node (ESM) using `cheerio` and `node-fetch`.

## Run locally

The page fetches `data/events.json`, so it needs to be served over HTTP — opening
`index.html` as a `file://` URL will block the fetch.

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

Or with Node:

```bash
npx --yes serve -l 5173 .
```

To run the scraper locally:

```bash
npm install
npm run scrape:engage
```

## Deploying your own

1. Fork or push to a GitHub repo.
2. Settings → Pages → Deploy from a branch → `main` → `/` (root).
3. Make sure Actions are enabled. The workflow also runs on manual dispatch.
4. After the first successful run, `data/engage.json` exists and "Import from Engage" works.

## Data and scope

The scraper reads only **public** OU Engage data via the public RSS feed and embedded event
content. It does not use an OU login or any private credential. The only secret in the workflow
is GitHub's own `GITHUB_TOKEN`, used solely to commit refreshed data back to the repo.

Event shape and date requirements are documented in `data/EVENT_SCHEMA.md` — read it before
editing seeded data in `data/events.json`.

Classification heuristics and food-signal keywords live in `scripts/scrape-engage.mjs` and are
best-effort; they may need adjustment if Engage changes its markup.

## Roadmap

- Backend for submissions and moderation
- ICS / Google Calendar export
- Email or SMS notifications
- Map view with building code integration
- Accessibility audit and keyboard shortcuts
