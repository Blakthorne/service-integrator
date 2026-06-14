# Unused Hymns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sortable, hymnbook-filterable section that lists hymns from `hymns.json` (Rejoice Hymns + Great Hymns of the Faith) that have never been scheduled in any Planning Center (PCO) service plan.

**Architecture:** A server route (`/api/unused-hymns`) pages through PCO's song library, treats any song with a non-null `last_scheduled_at` as "used," and subtracts those normalized titles from `hymns.json` via a pure `computeUnusedHymns` function. Title matching is conservative (normalized exact match); ambiguous multi-tune matches and near-misses go to a "review" bucket. A new client route (`/app/(app)/unused-hymns`) reuses the existing card/table styling, the extracted `Pagination` component, and persists book-filter/sort in the URL. Results are cached in-memory (1h TTL) with a manual Refresh.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind v4, Vitest (new), PCO Services API v2.

**Reference spec:** `docs/superpowers/specs/2026-06-13-unused-hymns-design.md`

---

## File Structure

**New**
- `lib/normalizeTitle.ts` — `normalizeTitle()` title normalizer (shared by the matcher and the ServiceSchedule bug fix).
- `lib/unusedHymns.ts` — types + `levenshtein()`, `isNearMatch()`, `computeUnusedHymns()` (pure, no I/O — the testable core).
- `lib/pco.ts` — `pcoAuthHeaders()` + `fetchAllSongs()` (PCO I/O).
- `app/api/unused-hymns/route.ts` — GET route: fetch songs → compute → in-memory cache.
- `app/components/ui/Pagination.tsx` — extracted from `PlansTable.tsx`.
- `app/components/Navigation/NavLinks.tsx` — client nav links with active state.
- `app/components/UnusedHymns/UnusedHymnsView.tsx` — client container (fetch + filter/sort + compose).
- `app/components/UnusedHymns/UnusedHymnsControls.tsx` — book filter + sort + summary + refresh (presentational).
- `app/components/UnusedHymns/UnusedHymnsTable.tsx` — table + pagination + review section (presentational).
- `app/(app)/unused-hymns/page.tsx` — server page wrapping the view in `<Suspense>`.
- `vitest.config.ts` — test config.
- Test files mirroring the `lib/` modules and the route.

**Modified**
- `app/components/PlansTable.tsx` — import the extracted `Pagination`, delete the local copy.
- `app/components/Navigation.tsx` — render `<NavLinks />`.
- `app/components/PlanItems/ServiceSchedule.tsx` — fix the case-sensitive title match using `normalizeTitle`.
- `package.json` — add Vitest deps + scripts.

---

## Task 0: Verify the `last_scheduled_at` assumption (spike — no code)

The entire cheap approach rests on PCO populating `last_scheduled_at` on the songs collection. Verify before building.

**Files:** none (investigation only)

- [ ] **Step 1: Query the PCO songs endpoint with real credentials**

Run (creds live in `.env.local`):

```bash
set -a; source .env.local; set +a
curl -s -u "$PLANNING_CENTER_ID:$PLANNING_CENTER_TOKEN" \
  "https://api.planningcenteronline.com/services/v2/songs?per_page=2" \
  | jq '{links: .links, meta: .meta, sample: (.data[0].attributes | {title, last_scheduled_at, last_scheduled_short_dates})}'
```

Expected: each `data[].attributes` contains `title` and `last_scheduled_at`; the response has a `links` object (look for `next` when more pages exist) and a `meta.total_count`.

- [ ] **Step 2: Sanity-check the signal on a known song**

```bash
set -a; source .env.local; set +a
curl -s -u "$PLANNING_CENTER_ID:$PLANNING_CENTER_TOKEN" \
  "https://api.planningcenteronline.com/services/v2/songs?per_page=25" \
  | jq '.data[] | {title: .attributes.title, last: .attributes.last_scheduled_at}'
```

Expected: songs you know have been sung show a non-null `last`; brand-new/never-scheduled songs show `null`.

- [ ] **Step 3: Record the decision**

If `last_scheduled_at` behaves as expected → proceed with this plan unchanged. If it is unreliable (e.g., always null, or cleared when a song is removed from a plan), STOP and revisit §3.1 of the spec (fallback: scoped plan-items scan) before continuing. Note the page size cap observed (PCO commonly caps `per_page` at 100) — the code below assumes ≤100 and follows `links.next`, so no change is needed unless the shape differs.

---

## Task 1: Add Vitest test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install dev dependencies**

Run:

```bash
npm install -D vitest@^2 vite-tsconfig-paths@^5
```

Expected: `vitest` and `vite-tsconfig-paths` added to `devDependencies`; no errors.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        environment: "node",
        include: ["**/*.test.ts"],
        exclude: ["node_modules/**", ".next/**"],
    },
});
```

- [ ] **Step 3: Add test scripts**

In `package.json`, add to the `"scripts"` object (keep existing scripts):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Add a throwaway smoke test and run it**

Create `lib/smoke.test.ts`:

```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
    expect(1 + 1).toBe(2);
});
```

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 5: Delete the smoke test**

Run: `rm lib/smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add Vitest test infrastructure"
```

---

## Task 2: `normalizeTitle`

**Files:**
- Create: `lib/normalizeTitle.ts`
- Test: `lib/normalizeTitle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/normalizeTitle.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { normalizeTitle } from "./normalizeTitle";

