# Phase 1 Plan: Data Quality And Event Confidence

## Goal

Make the event dataset more trustworthy without changing the static hosting model.

## Phase Outcome

At the end of this phase, the app should do a better job of:
- rejecting malformed event data
- avoiding duplicate events across sources
- signaling stale or missing imported data
- protecting core event logic with a small regression suite

## Execution Strategy

Sequence the work so each step de-risks the next one:
1. Define the event contract first
2. Harden normalization and validation logic
3. Improve deduplication behavior across sources
4. Surface import freshness and empty-state messaging
5. Add tests around the new logic

## Ticket List

### P1-01 Event Schema Documentation

Why:
The code already assumes an event shape, but that contract only exists implicitly in `app.js` and the scraper output.

Scope:
- Add a schema reference document for event objects
- Define required, optional, and derived fields
- Document normalization expectations for seeded and scraped data
- Document how invalid records should be handled

Deliverables:
- New markdown doc in `.planning/` or `data/` describing the event schema
- Clear examples for valid seeded data and valid scraped data

Acceptance criteria:
- A contributor can tell which fields are mandatory before editing `data/events.json`
- The schema explains how dates, IDs, and source-specific fields should behave
- The doc reflects the actual frontend contract

Verification:
- Manual doc review against `app.js` normalization logic and `scripts/scrape-engage.mjs`

Dependencies:
- None

### P1-02 Frontend Event Validation And Normalization Hardening

Why:
`normalizeEvents()` currently accepts broad input and silently drops only events with missing `start`. That is not enough if data quality gets worse.

Scope:
- Refine `normalizeEvents()` to handle malformed input more defensibly
- Reject invalid dates explicitly instead of relying on implicit `Date` behavior
- Normalize strings consistently
- Decide how to handle missing `campus`, `category`, and `location`
- Prevent impossible time ranges such as end before start

Files likely touched:
- `app.js`

Acceptance criteria:
- Invalid or malformed events do not enter the rendered dataset
- Events with invalid dates do not produce broken sorting or rendering
- The behavior for partial or missing fields is explicit and documented

Verification:
- Manual test with intentionally malformed sample records
- Small automated tests once P1-05 exists

Dependencies:
- P1-01

### P1-03 Cross-Source Deduplication Rules

Why:
The current dedupe logic only uses `id`, which is too weak if the same event appears in seeded data, Engage data, or local entries with different IDs.

Scope:
- Define a duplicate detection strategy beyond raw ID matching
- Choose a stable comparison key, likely combining normalized title, start time, and location
- Decide source precedence when duplicates conflict
- Apply deduplication consistently during initial load and Engage import

Files likely touched:
- `app.js`
- schema doc from P1-01 if dedupe semantics need documentation

Acceptance criteria:
- Obvious duplicates across sources do not appear twice in the UI
- The dedupe rule is deterministic and documented
- Local submissions still work without unexpectedly hiding distinct events

Verification:
- Manual tests using seeded duplicates and imported duplicates
- Automated test cases in P1-05

Dependencies:
- P1-01
- P1-02

### P1-04 Engage Freshness And Empty-State Messaging

Why:
The current import flow can fail silently from a user-trust perspective. An empty `data/engage.json` and an absent file both collapse into vague UI behavior.

Scope:
- Add visible freshness metadata for imported Engage data
- Distinguish between:
  - no cached file yet
  - cached file exists but contains zero matching events
  - cached file is stale
- Improve copy around what the import button actually does
- Decide whether freshness data lives in a sidecar file or in `engage.json`

Files likely touched:
- `app.js`
- `index.html`
- `scripts/scrape-engage.mjs`
- `.github/workflows/scrape-engage.yml`

Acceptance criteria:
- Users can understand whether imported data is unavailable, empty, or stale
- The import UI explains that Engage events are cached data, not live search
- Maintainers have a path to inspect freshness information

Verification:
- Manual UI check for all three states
- Manual scraper run to confirm freshness metadata updates

Dependencies:
- P1-01

### P1-05 Lightweight Regression Tests For Event Logic

Why:
Refactoring event logic without tests will be slow and brittle, especially around dates and deduplication.

Scope:
- Introduce a minimal test setup appropriate for the current stack
- Extract or expose pure logic needed for testing
- Add tests for:
  - normalization behavior
  - invalid date rejection
  - deduplication rules
  - date range filtering behavior

Files likely touched:
- `package.json`
- new test files
- `app.js` or extracted utility modules

Acceptance criteria:
- Core data logic can be validated locally with one command
- At least the main normalization and dedupe rules have coverage
- Test structure does not introduce unnecessary framework overhead

Verification:
- Run the test command successfully

Dependencies:
- P1-02
- P1-03

## Recommended Order

Execution order:
1. P1-01 Event Schema Documentation
2. P1-02 Frontend Event Validation And Normalization Hardening
3. P1-03 Cross-Source Deduplication Rules
4. P1-04 Engage Freshness And Empty-State Messaging
5. P1-05 Lightweight Regression Tests For Event Logic

## Parallelism Notes

Possible parallel work after P1-01:
- P1-04 can start while P1-02 and P1-03 are in progress if freshness metadata design is kept separate from dedupe logic

Work that should stay sequential:
- P1-03 should follow P1-02 because dedupe quality depends on normalized fields
- P1-05 should land after the core behavior is settled enough to avoid churn

## Suggested First Ticket

Start with `P1-01 Event Schema Documentation`.

Reason:
- It is fast
- It reduces ambiguity before touching logic
- It creates a stable contract for both frontend and scraper changes
