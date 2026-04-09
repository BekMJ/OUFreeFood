# Current State

## Repository Snapshot

The repository is a small static web application with one automation script and one scheduled GitHub Actions workflow.

Key files:
- `index.html`: single-page markup for filters, event list, calendar, and submission form
- `styles.css`: all page styling, responsive layout, calendar layout, and theme variables
- `app.js`: application state, data loading, filtering, list rendering, calendar rendering, local submission flow, and theme behavior
- `data/events.json`: seeded permanent event data
- `data/engage.json`: cached scraped event data used by the client import flow
- `scripts/scrape-engage.mjs`: Node script that scrapes OU Engage and emits `data/engage.json`
- `.github/workflows/scrape-engage.yml`: scheduled workflow that runs the scraper and commits updated cache data

## Architecture

### Frontend

The frontend is a vanilla single-page app with global mutable state in `app.js`.

Runtime flow:
1. `DOMContentLoaded` initializes DOM references and event handlers.
2. The app fetches `data/events.json` and merges it with browser-local events from `localStorage`.
3. Filters are applied in memory against the combined dataset.
4. The UI renders either a list, week calendar, or month calendar from the filtered result.
5. Users can optionally import `data/engage.json` into the in-memory event list.

### Data Model

Normalized events currently use:
- `id`
- `title`
- `host`
- `campus`
- `location`
- `description`
- `category`
- `dietary`
- `link`
- `start`
- `end`
- `createdAt`

Normalization rules are permissive:
- Missing IDs are generated client-side
- Missing titles become `Untitled`
- Invalid or missing `start` values are filtered out
- Date strings are converted to ISO strings

### Automation

The scrape pipeline is intentionally simple:
- Scheduled GitHub Action runs every 30 minutes
- The workflow installs dependencies and runs `npm run scrape:engage`
- The scraper fetches OU Engage HTML, extracts event links, parses detail pages, filters by food-related keywords, and writes `data/engage.json`
- The workflow commits the generated file if it changed

## Behavior That Exists Today

Implemented features:
- Text search across title, host, description, and location
- Campus filter
- Category filter
- Inclusive date range filter
- Sort by soonest, latest, or recently added
- List view
- Week calendar view
- Month calendar view
- Theme toggle with local persistence
- Local-only event submission form
- Local submission clearing
- Import button for cached Engage events

## Key Technical Observations

Strengths:
- Very small surface area and low hosting complexity
- No build tool or framework overhead
- Clear separation between seeded data and scraped data
- Easy to run locally

Weak spots:
- `app.js` is monolithic and mixes state management, filtering, rendering, utilities, and theme logic
- No automated tests
- No linting or formatting enforcement
- No schema validation for JSON event data
- No observability for scraper failures besides workflow logs
- Local submissions are not shared across users

## Product Risks

### Data Reliability

The biggest product risk is incomplete or stale event data.

Reasons:
- The seeded dataset is manual
- The scraper uses heuristic selectors and keyword filtering
- `data/engage.json` may legitimately be empty
- Client import requires the user to click a button rather than happening automatically

### UX Clarity

Potential UX friction:
- Users may assume submitted events are public when they are only local
- The import action is optional and may be confusing if no cached data exists yet
- Calendar interactions are read-only and less informative than the list view

### Maintainability

The current size is manageable, but growth will make `app.js` harder to change safely because:
- Business rules are embedded in UI code
- Date logic is distributed across render and filter functions
- There is no regression suite to protect refactors

## Recommended Technical Direction

Short-term:
- Keep the static architecture
- Improve confidence in data quality and UI behavior
- Add tests before larger refactors

Medium-term:
- Split `app.js` into focused modules if the project continues growing
- Add a lightweight validation layer for event data
- Improve scraper resilience and reporting

Long-term:
- Introduce a backend only if moderated shared submissions or notifications become a real requirement

## Open Questions

Questions that should shape the next milestone:
- Should Engage events auto-merge on load once `data/engage.json` exists?
- Should event categories be inferred automatically from descriptions and titles?
- Is the project primarily a static directory of known events, or should it become a submission-driven product?
- What level of freshness is acceptable for students relying on the listings?
