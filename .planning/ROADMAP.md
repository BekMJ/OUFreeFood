# Roadmap

## Planning Principle

Prioritize reliability and clarity before adding new platform complexity. The current architecture can go further if data quality, UX communication, and testing improve first.

## Phase 1: Data Quality And Event Confidence

Goal:
Make the event dataset more trustworthy without changing the hosting model.

Scope:
- Add validation for required event fields and malformed dates
- Improve deduplication across seeded, local, and Engage-imported events
- Refine campus and category inference rules
- Remove or clearly label stale and past events
- Improve messaging when Engage import is empty or outdated

Success criteria:
- Invalid events are rejected or surfaced clearly
- Duplicate events do not appear in normal use
- Users can tell whether imported data is fresh enough to trust

## Phase 2: UX And Information Architecture

Goal:
Make event discovery faster and reduce ambiguity in the UI.

Scope:
- Clarify the difference between seeded data, imported data, and local-only submissions
- Improve empty states and error states
- Make calendar views more useful and navigable
- Tighten mobile layout and readability
- Improve accessibility for forms, filters, and keyboard use

Success criteria:
- Users understand what data is public versus local
- Mobile browsing remains comfortable for common flows
- Core interactions are accessible with keyboard and screen reader support

## Phase 3: Codebase Hardening

Goal:
Reduce regression risk and make future changes cheaper.

Scope:
- Extract filtering, normalization, and date helpers from `app.js`
- Add lightweight automated tests for normalization, filtering, and calendar calculations
- Add basic project scripts for validation or checks
- Document the expected event schema near the data source

Success criteria:
- Core data behavior is covered by tests
- Major logic is no longer buried in a single script file
- Contributors can validate changes before shipping

## Phase 4: Automation And Content Pipeline

Goal:
Make imported event coverage more reliable and maintainable.

Scope:
- Improve scraper selectors and parsing fallbacks
- Capture scrape metadata such as last-updated timestamp and source count
- Decide whether Engage import should become automatic on page load
- Add failure visibility for GitHub Actions runs

Success criteria:
- Maintainers can tell when the scraper failed or produced suspicious output
- Imported events feel predictable rather than experimental

## Phase 5: Shared Submissions And Moderation

Goal:
Only pursue this if the product proves useful enough to justify backend complexity.

Scope:
- Introduce a real submission endpoint
- Add moderation workflow
- Add admin review tooling
- Decide publishing and abuse-prevention rules

Success criteria:
- Public submissions can be reviewed safely before appearing
- The project can scale beyond one maintainer editing JSON files

## Suggested Immediate Next Task

If work starts now, the highest-value next implementation slice is:
- Phase 1 first

Suggested ticket sequence:
1. Define and document the event schema used by the app and scraper
2. Improve deduplication and invalid-date handling in `app.js`
3. Add small tests for normalization, filtering, and date range logic
4. Improve the UI copy around local submissions and Engage import freshness
