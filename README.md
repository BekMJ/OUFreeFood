# OU Free Food

Find free food events for OU students across campuses. This is a simple static site you can open locally or host for others.

## Run locally

Because the page fetches `data/events.json`, you need to serve files over HTTP (opening `index.html` directly with `file://` will block the fetch).

Option 1: Python 3

```bash
cd "/Users/npl-weng/Desktop/untitled folder/OUFreeFood"
python3 -m http.server 5173
```

Then open `http://localhost:5173` in your browser.

Option 2: Node (if you have npm)

```bash
npx --yes serve -l 5173 "/Users/npl-weng/Desktop/untitled folder/OUFreeFood"
```

## Add events

- Use the form at the bottom of the page to add events locally. They are stored in your browser (not uploaded) and merged with the sample data.
- To seed permanent events, edit `data/events.json` and reload.

## Filters

- Search text: title, host, description, location
- Campus: Norman, OUHSC, Tulsa, Online
- Category: Breakfast, Lunch, Dinner, Snacks, Pizza, Pantry, Giveaway, Workshop
- Date range: From/To days (inclusive)
- Sort: soonest, latest, recently added

## Future ideas

- Real backend for submissions and moderation
- ICS/Google Calendar export
- Email or SMS notifications
- Accessibility audit and keyboard shortcuts
- Map view and building codes integration

## GitHub Pages + Scheduled scraping

This repo includes a free GitHub Actions workflow that scrapes OU Engage and commits `data/engage.json` on a schedule. The site can then import that cached JSON client-side on GitHub Pages (no server needed).

Setup:
1. Push this project to a GitHub repo.
2. Enable Pages: Settings → Pages → Deploy from a branch → `main` → `/` (root).
3. Actions: ensure Actions are enabled for the repo. The workflow `.github/workflows/scrape-engage.yml` runs every 30 min and on manual dispatch.
4. After the first successful run, `data/engage.json` will exist. Click "Import from Engage" in the site to merge those events.

Notes:
- The scraper is best-effort and may need selector adjustments if Engage changes markup.
- You can tune keywords in `scripts/scrape-engage.mjs`.
- To run locally: `npm i` then `npm run scrape:engage`.



