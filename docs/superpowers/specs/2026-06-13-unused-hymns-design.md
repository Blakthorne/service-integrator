# Unused Hymns — Planning Helper

**Status:** Approved design
**Date:** 2026-06-13
**Author:** David Polar (with Claude)

## 1. Problem & Purpose

Service Integrator currently is a **read-and-format** tool over Planning Center
Online (PCO): it pulls service types → plans → plan items live and helps format
copyright/schedule data. It remembers nothing between requests.

This feature is the app's first true **planning helper**: a section that answers
a question about the *whole history* — **"Which hymns from each hymnbook have we
never used in any service plan?"** — so the worship planner can deliberately pull
from hymns that have never been sung.

The list must be **sortable** and **filterable by hymnbook** (the two books
represented in `hymns.json`).

## 2. Key Decisions (settled during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Definition of "used" | **Ever, in any service type** | Simplest and most useful; answerable cheaply via PCO's `last_scheduled_at`. |
| Detection mechanism | **Scan the PCO song library** (not a plan-by-plan crawl) | A song with non-null `last_scheduled_at` has been scheduled at least once, anywhere. Handful of API calls vs. thousands. |
| Join key | **Normalized song title only** | `hymns.json` rows have no PCO IDs, and many hymnbook entries are not PCO songs at all. Title is the only available join. |
| Match strictness | **Conservative + review bucket** | A too-loose match wrongly hides a hymn; a too-strict match wrongly lists a used one. Near-misses surface for human judgment instead of guessing. |
| Multi-tune duplicate titles | **Treated as SEPARATE units** | Each tune-variant has its own hymn number — a distinct entry in the book. Singing one tune leaves the other genuinely unused. |
| Placement | **Real route `/unused-hymns` + a real nav bar** | Gives shareable/bookmarkable URLs for filtered/sorted views; the natural moment to give the app top-level navigation. |
| Caching | **In-memory TTL cache + manual refresh** | App deploys as a long-running Node server (pm2); no new database needed. |

## 3. Data Realities

- **Universe = `hymns.json`**: 929 records, ~905 distinct titles. Each record:
  `{ song_title, tune_name, great_hymns_of_the_faith, rejoice_hymns }`, where a
  book field of `-1` means "not in that book." Every record is in at least one
  book (no record is `-1/-1`). ~24 titles repeat with different tunes.
- **A hymnbook "entry" = one `hymns.json` record** (a title+tune at a specific
  number), **not** a title. This is the unit of the unused analysis.
- **"Used" signal = PCO Song's `last_scheduled_at`** — already typed in
  `app/api/plan-items/route.ts` (`SongAttributes`, lines 32–33) but currently
  discarded. Non-null ⇒ scheduled at least once.
- **Consequence to accept:** Because PCO is the only source of "used," a hymn
  sung *only* as a free-typed plan item that was never saved as a PCO Song
  record will not be detected as used. For hymnal singing this is rare; any such
  oddities tend to surface in the review bucket. A hymn never entered into PCO at
  all has no match and correctly stays "unused."

### 3.1 Assumption to verify FIRST (implementation spike)

Before building on it, confirm against the live PCO API:
1. `GET /services/v2/songs` returns `last_scheduled_at` per song.
2. Pagination shape (`per_page` max, `links.next` / offset).
3. That `last_scheduled_at` is populated for scheduled songs and not cleared in a
   way that would undercount (empirical sanity check on a few known songs).

If `last_scheduled_at` proves unreliable, fall back to a scoped plan-items scan
(out of scope for v1, but the matching/UI layers below are unaffected).

## 4. Architecture

```
Navigation (client)  ── Plans | Unused Hymns ──┐
                                               │
app/(app)/unused-hymns/page.tsx (client)       │  reads URL search params
   └─ fetch GET /api/unused-hymns              │  (book filter, sort)
                                               │
app/api/unused-hymns/route.ts (server)         │
   ├─ lib/pco.ts            → Basic Auth header + paged GET /services/v2/songs
   ├─ lib/normalizeTitle.ts → shared title normalizer
   ├─ computeUnusedHymns()  → PURE function (hymns.json + pcoSongs) → result
   └─ in-memory TTL cache   → busted by ?refresh=1
```

### 4.1 New / changed files

