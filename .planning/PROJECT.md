# Project Context

## Product Summary

`OUFreeFood` is a lightweight web app for helping University of Oklahoma students find free food opportunities across campuses. The project currently works as a static site with seeded JSON data, optional browser-local submissions, and an optional scraped cache of public OU Engage events.

The project is optimized for low operational overhead:
- Static frontend only for the main user experience
- No required backend for read access
- GitHub Actions used as the current automation mechanism for data refresh

## Current User Value

The app already supports three useful flows:
- Students can browse and filter upcoming food-related events
- Students can preview their own submissions locally in the browser
- Maintainers can periodically import relevant Engage events without running a server

## Core Goals

Primary goals:
- Make free food opportunities easy to discover quickly
- Keep the product cheap and simple to host
- Support multiple OU campuses in one place
- Allow the data source strategy to evolve without rewriting the UI

Secondary goals:
- Improve event freshness over time
- Reduce manual maintenance for event discovery
- Create a path toward moderated public submissions later

## Non-Goals For The Current Architecture

The current codebase does not try to provide:
- User accounts
- A real submission backend
- Moderation workflows
- Admin tooling
- Strong guarantees about completeness or freshness of imported events

## Audience

Primary audience:
- OU students looking for free meals, snacks, pantry resources, or giveaway events

Secondary audience:
- Student organizations or maintainers who want to surface opportunities to students

## Product Constraints

Operational constraints:
- Static hosting is the default deployment target
- Data needs to be consumable client-side
- Scraping is best-effort and may break when upstream markup changes

Technical constraints:
- The frontend is plain HTML, CSS, and JavaScript with no build step
- Permanent seeded data lives in `data/events.json`
- Imported Engage data is expected in `data/engage.json`
- Local submissions only persist in browser storage

## Current Scope Boundaries

In scope today:
- Event discovery UI
- Filtering and sorting
- Calendar views
- Local preview submissions
- Cached Engage import

Out of scope today:
- Server-side persistence
- Public submission publishing
- Notification systems
- Robust analytics
- Full accessibility audit

## Success Criteria For Near-Term Work

The next iteration should improve these areas first:
- Data freshness and quality
- UX clarity for list and calendar views
- Reliability of event import and deduplication
- Basic testing and regression protection

## Immediate Planning Direction

The best next milestone is to turn the current prototype into a more reliable static product before adding backend complexity. That means prioritizing:
- Better event normalization and deduplication rules
- Better handling for past, ongoing, and malformed events
- Stronger scraper observability and failure visibility
- Lightweight testing around filtering, date handling, and import behavior