describe("normalizeTitle", () => {
    test("lowercases and trims", () => {
        expect(normalizeTitle("  A Mighty Fortress  ")).toBe("a mighty fortress");
    });

    test("collapses internal whitespace", () => {
        expect(normalizeTitle("Holy,   Holy,   Holy")).toBe("holy, holy, holy");
    });

    test("strips trailing punctuation but keeps internal", () => {
        expect(normalizeTitle("Holy, Holy, Holy!")).toBe("holy, holy, holy");
        expect(normalizeTitle("Come, Thou Fount.")).toBe("come, thou fount");
    });

    test("straightens smart apostrophes and quotes", () => {
        expect(normalizeTitle("Jesus’ Name")).toBe("jesus' name");
    });

    test("expands ampersand to 'and'", () => {
        expect(normalizeTitle("Praise & Worship")).toBe("praise and worship");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- normalizeTitle`
Expected: FAIL — cannot resolve `./normalizeTitle`.

- [ ] **Step 3: Write the implementation**

Create `lib/normalizeTitle.ts`:

```ts
/**
 * Normalize a song title for tolerant comparison between PCO's free-text titles
 * and hymns.json titles. Lowercase, straighten smart quotes, expand "&" to "and",
 * collapse whitespace, and drop trailing punctuation.
 */
export function normalizeTitle(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'")
        .replace(/[“”″]/g, '"')
        .replace(/&/g, " and ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.,!?;:]+$/g, "")
        .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- normalizeTitle`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalizeTitle.ts lib/normalizeTitle.test.ts
git commit -m "feat: add normalizeTitle for tolerant title matching"
```

---

## Task 3: Near-match helpers (`levenshtein`, `isNearMatch`) + types

**Files:**
- Create: `lib/unusedHymns.ts` (types + near-match helpers; `computeUnusedHymns` added in Task 4)
- Test: `lib/unusedHymns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/unusedHymns.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { isNearMatch, levenshtein } from "./unusedHymns";

describe("levenshtein", () => {
    test("identical strings have distance 0", () => {
        expect(levenshtein("abide with me", "abide with me")).toBe(0);
    });

    test("counts single edits", () => {
        expect(levenshtein("color", "colour")).toBe(1);
        expect(levenshtein("kitten", "sitting")).toBe(3);
    });

    test("handles empty strings", () => {
        expect(levenshtein("", "abc")).toBe(3);
        expect(levenshtein("abc", "")).toBe(3);
    });
});

describe("isNearMatch", () => {
    test("false for identical strings", () => {
        expect(isNearMatch("come thou fount", "come thou fount")).toBe(false);
    });

    test("true for a small typo on long-enough strings", () => {
        expect(isNearMatch("blessed assurance", "blesed assurance")).toBe(true);
    });

    test("false when too different", () => {
        expect(isNearMatch("amazing grace", "how great thou art")).toBe(false);
    });

    test("false when strings are too short", () => {
        expect(isNearMatch("go", "do")).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- unusedHymns`
Expected: FAIL — cannot resolve `./unusedHymns`.

- [ ] **Step 3: Write the implementation**

Create `lib/unusedHymns.ts`:

```ts
import { normalizeTitle } from "./normalizeTitle";

export interface RawHymn {
    song_title: string;
    tune_name: string;
    great_hymns_of_the_faith: number;
    rejoice_hymns: number;
}

export interface PcoSong {
    title: string;
    lastScheduledAt: string | null;
}

export interface HymnEntry {
    songTitle: string;
    tuneName: string;
    rejoiceNumber: number | null;
    greatHymnsNumber: number | null;
}

export interface ReviewEntry extends HymnEntry {
    reason: "ambiguous-tune" | "near-match";
    matchedPcoTitle: string;
}

export interface UnusedHymnsResult {
    unused: HymnEntry[];
    review: ReviewEntry[];
    meta: {
        songsScanned: number;
        usedTitleCount: number;
        computedAt: string;
        totals: { rejoice: number; greatHymns: number };
    };
}

const NEAR_MATCH_MAX_DISTANCE = 2;
const NEAR_MATCH_MIN_LENGTH = 6;

/** Classic two-row Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array<number>(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/** True when two normalized titles are close but not equal (a likely typo/variant). */
export function isNearMatch(a: string, b: string): boolean {
    if (a === b) return false;
    if (a.length < NEAR_MATCH_MIN_LENGTH || b.length < NEAR_MATCH_MIN_LENGTH) {
        return false;
    }
    if (Math.abs(a.length - b.length) > NEAR_MATCH_MAX_DISTANCE) return false;
    return levenshtein(a, b) <= NEAR_MATCH_MAX_DISTANCE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- unusedHymns`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/unusedHymns.ts lib/unusedHymns.test.ts
git commit -m "feat: add levenshtein + isNearMatch helpers and unused-hymns types"
```

---

## Task 4: `computeUnusedHymns` (the core logic)

**Files:**
- Modify: `lib/unusedHymns.ts` (append `computeUnusedHymns` + private `toHymnEntry`)
- Modify: `lib/unusedHymns.test.ts` (append the behavior tests)

- [ ] **Step 1: Write the failing tests**

Append to `lib/unusedHymns.test.ts`:

```ts
import { computeUnusedHymns, type PcoSong, type RawHymn } from "./unusedHymns";

const AT = "2026-06-13T00:00:00.000Z";

function rejoice(title: string, tune: string, num: number): RawHymn {
    return { song_title: title, tune_name: tune, rejoice_hymns: num, great_hymns_of_the_faith: -1 };
}

describe("computeUnusedHymns", () => {
    test("unique title matched in PCO is excluded (used)", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const songs: PcoSong[] = [{ title: "Amazing Grace", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(0);
    });

    test("unique title not in PCO is unused", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const result = computeUnusedHymns(hymns, [], AT);
        expect(result.unused).toEqual([
            { songTitle: "Amazing Grace", tuneName: "NEW BRITAIN", rejoiceNumber: 100, greatHymnsNumber: null },
        ]);
    });

    test("a song scheduled only via null last_scheduled_at counts as unused", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const songs: PcoSong[] = [{ title: "Amazing Grace", lastScheduledAt: null }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(1);
    });

    test("multi-tune title used with no tune info sends both variants to review", () => {
        const hymns: RawHymn[] = [
            rejoice("Abba, Father", "ABBA, FATHER", 42),
            rejoice("Abba, Father", "PRITCHARD", 7),
        ];
        const songs: PcoSong[] = [{ title: "Abba, Father", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(2);
        expect(result.review.every((r) => r.reason === "ambiguous-tune")).toBe(true);
        expect(result.review[0].matchedPcoTitle).toBe("Abba, Father");
    });

    test("multi-tune title with the tune named in the PCO title attributes usage to that variant", () => {
        const hymns: RawHymn[] = [
            rejoice("Abba, Father", "ABBA, FATHER", 42),
            rejoice("Abba, Father", "PRITCHARD", 7),
        ];
        const songs: PcoSong[] = [{ title: "Abba, Father (PRITCHARD)", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        // PRITCHARD attributed as used; the other variant has no evidence -> unused.
        expect(result.review).toHaveLength(0);
        expect(result.unused).toEqual([
            { songTitle: "Abba, Father", tuneName: "ABBA, FATHER", rejoiceNumber: 42, greatHymnsNumber: null },
        ]);
    });

    test("near-match goes to review, not silently unused", () => {
        const hymns: RawHymn[] = [rejoice("Blessed Assurance", "ASSURANCE", 300)];
        const songs: PcoSong[] = [{ title: "Blesed Assurance", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(1);
        expect(result.review[0].reason).toBe("near-match");
        expect(result.review[0].matchedPcoTitle).toBe("Blesed Assurance");
    });

    test("maps -1 to null and counts per-book totals", () => {
        const hymns: RawHymn[] = [
            { song_title: "Both Books", tune_name: "X", rejoice_hymns: 5, great_hymns_of_the_faith: 9 },
            { song_title: "Rejoice Only", tune_name: "Y", rejoice_hymns: 6, great_hymns_of_the_faith: -1 },
        ];
        const result = computeUnusedHymns(hymns, [], AT);
        expect(result.meta.totals).toEqual({ rejoice: 2, greatHymns: 1 });
        const both = result.unused.find((e) => e.songTitle === "Both Books")!;
        expect(both.rejoiceNumber).toBe(5);
        expect(both.greatHymnsNumber).toBe(9);
        const rej = result.unused.find((e) => e.songTitle === "Rejoice Only")!;
        expect(rej.greatHymnsNumber).toBeNull();
    });

    test("stamps meta", () => {
        const result = computeUnusedHymns([], [{ title: "x", lastScheduledAt: AT }], AT);
        expect(result.meta.computedAt).toBe(AT);
        expect(result.meta.songsScanned).toBe(1);
        expect(result.meta.usedTitleCount).toBe(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- unusedHymns`
Expected: FAIL — `computeUnusedHymns` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/unusedHymns.ts`:

```ts
function toHymnEntry(h: RawHymn): HymnEntry {
    return {
        songTitle: h.song_title,
        tuneName: h.tune_name,
        rejoiceNumber: h.rejoice_hymns > 0 ? h.rejoice_hymns : null,
        greatHymnsNumber:
            h.great_hymns_of_the_faith > 0 ? h.great_hymns_of_the_faith : null,
    };
}

/**
 * Determine which hymnbook entries (one per hymns.json record / tune-variant)
 * have never been scheduled in PCO. Pure: no I/O. `computedAt` is supplied so the
 * function stays deterministic for tests.
 *
 * - Exact normalized title match to a used PCO song:
 *     - unique title  -> used (excluded)
 *     - multi-tune title -> used only if the PCO title names this tune;
 *       otherwise the variant goes to the review bucket (ambiguous tune)
 * - Near (but not exact) match to a used title -> review bucket (near-match)
 * - No match at all -> unused
 */
export function computeUnusedHymns(
    hymns: RawHymn[],
    pcoSongs: PcoSong[],
    computedAt: string
): UnusedHymnsResult {
    // Normalized title -> original PCO titles (kept for tune attribution + display).
    const usedNormToOriginals = new Map<string, string[]>();
    for (const song of pcoSongs) {
        if (song.lastScheduledAt == null) continue;
        const norm = normalizeTitle(song.title);
        if (norm.length === 0) continue;
        const originals = usedNormToOriginals.get(norm) ?? [];
        if (!originals.includes(song.title)) originals.push(song.title);
        usedNormToOriginals.set(norm, originals);
    }
    const usedNormTitles = [...usedNormToOriginals.keys()];

    // How many tune-variants share each normalized hymn title.
    const variantCount = new Map<string, number>();
    for (const h of hymns) {
        const norm = normalizeTitle(h.song_title);
        variantCount.set(norm, (variantCount.get(norm) ?? 0) + 1);
    }

    const unused: HymnEntry[] = [];
    const review: ReviewEntry[] = [];
    const totals = { rejoice: 0, greatHymns: 0 };

    for (const h of hymns) {
        if (h.rejoice_hymns > 0) totals.rejoice++;
        if (h.great_hymns_of_the_faith > 0) totals.greatHymns++;

        const entry = toHymnEntry(h);
        const norm = normalizeTitle(h.song_title);
        const isMultiTune = (variantCount.get(norm) ?? 0) > 1;
        const usedOriginals = usedNormToOriginals.get(norm);

        if (usedOriginals) {
            if (!isMultiTune) {
                continue; // unique title, confidently used
            }
            const tuneNorm = normalizeTitle(h.tune_name);
            const tuneNamed =
                tuneNorm.length > 0 &&
                usedOriginals.some((orig) =>
                    normalizeTitle(orig).includes(tuneNorm)
                );
            if (tuneNamed) {
                continue; // this specific tune was named in a used PCO title
            }
            review.push({
                ...entry,
                reason: "ambiguous-tune",
                matchedPcoTitle: usedOriginals[0],
            });
            continue;
        }

        const near = usedNormTitles.find((u) => isNearMatch(norm, u));
        if (near) {
            review.push({
                ...entry,
                reason: "near-match",
                matchedPcoTitle: usedNormToOriginals.get(near)![0],
            });
            continue;
        }

        unused.push(entry);
    }

    return {
        unused,
        review,
        meta: {
            songsScanned: pcoSongs.length,
            usedTitleCount: usedNormToOriginals.size,
            computedAt,
            totals,
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- unusedHymns`
Expected: PASS (all `levenshtein`, `isNearMatch`, and `computeUnusedHymns` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/unusedHymns.ts lib/unusedHymns.test.ts
git commit -m "feat: add computeUnusedHymns set-difference matcher"
```

---

## Task 5: PCO song-library fetch (`lib/pco.ts`)

**Files:**
- Create: `lib/pco.ts`
- Test: `lib/pco.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pco.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchAllSongs, pcoAuthHeaders } from "./pco";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("pcoAuthHeaders", () => {
    test("throws when credentials are missing", () => {
        vi.stubEnv("PLANNING_CENTER_ID", "");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "");
        expect(() => pcoAuthHeaders()).toThrow("Planning Center credentials not configured");
    });

    test("builds a Basic auth header", () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
        const headers = pcoAuthHeaders();
        expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:tok").toString("base64")}`);
    });
});

describe("fetchAllSongs", () => {
    test("follows links.next and maps attributes across pages", async () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");

        const page1 = {
            data: [{ attributes: { title: "Amazing Grace", last_scheduled_at: "2025-01-01T00:00:00Z" } }],
            links: { next: "https://api.planningcenteronline.com/services/v2/songs?offset=100" },
        };
        const page2 = {
            data: [{ attributes: { title: "Never Sung", last_scheduled_at: null } }],
            links: {},
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => page1 })
            .mockResolvedValueOnce({ ok: true, json: async () => page2 });
        vi.stubGlobal("fetch", fetchMock);

        const songs = await fetchAllSongs();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(songs).toEqual([
            { title: "Amazing Grace", lastScheduledAt: "2025-01-01T00:00:00Z" },
            { title: "Never Sung", lastScheduledAt: null },
        ]);
    });

    test("throws on a non-ok response", async () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(fetchAllSongs()).rejects.toThrow("status: 429");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pco`
Expected: FAIL — cannot resolve `./pco`.

- [ ] **Step 3: Write the implementation**

Create `lib/pco.ts`:

```ts
import type { PcoSong } from "./unusedHymns";

const PCO_SONGS_URL =
    "https://api.planningcenteronline.com/services/v2/songs?per_page=100";

/** Build the PCO Basic Auth headers from env credentials. Throws if missing. */
export function pcoAuthHeaders(): Record<string, string> {
    const id = process.env.PLANNING_CENTER_ID;
    const token = process.env.PLANNING_CENTER_TOKEN;
    if (!id || !token) {
        throw new Error("Planning Center credentials not configured");
    }
    const credentials = Buffer.from(`${id}:${token}`).toString("base64");
    return {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
    };
}

interface PcoSongResource {
    attributes: {
        title: string;
        last_scheduled_at: string | null;
    };
}

interface PcoSongsPage {
    data: PcoSongResource[];
    links: { next?: string | null };
}

/** Page through the entire PCO song library, following links.next. */
export async function fetchAllSongs(): Promise<PcoSong[]> {
    const headers = pcoAuthHeaders();
    const songs: PcoSong[] = [];
    let url: string | null = PCO_SONGS_URL;

    while (url) {
        const response = await fetch(url, { headers, cache: "no-store" });
        if (!response.ok) {
            throw new Error(
                `Planning Center API responded with status: ${response.status}`
            );
        }
        const page: PcoSongsPage = await response.json();
        for (const resource of page.data) {
            songs.push({
                title: resource.attributes.title,
                lastScheduledAt: resource.attributes.last_scheduled_at,
            });
        }
        url = page.links?.next ?? null;
    }

    return songs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pco`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pco.ts lib/pco.test.ts
git commit -m "feat: add PCO song-library fetch with pagination"
```

---

## Task 6: `/api/unused-hymns` route with in-memory cache

**Files:**
- Create: `app/api/unused-hymns/route.ts`
- Test: `app/api/unused-hymns/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/unused-hymns/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PcoSong } from "@/lib/unusedHymns";

// vi.hoisted is required: vi.mock is hoisted above const declarations, so the
// mock fn must be created inside hoisted() to exist when the factory runs.
const { fetchAllSongs } = vi.hoisted(() => ({ fetchAllSongs: vi.fn() }));
vi.mock("@/lib/pco", () => ({ fetchAllSongs }));

const sampleSongs: PcoSong[] = [
    { title: "Amazing Grace", lastScheduledAt: "2025-01-01T00:00:00Z" },
];

async function loadRoute() {
    vi.resetModules();
    return import("./route");
}

beforeEach(() => {
    fetchAllSongs.mockReset();
    fetchAllSongs.mockResolvedValue(sampleSongs);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/unused-hymns", () => {
    test("returns a result with the expected shape", async () => {
        const { GET } = await loadRoute();
        const res = await GET(new Request("http://localhost/api/unused-hymns"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("unused");
        expect(body).toHaveProperty("review");
        expect(body.meta).toHaveProperty("computedAt");
        expect(body.meta.totals).toHaveProperty("rejoice");
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("serves the second request from cache (no re-fetch)", async () => {
        const { GET } = await loadRoute();
        await GET(new Request("http://localhost/api/unused-hymns"));
        await GET(new Request("http://localhost/api/unused-hymns"));
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("?refresh=1 busts the cache", async () => {
        const { GET } = await loadRoute();
        await GET(new Request("http://localhost/api/unused-hymns"));
        await GET(new Request("http://localhost/api/unused-hymns?refresh=1"));
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("returns 500 when fetching fails", async () => {
        fetchAllSongs.mockRejectedValueOnce(new Error("boom"));
        const { GET } = await loadRoute();
        const res = await GET(new Request("http://localhost/api/unused-hymns"));
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- unused-hymns/route`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the implementation**

Create `app/api/unused-hymns/route.ts`:

```ts
import { NextResponse } from "next/server";
import hymnData from "@/hymns.json";
import { fetchAllSongs } from "@/lib/pco";
import {
    computeUnusedHymns,
    RawHymn,
    UnusedHymnsResult,
} from "@/lib/unusedHymns";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache: { data: UnusedHymnsResult; expires: number } | null = null;

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { searchParams } = new URL(request.url);
        const refresh = searchParams.get("refresh") === "1";
        const now = Date.now();

        if (!refresh && cache && cache.expires > now) {
            return NextResponse.json(cache.data);
        }

        const songs = await fetchAllSongs();
        const data = computeUnusedHymns(
            hymnData as RawHymn[],
            songs,
            new Date().toISOString()
        );
        cache = { data, expires: now + CACHE_TTL_MS };

        return NextResponse.json(data);
    } catch (error) {
        console.error("Error computing unused hymns:", error);
        return NextResponse.json(
            { error: "Failed to compute unused hymns" },
            { status: 500 }
        );
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- unused-hymns/route`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/unused-hymns/route.ts app/api/unused-hymns/route.test.ts
git commit -m "feat: add /api/unused-hymns route with in-memory cache"
```

---

## Task 7: Extract the `Pagination` component

This is a pure refactor — move the existing `Pagination` out of `PlansTable.tsx` so the new section can reuse it. No behavior change.

**Files:**
- Create: `app/components/ui/Pagination.tsx`
- Modify: `app/components/PlansTable.tsx` (remove local `Pagination` + `PaginationProps`, import the new one)

- [ ] **Step 1: Create the extracted component**

Create `app/components/ui/Pagination.tsx` (copied verbatim from `PlansTable.tsx`, now exported):

```tsx
interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

export default function Pagination({
    currentPage,
    totalPages,
    onPageChange,
}: PaginationProps) {
    return (
        <div className="flex justify-between items-center py-4">
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] sm:min-w-[100px]"
            >
                Previous
            </button>
            {/* Desktop pagination */}
            <div className="hidden sm:flex items-center space-x-4">
                <div className="flex space-x-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                            pageNum = i + 1;
                        } else if (currentPage <= 3) {
                            pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                        } else {
                            pageNum = currentPage - 2 + i;
                        }
                        return (
                            <button
                                key={i}
                                onClick={() => onPageChange(pageNum)}
                                className={`px-3 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    currentPage === pageNum
                                        ? "bg-blue-500 text-white"
                                        : "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                                }`}
                            >
                                {pageNum}
                            </button>
                        );
                    })}
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    of {totalPages}
                </span>
            </div>
            {/* Mobile pagination info */}
            <div className="flex sm:hidden items-center justify-center min-w-[100px]">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    {currentPage} / {totalPages}
                </span>
            </div>
            <button
                onClick={() =>
                    onPageChange(Math.min(totalPages, currentPage + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] sm:min-w-[100px]"
            >
                Next
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Update `PlansTable.tsx`**

In `app/components/PlansTable.tsx`: delete the local `PaginationProps` interface (lines 25-29) and the entire local `Pagination` function (lines 31-95), and add an import at the top (after the `react` import on line 3):

```tsx
import Pagination from "./ui/Pagination";
```

Leave the two `<Pagination ... />` usages unchanged — they now resolve to the imported component.

- [ ] **Step 3: Verify the build still compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/Pagination.tsx app/components/PlansTable.tsx
git commit -m "refactor: extract Pagination into components/ui for reuse"
```

---

## Task 8: Navigation links

**Files:**
- Create: `app/components/Navigation/NavLinks.tsx`
- Modify: `app/components/Navigation.tsx`

- [ ] **Step 1: Create the client nav-links component**

Create `app/components/Navigation/NavLinks.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
    { href: "/", label: "Plans" },
    { href: "/unused-hymns", label: "Unused Hymns" },
];

export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-1 sm:space-x-2 ml-4 sm:ml-8">
            {LINKS.map((link) => {
                const isActive =
                    link.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(link.href);
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            isActive
                                ? "bg-blue-500 text-white"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                    >
                        {link.label}
                    </Link>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 2: Render `NavLinks` inside `Navigation.tsx`**

Replace the entire contents of `app/components/Navigation.tsx` with:

```tsx
import { signOut } from "@/auth";
import React from "react";
import NavLinks from "./Navigation/NavLinks";

export default function Navigation() {
    return (
        <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                    <div className="flex items-center">
                        <div className="flex-shrink-0 flex items-center">
                            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                Service Integrator
                            </h1>
                        </div>
                        <NavLinks />
                    </div>
                    <div className="flex items-center">
                        <form
                            action={async () => {
                                "use server";
                                await signOut({ redirectTo: "/auth/signin" });
                            }}
                        >
                            <button
                                type="submit"
                                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer whitespace-pre"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4 mr-2"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                    />
                                </svg>
                                Sign Out
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </nav>
    );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/Navigation.tsx app/components/Navigation/NavLinks.tsx
git commit -m "feat: add top-level navigation links (Plans | Unused Hymns)"
```

---

## Task 9: `UnusedHymnsControls` (presentational)

**Files:**
- Create: `app/components/UnusedHymns/UnusedHymnsControls.tsx`

This component renders the book filter, the sort selector, the summary line, the "as of" timestamp, and the Refresh button. It owns no data — everything is props.

- [ ] **Step 1: Create the component**

Create `app/components/UnusedHymns/UnusedHymnsControls.tsx`:

```tsx
"use client";

export type BookFilter = "all" | "rejoice" | "great";
export type SortKey = "title" | "number";

interface UnusedHymnsControlsProps {
    book: BookFilter;
    sort: SortKey;
    summary: string;
    computedAt: string | null;
    refreshing: boolean;
    onBookChange: (book: BookFilter) => void;
    onSortChange: (sort: SortKey) => void;
    onRefresh: () => void;
}

const BOOK_OPTIONS: { value: BookFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "rejoice", label: "Rejoice Hymns" },
    { value: "great", label: "Great Hymns" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: "title", label: "Title (A–Z)" },
    { value: "number", label: "Hymn number" },
];

function Segmented<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
    ariaLabel: string;
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden"
        >
            {options.map((option) => {
                const isActive = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => onChange(option.value)}
                        className={`px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            isActive
                                ? "bg-blue-500 text-white"
                                : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export default function UnusedHymnsControls({
    book,
    sort,
    summary,
    computedAt,
    refreshing,
    onBookChange,
    onSortChange,
    onRefresh,
}: UnusedHymnsControlsProps) {
    const asOf = computedAt
        ? new Date(computedAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
          })
        : null;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6 space-y-4">
            <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1">
                    <span className="block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Hymnbook
                    </span>
                    <Segmented
                        value={book}
                        options={BOOK_OPTIONS}
                        onChange={onBookChange}
                        ariaLabel="Filter by hymnbook"
                    />
                </div>
                <div className="space-y-1">
                    <span className="block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Sort
                    </span>
                    <Segmented
                        value={sort}
                        options={SORT_OPTIONS}
                        onChange={onSortChange}
                        ariaLabel="Sort order"
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {summary}
                </p>
                <div className="flex items-center gap-3">
                    {asOf && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            As of {asOf}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/UnusedHymns/UnusedHymnsControls.tsx
git commit -m "feat: add UnusedHymnsControls (book filter, sort, refresh)"
```

---

## Task 10: `UnusedHymnsTable` (presentational)

**Files:**
- Create: `app/components/UnusedHymns/UnusedHymnsTable.tsx`

Renders the paged rows, the `Pagination` control, and the collapsible review section. No `R-`/`G-` prefixes — bare numbers under `Rejoice` / `Great Hymns` column headers (per spec). Pure props.

- [ ] **Step 1: Create the component**

Create `app/components/UnusedHymns/UnusedHymnsTable.tsx`:

```tsx
"use client";

import { useState } from "react";
import Pagination from "../ui/Pagination";
import type { HymnEntry, ReviewEntry } from "@/lib/unusedHymns";
import type { BookFilter } from "./UnusedHymnsControls";

interface UnusedHymnsTableProps {
    rows: HymnEntry[];
    review: ReviewEntry[];
    book: BookFilter;
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

function numberCell(value: number | null) {
    return (
        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 tabular-nums">
            {value ?? ""}
        </td>
    );
}

export default function UnusedHymnsTable({
    rows,
    review,
    book,
    currentPage,
    totalPages,
    onPageChange,
}: UnusedHymnsTableProps) {
    const [reviewOpen, setReviewOpen] = useState(false);
    const showRejoice = book !== "great";
    const showGreat = book !== "rejoice";

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Title
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Tune
                                </th>
                                {showRejoice && (
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Rejoice
                                    </th>
                                )}
                                {showGreat && (
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Great Hymns
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {rows.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={2 + (showRejoice ? 1 : 0) + (showGreat ? 1 : 0)}
                                        className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                                    >
                                        No unused hymns for this filter.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr
                                        key={`${row.songTitle}-${row.tuneName}`}
                                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                                            {row.songTitle}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                                            {row.tuneName || "—"}
                                        </td>
                                        {showRejoice && numberCell(row.rejoiceNumber)}
                                        {showGreat && numberCell(row.greatHymnsNumber)}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="px-4">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </div>

            {review.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setReviewOpen((open) => !open)}
                        className="w-full flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-gray-700 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Possible matches — review ({review.length})
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">
                            {reviewOpen ? "Hide" : "Show"}
                        </span>
                    </button>
                    {reviewOpen && (
                        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                            {review.map((entry) => (
                                <li
                                    key={`${entry.songTitle}-${entry.tuneName}`}
                                    className="px-6 py-3 text-sm"
                                >
                                    <span className="font-medium text-gray-900 dark:text-gray-100">
                                        {entry.songTitle}
                                    </span>
                                    {entry.tuneName && (
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {" "}
                                            · {entry.tuneName}
                                        </span>
                                    )}
                                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {entry.reason === "ambiguous-tune"
                                            ? `Title scheduled in PCO ("${entry.matchedPcoTitle}") — confirm which tune.`
                                            : `Close to a scheduled PCO song ("${entry.matchedPcoTitle}") — confirm if same.`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/UnusedHymns/UnusedHymnsTable.tsx
git commit -m "feat: add UnusedHymnsTable with review bucket"
```

---

## Task 11: `UnusedHymnsView` container

**Files:**
- Create: `app/components/UnusedHymns/UnusedHymnsView.tsx`

The container: fetches `/api/unused-hymns`, reads book/sort from the URL, holds page + refreshing state, derives the filtered/sorted/paged view, and composes Controls + Table. Filter/sort are derived during render (no effects); the URL is the source of truth for them.

- [ ] **Step 1: Create the component**

Create `app/components/UnusedHymns/UnusedHymnsView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { HymnEntry, ReviewEntry, UnusedHymnsResult } from "@/lib/unusedHymns";
import UnusedHymnsControls, {
    type BookFilter,
    type SortKey,
} from "./UnusedHymnsControls";
import UnusedHymnsTable from "./UnusedHymnsTable";

const ITEMS_PER_PAGE = 25;

function parseBook(value: string | null): BookFilter {
    return value === "rejoice" || value === "great" ? value : "all";
}

function parseSort(value: string | null): SortKey {
    return value === "number" ? "number" : "title";
}

function inBook<T extends HymnEntry>(entry: T, book: BookFilter): boolean {
    if (book === "rejoice") return entry.rejoiceNumber !== null;
    if (book === "great") return entry.greatHymnsNumber !== null;
    return true;
}

function numberFor(entry: HymnEntry, book: BookFilter): number {
    if (book === "great") return entry.greatHymnsNumber ?? Number.POSITIVE_INFINITY;
    if (book === "rejoice") return entry.rejoiceNumber ?? Number.POSITIVE_INFINITY;
    return (
        entry.rejoiceNumber ??
        entry.greatHymnsNumber ??
        Number.POSITIVE_INFINITY
    );
}

function sortEntries<T extends HymnEntry>(
    entries: T[],
    book: BookFilter,
    sort: SortKey
): T[] {
    const copy = [...entries];
    if (sort === "number") {
        copy.sort(
            (a, b) =>
                numberFor(a, book) - numberFor(b, book) ||
                a.songTitle.localeCompare(b.songTitle)
        );
    } else {
        copy.sort(
            (a, b) =>
                a.songTitle.localeCompare(b.songTitle) ||
                a.tuneName.localeCompare(b.tuneName)
        );
    }
    return copy;
}

function buildSummary(
    book: BookFilter,
    unusedCount: number,
    totals: { rejoice: number; greatHymns: number }
): string {
    if (book === "rejoice") {
        return `${unusedCount} of ${totals.rejoice} Rejoice Hymns never used`;
    }
    if (book === "great") {
        return `${unusedCount} of ${totals.greatHymns} Great Hymns of the Faith never used`;
    }
    return `${unusedCount} hymnbook entries never used`;
}

export default function UnusedHymnsView() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const book = parseBook(searchParams.get("book"));
    const sort = parseSort(searchParams.get("sort"));

    const [result, setResult] = useState<UnusedHymnsResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
        const baseUrl =
            process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        const url = `${baseUrl}/api/unused-hymns${refresh ? "?refresh=1" : ""}`;
        const response = await fetch(url, { signal });
        if (!response.ok) {
            throw new Error(`Failed to load unused hymns: ${response.status}`);
        }
        return (await response.json()) as UnusedHymnsResult;
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        load(false, controller.signal)
            .then((data) => {
                setResult(data);
                setError(null);
            })
            .catch((err: unknown) => {
                if ((err as Error).name === "AbortError") return;
                console.error("Error loading unused hymns:", err);
                setError("Failed to load unused hymns");
            })
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [load]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        load(true)
            .then((data) => {
                setResult(data);
                setError(null);
                setPage(1);
            })
            .catch((err: unknown) => {
                console.error("Error refreshing unused hymns:", err);
                setError("Failed to refresh unused hymns");
            })
            .finally(() => setRefreshing(false));
    }, [load]);

    const updateParam = useCallback(
        (key: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set(key, value);
            router.replace(`${pathname}?${params.toString()}`);
            setPage(1);
        },
        [pathname, router, searchParams]
    );

    if (loading) {
        return (
            <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-300">
                    Loading unused hymns…
                </p>
            </div>
        );
    }

    if (error || !result) {
        return (
            <div className="text-center py-12">
                <p className="text-red-600 dark:text-red-400 mb-4">
                    {error ?? "No data"}
                </p>
                <button
                    onClick={() => handleRefresh()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    const filteredUnused: HymnEntry[] = result.unused.filter((entry) =>
        inBook(entry, book)
    );
    const sortedUnused = sortEntries(filteredUnused, book, sort);
    const filteredReview: ReviewEntry[] = result.review.filter((entry) =>
        inBook(entry, book)
    );

    const totalPages = Math.max(1, Math.ceil(sortedUnused.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    const pageRows = sortedUnused.slice(start, start + ITEMS_PER_PAGE);

    return (
        <div className="w-full">
            <UnusedHymnsControls
                book={book}
                sort={sort}
                summary={buildSummary(book, sortedUnused.length, result.meta.totals)}
                computedAt={result.meta.computedAt}
                refreshing={refreshing}
                onBookChange={(next) => updateParam("book", next)}
                onSortChange={(next) => updateParam("sort", next)}
                onRefresh={handleRefresh}
            />
            <UnusedHymnsTable
                rows={pageRows}
                review={filteredReview}
                book={book}
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
            />
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/UnusedHymns/UnusedHymnsView.tsx
git commit -m "feat: add UnusedHymnsView container (fetch, filter, sort, paginate)"
```

---

## Task 12: The route page

**Files:**
- Create: `app/(app)/unused-hymns/page.tsx`

A server component that wraps the client view in `<Suspense>` — required because `UnusedHymnsView` calls `useSearchParams()`, which Next 15 forbids outside a Suspense boundary in a statically analyzable page.

- [ ] **Step 1: Create the page**

Create `app/(app)/unused-hymns/page.tsx`:

```tsx
import { Suspense } from "react";
import UnusedHymnsView from "@/app/components/UnusedHymns/UnusedHymnsView";

export const metadata = {
    title: "Unused Hymns",
};

export default function UnusedHymnsPage() {
    return (
        <div className="font-sans">
            <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">
                    Unused Hymns
                </h1>
                <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                    Hymns from each hymnbook that have never been scheduled in a
                    Planning Center service plan.
                </p>
            </div>
            <Suspense
                fallback={
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                    </div>
                }
            >
                <UnusedHymnsView />
            </Suspense>
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` and sign in, then visit `http://localhost:3000/unused-hymns`.
Expected: the page loads, shows a count summary, a table of unused hymns, working book-filter and sort buttons that update the URL (`?book=rejoice&sort=number`), pagination when there are >25 rows, a working Refresh, and a "Possible matches — review (N)" section if any near/ambiguous matches exist. Confirm the `Plans` / `Unused Hymns` nav links work and highlight the active page. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/unused-hymns/page.tsx"
git commit -m "feat: add /unused-hymns route page"
```

---

## Task 13: Fix the ServiceSchedule title-matching bug

`ServiceSchedule.tsx` matches PCO titles to hymn data with exact case-sensitive `===` (lines 206 and 271-272), inconsistent with the rest of the app. Align it with the shared normalizer so case/punctuation drift no longer drops a hymn.

**Files:**
- Modify: `app/components/PlanItems/ServiceSchedule.tsx`

- [ ] **Step 1: Import the normalizer**

In `app/components/PlanItems/ServiceSchedule.tsx`, add after the existing import on line 5 (`import { HymnData, HymnVersion, PlanItem } from "./PlanItems";`):

```tsx
import { normalizeTitle } from "@/lib/normalizeTitle";
```

- [ ] **Step 2: Fix the match in `getCopyText` (around line 206)**

Replace:

```tsx
                const hymn = hymnData.find((h) => h.song_title === item.title);
```

with:

```tsx
                const hymn = hymnData.find(
                    (h) => normalizeTitle(h.song_title) === normalizeTitle(item.title)
                );
```

- [ ] **Step 3: Fix the match in the render block (around line 271-273)**

Replace:

```tsx
                        const hymn = hymnData.find(
                            (h) => h.song_title === item.title
                        );
```

with:

```tsx
                        const hymn = hymnData.find(
                            (h) => normalizeTitle(h.song_title) === normalizeTitle(item.title)
                        );
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

Run: `npm run dev`, open a plan with songs, and open the Service Schedule tab. Confirm hymns that previously read "Song not found in hymn books" due to case/punctuation differences now resolve to their hymn versions, and the copy output is unchanged for already-matching songs. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/components/PlanItems/ServiceSchedule.tsx
git commit -m "fix: normalize titles when matching hymns in ServiceSchedule"
```

---

## Task 14: Final verification

**Files:** none (verification)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all tests pass (normalizeTitle, unusedHymns, pco, route).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable if pre-existing).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds; `/unused-hymns` and `/api/unused-hymns` appear in the route output.

- [ ] **Step 5: End-to-end manual pass**

Run: `npm run dev`, sign in, and verify the full flow: nav between Plans and Unused Hymns; filter by each book; sort by title and by number; paginate; refresh (note the "As of" time changes); expand the review bucket; confirm the existing Plans flow and ServiceSchedule copy output still work. Stop the dev server.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification pass for unused hymns feature"
```

---

## Self-Review Notes (for the planner)

- **Spec coverage:** detection via `last_scheduled_at` (Tasks 0,5,6) · conservative + review matching (Task 4) · multi-tune as separate units (Task 4) · real route + nav (Tasks 8,12) · URL-persisted book/sort (Task 11) · no `R-`/`G-` in table (Task 10) · in-memory cache + refresh (Tasks 6,9,11) · `lib/pco` + `Pagination` extraction (Tasks 5,7) · ServiceSchedule fix (Task 13) · Vitest + pure-logic coverage (Tasks 1–6). All spec sections map to a task.
- **`meta.totals`** was added beyond the spec's literal `meta` shape so the client can render the "X of Y" summary without bundling `hymns.json` — consistent with the spec's intent and the 150KB client-JS budget.
- **Type consistency:** `RawHymn`, `PcoSong`, `HymnEntry`, `ReviewEntry`, `UnusedHymnsResult`, `BookFilter`, `SortKey` are defined once and imported everywhere they are used; `computeUnusedHymns(hymns, pcoSongs, computedAt)`, `fetchAllSongs()`, `pcoAuthHeaders()`, and `Pagination`/`PaginationProps` signatures match across tasks.