**New**
- `lib/pco.ts` — `pcoAuthHeader()` and a small paged-fetch helper for PCO.
- `lib/normalizeTitle.ts` — `normalizeTitle(raw: string): string`.
- `lib/unusedHymns.ts` — `computeUnusedHymns(hymns, pcoSongs): UnusedHymnsResult`
  (pure, no I/O — the testable core).
- `app/api/unused-hymns/route.ts` — the server route (I/O + caching).
- `app/(app)/unused-hymns/page.tsx` — the section UI (client component).
- `app/components/UnusedHymns/UnusedHymnsTable.tsx` — presentational table.
- `app/components/UnusedHymns/UnusedHymnsControls.tsx` — book filter + sort.
- `app/components/ui/Pagination.tsx` — **extracted** from `PlansTable.tsx`.
- Tests (see §8).

**Changed**
- `app/components/Navigation.tsx` — add nav links (`Plans` `/`,
  `Unused Hymns` `/unused-hymns`) with active-state highlight via
  `usePathname()`; keep the Sign Out server action. (Split a small client
  `NavLinks` piece if needed to keep the signOut server action intact.)
- `app/components/PlansTable.tsx` — import the extracted `Pagination`.
- `app/components/PlanItems/ServiceSchedule.tsx` — **bug fix**: replace the
  exact case-sensitive `hymnData.find(h => h.song_title === item.title)` with the
  shared `normalizeTitle` matcher, aligning it with the rest of the app.

## 5. Matching Logic (the heart of the feature)

`computeUnusedHymns(hymns, pcoSongs)`:

1. Build the **used index** from PCO songs:
   - `usedTitles: Set<string>` = `normalizeTitle(song.title)` for every PCO song
     with `last_scheduled_at != null`.
   - `usedSongsByTitle: Map<normTitle, PcoSong[]>` (kept for tune disambiguation
     and for showing the matched PCO title in the review bucket).
2. Detect **multi-tune titles** in `hymns.json`: a normalized title mapping to
   more than one record.
3. For **each `hymns.json` record** (the unit), classify:
   - **No used title equals it** → `unused`.
   - **A used title equals it AND the title is unique in `hymns.json`** → `used`
     (excluded from output).
   - **A used title equals it AND the title is multi-tune** (separate units):
     - **Tune attributable** — some matched PCO song's title (normalized) contains
       this record's `tune_name` → mark **that record** `used`; other variants of
       the title are evaluated independently.
     - **Tune not attributable** → record goes to **review** with
       `reason: "ambiguous-tune"` and the matched PCO title(s). (We will NOT
       collapse all variants to "used", per the separate-units decision, and will
       NOT silently call them unused.)
   - **Only a near-match exists** (normalized title close but not equal — e.g.,
     small edit distance / article or trailing-word difference) → **review** with
     `reason: "near-match"` and the matched PCO title.

Normalization (`normalizeTitle`): lowercase → trim → collapse internal
whitespace → straighten Unicode quotes/apostrophes (`’`→`'`) → `&`→`and` → strip
trailing punctuation (`. , ! ? ; :`). Article-stripping (`the/a/an`) is used only
for **near-match** detection, never for exact-equality, to avoid false collisions.

**Bias:** never auto-mark a hymn "used" on anything weaker than an exact
normalized match (optionally tune-confirmed). False "used" hides a genuinely
unused hymn — the exact failure this feature must avoid.

## 6. Data Shapes

```ts
// hymns.json record (existing)
interface RawHymn {
  song_title: string;
  tune_name: string;
  great_hymns_of_the_faith: number; // -1 = not in book
  rejoice_hymns: number;            // -1 = not in book
}

// One row in the output (a single hymnbook entry / tune-variant)
interface HymnEntry {
  songTitle: string;
  tuneName: string;
  rejoiceNumber: number | null;     // null when -1 / not in Rejoice
  greatHymnsNumber: number | null;  // null when -1 / not in Great Hymns
}

interface ReviewEntry extends HymnEntry {
  reason: "ambiguous-tune" | "near-match";
  matchedPcoTitle: string;          // what PCO title triggered the review
}

interface UnusedHymnsResult {
  unused: HymnEntry[];   // confidently never used (across both books; row carries its numbers)
  review: ReviewEntry[]; // needs human judgment
  meta: {
    songsScanned: number;
    usedTitleCount: number;
    computedAt: string;  // ISO timestamp
  };
}
```

`GET /api/unused-hymns` → `200 { ...UnusedHymnsResult }`; on failure
`500 { error: string }`, matching the existing route error convention.
`?refresh=1` busts the cache. Note: `unused`/`review` cover both books; the
**book filter is a client-side view concern** — a row is "in Rejoice" when
`rejoiceNumber != null` and "in Great Hymns" when `greatHymnsNumber != null`, and
an entry in both books shows in both filtered views.

## 7. UI / UX

- **Navigation bar** (in `Navigation.tsx`): `Plans` | `Unused Hymns`, active
  link highlighted; Sign Out remains on the right.
- **Controls** (state persisted in the **URL** so views are shareable):
  - **Book filter:** `All` | `Rejoice Hymns` | `Great Hymns` (default **All**).
  - **Sort:** `Title (A–Z)` | `Hymn number (ascending)` (default **Title A–Z**).
    Under a single-book filter, number-sort uses that book's number. Under `All`,
    number-sort falls back to the Rejoice number, then the Great Hymns number,
    since a row may carry two numbers.
- **Table columns:** `Title` · `Tune` · `Rejoice` · `Great Hymns`.
  - **No `R-`/`G-` prefixes** — column headers delineate the book; cells show the
    bare number, blank when the entry is not in that book.
  - Under a single-book filter, the table may collapse to that book's number
    column for clarity, but the default `All` view shows both number columns.
  - Because multi-tune variants are separate units, two rows can share a title
    and differ by tune/number — that is expected and correct.
- **Count summary:** e.g. "142 of 600 Rejoice hymns never used" (denominator =
  entries in the active book; review entries counted separately).
- **Review section:** collapsible, default **collapsed**, titled
  "Possible matches — review (N)", each row showing the entry, the
  `matchedPcoTitle`, and the reason.
- **Freshness:** "As of `<computedAt>` · Refresh" control; Refresh re-requests
  with `?refresh=1`.
- **States:** reuse the existing loading-spinner and error-with-"Try Again"
  patterns; reuse the extracted `Pagination` (25 rows/page, matching Plans).
- **Styling:** reuse the existing card/table Tailwind system
  (`bg-white dark:bg-gray-800 rounded-lg shadow-sm`, gray header rows) and dark
  mode tokens from `globals.css`.

## 8. Testing

The repo has **no test setup today**; this feature introduces the first one.

- **Tooling:** add **Vitest** (+ config) for unit tests.
- **Unit — `normalizeTitle`:** case, whitespace, smart quotes/apostrophes,
  `&`→`and`, trailing punctuation; article handling only for near-match.
- **Unit — `computeUnusedHymns` (highest signal):**
  - Unique title, exact match → `used` (excluded).
  - Unique title, no match → `unused`.
  - Multi-tune title, used with no tune info → both variants → `review`
    (`ambiguous-tune`).
  - Multi-tune title, used with tune named in PCO title → that variant `used`,
    other variant evaluated independently.
  - Near-match (punctuation/edit) → `review` (`near-match`), not silently unused.
  - `-1` book filtering: numbers map to `null`; entry only appears under books it
    belongs to.
  - Hymn never in PCO → `unused`.
- **Route test:** `GET /api/unused-hymns` with a mocked PCO `songs` response
  (incl. pagination) → asserts shape, cache behavior, and `?refresh=1` bust.
- **Optional:** a Playwright smoke test for the page (no E2E harness exists yet;
  defer unless desired).

Target: meet the project's 80% coverage bar on the new pure logic
(`normalizeTitle`, `computeUnusedHymns`).

## 9. Out of Scope (v1)

- Plan-by-plan / date-range / per-service-type scoping of "used" (the chosen
  definition is all-time, any service).
- Persistent database / historical snapshots beyond the in-memory cache.
- Migrating the other three PCO routes to `lib/pco.ts` (do it opportunistically,
  but not required for this feature).
- Fuzzy/auto matching beyond the conservative matcher + review bucket.

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `last_scheduled_at` unreliable / cleared on removal | Verify first (§3.1); fall back to scoped scan if needed. |
| Title drift (punctuation/apostrophes) causes silent misses | Hardened normalizer + review bucket for near-misses. |
| Multi-tune ambiguity mis-attributes usage | Treat variants as separate units; ambiguous title matches go to review, never auto-collapsed. |
| Song library large / slow / rate limits | In-memory TTL cache + manual refresh; cheap relative to a plan crawl. |
| First nav + first test infra in the app | Keep nav minimal and additive; introduce Vitest only for new pure logic. |
