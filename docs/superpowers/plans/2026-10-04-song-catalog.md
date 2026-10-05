# Song catalog redesign and next-stage roadmap

> **Status:** approved 2026-10-03; implementation started 2026-10-03 in the worktree `../service-integrator-catalog`, one stacked branch per phase (`feat/catalog-0-spike`, `feat/catalog-1-core`, …). This copy is the living plan that implementer and reviewer subagents read. **[Execution](#execution) and [Spike findings](#spike-findings) at the end override anything earlier in this document.**

## Context

Service Integrator began as a proof of concept: read Planning Center (PCO) Services plans and generate copyright and service-schedule text. The multi-page routing refactor (branch `refactor/multi-page-routing`, ~97 commits ahead of `main`, another agent finishing it) is nearly done. The concept is proved; the next stage is a scalable data model and letting the app do more for its one user.

The weakest part today is the hymn store: `hymns.json`, one record per hymn (title, tune name, number in each of two books). The user's reported problems, each confirmed in the code and git history:

- **PCO title vs. hymnal title.** Matching is by normalized title text, so first-line/title differences, punctuation, translations and renamed plan items cause misses and over-matches. Every data fix in git history (typos, apostrophes, merges) exists only because the title is the join key.
- **One song looks like two.** The same hymn appears under different titles in two books, or the same tune under two names (DARWAL/DARWALL), so one song shows up as separate entries. Three hymns are still stored as two rows (one per book, the Great Hymns side with no tune).
- **One text, several tunes.** A text sung to more than one tune (23 titles, 53 records) is a title with "versions" chosen by array index.
- **Credits.** The copyright text splits PCO's single `author` field on commas and " and " and can only ever produce one words credit and one music credit; arrangers and translators cannot be expressed.
- **Books are hard-coded** under about seven spellings; adding a book touches 4 lib modules, 3 components, 7 test files, 2 docs and every record of the JSON. The deploy ships only `.next`, so the data cannot be edited without a rebuild.

Root cause: title text is doing the job of stable identifiers, both between books and between the catalog and PCO.

## Decisions (from the user, 2026-10-03)

| Topic | Decision |
|---|---|
| Users | Just the maintainer, one church. No multi-tenant work; avoid decisions that make it painful later. |
| PCO practice | **One PCO song per text+tune pairing**, with that tune's composer in the author field. A PCO song is therefore one hymn to one tune. Build around this. |
| Source of truth | Hybrid, as recommended below: PCO owns the service and the song; the app owns the hymnal index and the links. |
| Scale | 2 to 5 years of history, 397 PCO songs, ~216 plans in two service types ("Sunday Morning", "Sunday Evening"). |
| Hosting | PM2 on a self-hosted Linux box with persistent disk. SQLite is fine; a JSON export in git is the human-readable backup. |
| Calendar | Seasons and themes only. No lectionary. Fit suggestions skipped. |
| Writes to PCO | All trusted: item notes, create or edit songs, add/remove/reorder plan items, song tags. Only the maintainer edits plans, so refresh-before-write, no conflict detection. |
| New PCO songs | The app creates them fully (title from the catalog; credits and copyright typed in the app). |
| Outputs | Back into Planning Center, and a per-plan email to staff or clergy on demand. |
| Workflow today | Start in PCO, then hunt for numbers and tunes for bulletin and item descriptions. That hunt is the tedious step to remove. |
| Catalog scope | Hymnal material plus any PCO song the user chooses to pull in. |
| "Used" semantics | Exact text and tune: an entry is used only when its own PCO song was scheduled. |
| Tags | Mirror PCO tag groups; the app reads and assigns them in PCO. |
| Numbers | Plain integers suffice for numbered books. Also needed: **books with no numbering** (the church's own "Chorus Book"), and an unnumbered location such as "front cover" (the Doxology). |
| Credits | Labeled convention inside PCO's `author` field, parsed by the app into roles, edited through the app. Roles at start: Words, Music, Arr., Trans. (editable in settings). |
| Where PCO writes go | A dedicated **item note category** on each song item. Numbers only by default; tune name optional via a setting. Item titles are left alone. |
| Persistence wins | Save schedule selections per plan; a settings page instead of hard-coded strings. |
| Vocabulary | **Hymn** = the words. **Tune** = the melody. **Song** = one hymn to one tune = one PCO song. **Number** = an entry in a book. Tables: `hymns`, `tunes`, `songs`, `entries`. |
| Unused Hymns purpose | Pick hymns to introduce (a "to learn" shelf) and find forgotten favorites ("not sung since", needs history). CSV export of the list. |
| Planning help | Add a song to a chosen PCO plan from the app. |
| Dashboard (`/`) | Next Sunday's plans (AM/PM) with songs, numbers and status; stats (coverage per book, sung this year). |
| Friction to fix | Schedule tab choices (version picker goes away with ID links); plans list navigation by date; a standard way to add books, including custom unnumbered ones. |
| Order | Foundation first. |

## What exists today (code map, 2026-10-03)

- **Books:** Rejoice Hymns (`R-`) and Great Hymns of the Faith (`G-`) in `hymns.json` (929 records; `song_title`, `tune_name`, `great_hymns_of_the_faith`, `rejoice_hymns`; `-1` = not in book; `""` = no tune, 110 records; `0` once = front cover). 905 distinct titles, 23 with several tunes; 317 settings in both books. 8 descants/rounds stored as separate titles with their own numbers.
- **PCO layer** (`lib/pco/`): HTTP Basic with one org-wide PAT; GET only; `guardUrl` allows only `https://api.planningcenteronline.com/services/v2/`, refuses `%` and userinfo, `redirect: "error"`, 15 s timeout, one 429 retry when `Retry-After` is at most 5 s. `pcoFetchAll` follows `links.next` and throws past `maxPages`. Getters wrapped in React `cache()`. Fetched: service types, plans, items (`include=song`), songs. Not fetched: arrangements, keys, tags, notes, plan history.
- **Matching is by title everywhere.** Hymnbook lookup keyed by the plan item title (`lib/queries/plans.ts` → `matchHymns`); the Schedule tab re-matches on `normalizeTitle(item.title)`; Unused Hymns matches PCO song titles against hymnal titles plus `last_scheduled_at`, with a Levenshtein review bucket. Copyright joins by PCO song ID (`joinItemsToSongs`).
- **Text generation is code:** `lib/copyright.ts` (author heuristic, hard-coded `CCLI Streaming License 1564484`), `lib/serviceSchedule.ts` (`Title (R-n/G-m)` under `Sunday AM M/D/YY`; `"Sunday Morning"`/`"Sunday Evening"` literals; prints `G-0` for the Doxology). Output leaves only via the clipboard.
- **No persistence, no writes.** Schedule selections live in `PlanProvider`'s reducer and are lost on leaving the plan. In-process TTL caches only (`lib/ttlCache.ts`; the unused-hymns cache on `globalThis`).
- **Deploy** (`.github/workflows/deploy.yml`): Node 20 on the runner, `npm ci`, `npm test`, `npm run build`, then a package of `.next` + `public` + package files with `npm ci --omit=dev --ignore-scripts`, scp to the server, `.env.production` written from secrets, `pm2 restart`. The server sources nvm. `next.config.ts` has `output: 'standalone'` (unused) and `typedRoutes: true`.
- **Tests:** Vitest, node env, logic in `lib/`, stubbed-fetch helpers in `lib/pco/testing.ts`, no component/E2E harness.
- **Pattern to copy for new pages:** the Unused Hymns page (server page → `lib/queries` → `initialResult` prop → client view with `useUrlState` → server action in `actions.ts` that calls `auth()`, pending in `useState`, caches on `globalThis`).

## Recommendation

### Principle: Planning Center owns the service and the song; the app owns the hymnal index and the links

1. **Every join is by ID.** A catalog song carries its PCO song ID. Titles are for people and for *suggesting* links. This removes the title-matching bug class and makes renamed plan items harmless.
2. **A PCO song is one hymn to one tune.** The catalog adds the identities PCO cannot express: the **hymn** (words, shared by tunes), the **tune** (shared by hymns) and the **entries** (book + number or position) that point at a song.
3. **The catalog covers every hymnal entry whether or not a PCO song exists** (Unused Hymns needs them) plus any PCO song pulled in.
4. **PCO stays the only store for credits, copyright and CCLI.** Credits follow a labeled convention inside `author` (`Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe`), parsed into typed rows in the local mirror and written back by the app's credit editor. Derived rows, not a second truth. Fields that do not parse are flagged, never mass-rewritten.
5. **Tags live in PCO tag groups**, mirrored locally for filtering, assigned through the API.
6. **A local SQLite database** holds the catalog, links, a PCO mirror refreshed by sync, user state (selections, settings, shelves), import runs and a write log. A JSON export keeps the catalog diffable in git.
7. **Writes to PCO go through one module** with refresh-before-write, a preview, and an audit row.

Why not the alternatives: *everything in PCO* has no place for never-sung entries, no shared tune identity, and would encode numbers in free text; *structured files in git* still need a rebuild per edit and cannot be edited on the server; *credits only in the app DB* means two sources that drift and stale PCO song pages and CCLI reports.

### Storage: Node's built-in `node:sqlite`, hand-written SQL, migrations embedded in the build

- **Why not a native driver:** the deploy package runs `npm ci --omit=dev --ignore-scripts`, which skips `better-sqlite3`'s binary download, and a runner-built binary must match the server's platform and Node ABI. `node:sqlite` (unflagged since Node 22.13) has no install step and no ABI coupling, so the deploy stays as it is.
- **Node upgrade is due anyway:** Node 20 is end-of-life (April 2026). Pin Node 22 LTS in `.nvmrc`, `package.json#engines`, `@types/node@^22`, `deploy.yml` (`node-version: "22"`), and the server's nvm default. Phase 0 verifies `node --version`, `uname -m` and the `node:sqlite` import on the server.
- **No ORM.** Ten small tables, one user: typed row mappers in `lib/db/*` (the `mappers.ts` style already used for PCO) and SQL in named functions. Migrations are TypeScript modules exporting SQL strings (`lib/db/migrations/0001_catalog.ts` …) applied in order by `migrate(db)` against a `schema_migrations` table, so they ship inside `.next` with no deploy changes. Fallback if the spike finds a blocker: Drizzle + `better-sqlite3`, dropping `--ignore-scripts` from the package step.
- **Opening the DB:** `lib/db/index.ts` (`import "server-only"`) exposes `getDb()` that lazily opens `process.env.DATABASE_PATH` (default `./data/service-integrator.sqlite`, gitignored) and caches the handle on `globalThis` (convention 15). Nothing opens the DB at import time, so the credential-less CI build keeps working. `instrumentation.ts` `register()` (Node runtime only) runs `migrate()` and starts the schedulers (below). WAL mode, `foreign_keys = ON`.
- **Tests:** `lib/db/testing.ts` opens `:memory:`, runs `migrate()`, and offers seed builders (`seedBook`, `seedHymn`, `seedSong`, `seedEntry`, `seedPcoSong`). Queries are tested against it; pages are not tested (no harness), so every decision lives in `lib/`.
- **Backups:** a daily in-process `VACUUM INTO` to `DATABASE_BACKUP_DIR` keeping 14 files, plus the JSON export (Settings → Data, and a `scripts/export-catalog.ts`). `deploy.yml` writes `DATABASE_PATH` and `DATABASE_BACKUP_DIR` into `.env.production`, pointing outside `~/service-integrator` (the tar extracts there).

### Data model

```text
books              id, code ('R','G','CB'), name, short_name, numbered (0/1), label_format ('R-{n}'; unnumbered: short_name),
                   sort_order, active
hymns              id, title, first_line, notes                               -- the words
hymn_aliases       id, hymn_id, alias, normalized  UNIQUE(normalized)
tunes              id, name, meter, notes                                     -- ST. ANNE
tune_aliases       id, tune_id, alias, normalized  UNIQUE(normalized)
songs              id, hymn_id, tune_id (null = unknown/none), pco_song_id (null, UNIQUE), linked_at,
                   linked_by ('auto'|'manual'|'import'), notes                UNIQUE(hymn_id, tune_id)
entries            id, book_id, song_id, number (int, null), position (int, null; order inside an unnumbered book),
                   location_label ('front cover'), variant_note ('Descant, last chorus only')
                   UNIQUE(book_id, number) [NULLs allowed], UNIQUE(book_id, song_id, variant_note)
song_marks         song_id, mark ('to-learn'), note, created_at             -- the "to learn" shelf
pco_songs          id (PCO id), title, author, copyright, ccli_number, admin, hidden, last_scheduled_at,
                   updated_at, synced_at, ignored_at                         -- mirror
pco_song_credits   pco_song_id, role, name, position, parse_status ('ok'|'legacy'|'unparsed')   -- derived
pco_tag_groups     id, name, tags_for;   pco_tags  id, group_id, name;   pco_song_tags  pco_song_id, tag_id
plan_occurrences   plan_id, service_type_id, plan_date, item_id, pco_song_id, sequence, synced_at   (phase 6)
schedule_selections plan_id, item_id, option ('numbers'|'blank'|'custom'), custom_text, updated_at
settings           key, value (JSON), updated_at
import_runs        id, at, kind ('hymns-json'|'csv'), book_id, status ('preview'|'applied'|'discarded'),
                   source_name, report (JSON), rows (JSON)
sync_runs          id, kind ('pco-songs'|'tags'|'history'), started_at, finished_at, ok, message, counts (JSON)
write_log          id, at, kind ('item-note'|'song'|'item'|'tags'|'email'), target, payload (JSON), result (JSON)
schema_migrations  id, applied_at
```

Settings keys (typed in `lib/settings.ts` with defaults so the app works before anything is saved): `ccliLicenseNumber`, `scheduleHeaderLabels` (`{ "<serviceTypeId>": "Sunday AM" }`), `hymnNoteCategoryName` (default "Hymnal"), `hymnNoteTemplate` (`{numbers}` or `{numbers} · {tune}`), `numberSeparator` (` / `), `creditRoles` (`["Words","Music","Arr.","Trans."]`), `creditPhrases` (`{"Words":"Words by", …}`), `emailRecipients`, `emailSubjectTemplate`.

### Credits convention (`lib/credits.ts`, pure, tested)

- Grammar: `credits := group (";" group)*`, `group := label ":" names`, `names := name ("," name)*`; labels are the settings roles, case-insensitive; `Words & Music: X` fills both roles. Example: `Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe`.
- `parseCredits(author, roles)` returns `{ status: "ok", credits }`, `{ status: "legacy", credits }` (today's comma/" and " heuristic from `lib/copyright.ts` lines 25-74, kept as the fallback so existing songs keep working) or `{ status: "unparsed" }`.
- `renderCredits(credits)` writes the convention back; `renderCreditLine(credits, phrases)` produces `Words by A and B. Music by C. Arr. by D.` and `Words and Music by X` when the same names hold both roles. `formatCopyrightText` takes credits and settings instead of an author string; its characterization tests move under the legacy parser, and the CCLI line reads `ccliLicenseNumber`.
- The credit editor (song page) shows parse status, offers a guided split for `legacy`/`unparsed`, and writes the convention to PCO (`PATCH /songs/{id}`) only when the user saves.

### PCO writes and sync (`lib/pco/`)

- `client.ts` gains `pcoMutate<T>(method: "POST" | "PATCH" | "DELETE", path, body?)`: same `guardUrl`, `redirect: "error"`, timeout and 429 policy; `cache: "no-store"`; a 422 becomes `PcoValidationError extends PcoError` carrying PCO's `errors[].detail`. `jsonApi(type, attributes, relationships?)` builds bodies. `testing.ts` keys stub routes by `"METHOD url"` and captures bodies.
- `pacer.ts`: a token bucket on `globalThis` (80 requests per 20 s, leaving headroom under PCO's 100) that sync jobs await before each request; interactive page loads are not paced.
- `writes.ts` is the **only** module that mutates PCO: `upsertItemNote`, `deleteItemNote`, `createSong`, `updateSong`, `createItem`, `deleteItem`, `reorderItems`, `assignTags`. Each performs its fresh read, writes, and returns what changed; the caller logs a `write_log` row.
- New read getters: `getItemNoteCategories(st)`, `getItemNotes(st, plan, item)` (or `include=item_notes` on items), `getTagGroups()`, `getSongTags(songId)`, `getSongSchedules(songId)`.
- Orchestrations in `lib/queries/`: `syncHymnNotes(st, plan)` (preview = `diffHymnNotes` in `lib/hymnNotes.ts`, pure; confirm = writes), `createSongInPlanningCenter(songId, form)`, `addSongToPlan(st, plan, pcoSongId)`, `assignSongTags`, `syncPcoSongs()` (4 requests, on demand and hourly), `syncTags()`, `syncPlanHistory()` (phase 6: list plans per service type, compare `updated_at` with stored, refetch items only for changed plans; initial backfill ~220 paced requests ≈ 1 minute).
- Schedulers: `instrumentation.ts` starts `setInterval` jobs (songs hourly, history daily) guarded by a `globalThis` flag; each run writes a `sync_runs` row shown on Settings and the dashboard. Server actions trigger the same functions on demand and call `auth()` first.
- **Spike checklist (Phase 0, against a throwaway plan with the PAT):** `GET /service_types/{st}/item_note_categories`; create/update/delete of `…/items/{id}/item_notes` with the `item_note_category` relationship, and whether `include=item_notes` works on the items list; `POST /songs` and whether a default arrangement is created automatically; `POST …/plans/{p}/items` with `relationships.song` (is an arrangement required?); `DELETE …/items/{id}`; `POST …/plans/{p}/item_reorder`; `GET /tag_groups?include=tags`, `include=tags` on `/songs`, and the `assign_tags` payload; whether `last_scheduled_at` counts future plans; whether `where[updated_at]` filtering works on plans. Record findings in `docs/superpowers/plans/2026-10-04-song-catalog.md`.

### Import from `hymns.json` (one time, `lib/import/hymnsJson.ts`, pure, tested against the real file)

- Books R and G (numbered). Each record → song (hymn by `normalizeTitle`, tune by normalized name; empty tune = null and flagged) with one entry per book where the number is not `-1`.
- Split pairs (Rejoice row with tune + Great row with empty tune, same hymn, unambiguous) merge into one song with two entries; ambiguous ones ("Thank You, Lord") go to the report.
- "(Descant …)" / "(A Round)" parentheticals become `entries.variant_note` on the song with the base title and the record's tune (a round with a different tune is its own song).
- `0` → `number = null, location_label = 'front cover'`.
- A small alias/typo merge list (DARWAL→DARWALL, "Alter", "Ten Thousands", "Hallelujah! What a Savior" pairs, …) is applied and listed.
- The run is stored in `import_runs`; its report (counts: 3 split pairs, 8 variants, 110 empty tunes, merges) is the first reconcile work list. The test pins those counts.

### Linking replaces matching (`lib/reconcile.ts`, pure)

- `suggestLinks(pcoSongs, catalogIndex)` scores candidates with `normalizeTitle`, aliases, the trailing-parenthetical tune hint (`/\s*\(.*\)\s*$/` from `lib/unusedHymns.ts`) and `levenshtein`/`isNearMatch` (moved out of `lib/unusedHymns.ts`), returning `reason: "exact" | "alias" | "tune-hint" | "near"`. Exact unique matches auto-link (`linked_by = 'auto'`, undoable); the rest are chosen from suggestions or search, created as a new catalog song, or ignored.
- Catalog songs without a link are "never in PCO" (unused by definition) and offer "Create in Planning Center".

### What the existing features become

- **Plan pages / Schedule tab:** numbers come from `item.songId → songs.pco_song_id → entries`. The version picker disappears (one PCO song is one catalog song); choices become Numbers / Leave blank / Custom and persist. An unlinked song shows inline suggestions and a one-click Link instead of "Song not found in hymn books".
- **Unused Hymns:** a filter on the catalog home (`?used=never`, later `?notSince=`): never linked, or linked and never scheduled. Export CSV. The review bucket disappears except for import flags. `/unused-hymns` redirects.
- **Copyright text:** rendered from credit roles and settings.
- **Schedule text:** prefixes, order and labels from `books` (`R-396 / G-317`; `G-Front Cover`; unnumbered books print their short name).

## Pages and navigation (from the UX design)

Top bar: **Plans · Catalog** (Reports in phase 6), a Settings icon beside Sign Out (`NAV_UTILITY_ITEMS`). Catalog sub-nav from `CATALOG_SECTIONS` in `lib/routes.ts`: Songs · Tunes · Books · Reconcile · Import. Unused Hymns leaves the top bar in phase 2 (catalog filter). Param parsers beside `parsePcoId`: `parseCatalogId` (`/^[1-9][0-9]{0,9}$/`) and `parseBookCode` (`/^[A-Za-z][A-Za-z0-9_-]{0,7}$/`).

```text
app/(app)/
  page.tsx                          dashboard (phase 3: next Sunday AM/PM, link + note status; phase 6: stats)
  catalog/
    layout.tsx                      CatalogSectionNav (useSelectedLayoutSegment) + children; fetches nothing
    page.tsx · loading.tsx          songs home: getCatalogSongs() → CatalogSongsView (q, book, linked, used, sort, page in URL)
    songs/new/page.tsx              SongForm (also reached with ?pcoSongId=&returnTo=)
    songs/[songId]/page.tsx …       SongDetailView: HymnCard, TuneCard, EntriesCard, PcoLinkCard, CreditsCard, TagsCard, HistoryCard
    tunes/page.tsx, tunes/[tuneId]/page.tsx
    books/page.tsx, books/[bookCode]/page.tsx   browse by number or position
    reconcile/page.tsx · actions.ts ReconcileView: unlinked PCO songs with suggestions, unlinked catalog songs, auto-link review
    import/page.tsx, import/[runId]/page.tsx · actions.ts
    actions.ts                      catalog edits
  settings/page.tsx · actions.ts    one form per card; Export JSON; Sync now; sync status
  reports/page.tsx                  phase 6
  plans/[serviceTypeId]/[planId]/actions.ts   linkPcoSong, saveScheduleSelection, syncHymnNotes, emailPlanSummary, addSongToPlan
```

Plan pages: `PlanDetail` gains `catalog: Record<pcoSongId, CatalogMatch>`, `books`, `selections`, `notes`, `scheduleSettings`; `PlanHeader` (already a connector) renders `SyncHymnNotesAction` and `EmailSummaryAction`, each opening a `ui/Dialog` (native `<dialog>`) with a preview and a confirm; `ServiceSchedule` renders `ScheduleSongCard` per song item with `EntryNumbers` or `LinkToCatalogInline`.

Forms convention (documented once): `lib/forms.ts` `FormState` + field readers; validators in `lib/catalog/validation.ts`; actions `(prev, formData) => FormState` that call `auth()`, parse, write in a transaction, `revalidatePath`, redirect on create; client uses `useActionState`, a shared `ui/SubmitButton` (`useFormStatus`), `useOptimistic` only for rows that disappear or chips that toggle.

## Phases

Each phase is one PR to `main`, a complete feature, four gates green, every `(app)` route ƒ dynamic, docs updated. Land `refactor/multi-page-routing` first (it is an ancestor-clean fast-forward of `main`); start the new work in a fresh worktree branched from `main` (or from the routing tip if the merge slips; phase 0 touches only new files, `deploy.yml` and docs).

| Phase | Goal | Touches | User sees | Removed |
|---|---|---|---|---|
| **0 Spike & plumbing** | Prove PCO writes and SQLite on the server; ship plumbing with no product change | Node 22 pin (`.nvmrc`, engines, `@types/node`, `deploy.yml`, server nvm); `lib/db/{index,migrate,testing}.ts` + `migrations/0001`; `instrumentation.ts`; `lib/pco/client.ts` `pcoMutate`, `pacer.ts`, `testing.ts` method-keyed stubs; `deploy.yml` env (`DATABASE_PATH`, `DATABASE_BACKUP_DIR`); spike notes; architecture.md "Database" and "Writes to Planning Center" sections, conventions 17-18 | Nothing new (Settings shows "database: ok") | — |
| **1 Catalog core** | Browsable catalog seeded from `hymns.json` with a review report | Schema (books, hymns, tunes, aliases, songs, entries, import_runs, settings); `lib/queries/catalog.ts`; `lib/catalog/{ids,filter,validation}.ts`; `lib/import/hymnsJson.ts`; `/catalog`, songs/tunes/books pages, `/catalog/import`; `CATALOG_SECTIONS`, nav; `ui/Segmented`, `ui/Dialog` | Search and filter by book; song, tune, book pages; the seed report | Nothing yet (plan pages still read `hymns.json`) |
| **2 ID links** | Numbers come from links; the hunt disappears from the Schedule tab | `pco_songs` mirror + `syncPcoSongs`; `lib/reconcile.ts`; `/catalog/reconcile`; `/catalog/songs/new` (first form); `getPlanDetail` → `catalog`/`books`; `ScheduleSongCard`, `LinkToCatalogInline`, `EntryNumbers`; plan `actions.ts` (`linkPcoSong`); behavior commits flipping `lib/serviceSchedule.test.ts` and `lib/scheduleSelections.test.ts` (version picker removed); catalog `?used=never` + CSV export (`lib/csv.ts`); `/unused-hymns` → redirect | Auto-linked exact matches; one-click Link on unlinked songs; renamed items keep numbers; Unused Hymns as a catalog filter with CSV | `hymns.json`, `lib/hymnCatalog.ts`, `lib/hymnMatch.ts`, `computeUnusedHymns`, `lib/queries/unusedHymns.ts`, `UnusedHymns/*`, `HymnData`/`HymnVersion`, `selectedVersionIndex` |
| **3 Persist, settings, hymnal notes, dashboard v1** | Choices survive; numbers land in PCO; the app opens on next Sunday | `schedule_selections`, `settings`, `write_log`; `lib/settings.ts`, `/settings`; `lib/hymnNotes.ts` (`formatHymnNote`, `diffHymnNotes`); `lib/pco/itemNotes.ts` + `writes.ts`; `SyncHymnNotesAction`/`Dialog`; `saveScheduleSelection`; copyright/schedule read settings; `/` dashboard (next AM/PM plans, link and note status, to-dos) | Persisted selections; Settings; "Sync hymn notes" with per-item preview; a dashboard | Hard-coded CCLI number and service-type literals |
| **4 PCO song lifecycle & outputs** | Create songs in PCO, typed credits, tags, add to plan, email | `lib/credits.ts` + `CreditsCard` editor; `createSongInPlanningCenter`; `addSongToPlan` (song page → pick an upcoming plan); `pco_song_credits`, tag mirror + `TagsCard` + filters; `lib/email.ts` (Nodemailer over `SMTP_URL`, `EMAIL_FROM`) + `EmailSummaryAction` | "Create in Planning Center" prefilled; credits with roles; tag filters; add to plan; Email button | The author heuristic becomes the legacy parser only |
| **5 Catalog editing & books** | Day-to-day edits and new books without touching files | Remaining forms (entries, rename, aliases, merge hymns/tunes with preview, add/reorder books incl. unnumbered); `lib/catalog/merge.ts`; `lib/import/bookCsv.ts` + preview/apply; `exportCatalogJson`; `song_marks` "to learn" shelf; plans list date navigation (month jump / upcoming vs past) | Edit anything; import a book from CSV with a validation report; JSON backup; a "to learn" shelf | The seed-from-`hymns.json` button and its module |
| **6 History & reports** | What was sung over 2-5 years, and planning help from it | `plan_occurrences` + `syncPlanHistory` (paced, incremental); `lib/queries/history.ts`, `lib/reports.ts`, `/reports`; `HistoryCard`; `?notSince=` on the catalog; dashboard stats; repeat warnings on the plan page; item reorder if the spike confirmed it | Reports by frequency, last sung, not sung since; song history; stats | `last_scheduled_at` stops being the only usage signal |

Docs per phase in `docs/architecture.md`: Database and Writes sections (0); Overview table rows, route map, recipe "Add a catalog page", convention 19 (a parser per ID kind) (1); recipe "Add a server-action form", the selections exception to "server data stays in props" (2); recipes "Add a PCO write" and "Add a setting" (3); "Add a book" and "Import a book from CSV" in README too (5); "Add a report" and pacer notes (6). `CLAUDE.md` gets one line about migrations.

## Verification

- **Gates per PR:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` (every `(app)` route ƒ). CI runs `npm test` before deploy.
- **Phase 0:** on the server, `node --version` ≥ 22.13 and `node -e "require('node:sqlite')"`; `curl` the spike endpoints with the PAT against a throwaway plan and record results; after deploy, `/settings` shows the database path and migration count; a `VACUUM INTO` backup file appears.
- **Phase 1:** the import test pins counts (929 records → N songs, 3 split pairs, 8 variants, 110 empty tunes); `/catalog` search for "Amazing Grace" shows R and G numbers; `/catalog/books/G` lists Doxology as "Front cover".
- **Phase 2:** `/catalog/reconcile` after Sync shows the auto-link count; a plan with a renamed item ("Amazing Grace (Acoustic)") shows numbers on the Schedule tab; Copy All text matches the pinned new format; `/unused-hymns` redirects; CSV downloads and opens in a spreadsheet.
- **Phase 3:** choose Custom text, leave the plan, return: it persists; "Sync hymn notes" preview lists create/update/unchanged per item, confirm writes notes visible in the PCO plan UI, a second sync shows all unchanged; `/` shows next Sunday's AM and PM plans.
- **Phase 4:** create a catalog song in PCO, see it in PCO with the labeled author string, link stored; edit credits of a legacy song and see the copyright text change; Email sends to the configured recipients and logs a row; Add to plan appears as a new item in PCO.
- **Phase 5:** add a "Chorus Book" (unnumbered), import a CSV with a deliberate duplicate number and see the report block it; mark a song "to learn" and filter on it; export JSON and diff against the previous export.
- **Phase 6:** after backfill, a song page shows its history; `/reports` last-sung agrees with PCO's `last_scheduled_at` for a sample of songs; sync runs appear on Settings.
- **Browser checks** while signed in with `npm run dev`; prefetch behavior under `npm run build && npm start`.

## Risks and defaults

1. **`node:sqlite` is still marked experimental** (stability 1.1) even though unflagged. Default: use it behind `lib/db/index.ts` so a swap to `better-sqlite3` touches one file; the spike confirms the import works inside `next start`.
2. **Item note categories** must exist per service type (the API does not create them). Default: category named "Hymnal" (setting); Settings lists found categories and warns; sync skips a service type with a clear message rather than writing to `description`.
3. **The labeled author convention** changes what PCO shows and 397 songs do not follow it. Default: never mass-rewrite; legacy parser for existing fields; write the convention only when the user edits credits.
4. **Rate limit during backfill.** Default: the pacer at 80/20 s; backfill runs from the scheduler, not from a page render.
5. **Behavior changes** (version picker removed, `G-0` → `G-Front Cover`, settings-driven header) each land in their own commit that flips the pinned assertions.
6. **Email transport.** Default: Nodemailer over SMTP with a Google Workspace app password; Resend if SMTP is blocked from the host.
7. **The in-flight routing branch.** Default: merge it first; if it slips, base phase 0 on its tip and rebase once.

## Final confirmations (user, 2026-10-03)

- **Storage driver:** `node:sqlite` with hand-written SQL and build-embedded migrations; Node 22 LTS. Drizzle + `better-sqlite3` is the documented fallback only.
- **Version picker:** removed. Schedule tab choices are Numbers / Leave blank / Custom, persisted per plan. Its own behavior commit flips the pinned tests.
- **Unnumbered books in schedule text:** configurable per book through `books.label_format`, defaulting to the book's short name (`Title (R-396 / Chorus Book)`).
- **Branching:** land `refactor/multi-page-routing` to `main` first, then start phase 0 in a new worktree branched from `main`.

## First concrete steps when implementation starts

1. Confirm the routing branch has merged and `main` deployed; `git worktree add ../service-integrator-catalog -b feat/catalog-0-spike main`.
2. Phase 0 spike: Node 22 on runner and server; `node:sqlite` import inside `next start`; the PCO endpoint checks listed above against a throwaway plan; write findings to `docs/superpowers/plans/2026-10-04-song-catalog.md`.
3. Phase 0 plumbing PR: `lib/db/*` with `migrate()` and `:memory:` tests, `instrumentation.ts`, `pcoMutate` + `pacer.ts` + method-keyed stubs with tests, `deploy.yml` env additions, architecture.md sections. Four gates green; no product change.
4. Then phase 1 as tabled.

## Execution

Decisions the orchestrator made where the plan was silent or inconsistent. They override the sections above.

**Branches and worktrees.** Phase 0 lives in `/Users/davidpolar/dev/service-integrator-catalog`; each later phase N gets its own sibling worktree, `/Users/davidpolar/dev/service-integrator-catalog-p<N>`, so a phase under review keeps its files while the next one is built. The main checkout stays on `main`. One branch per phase, each stacked on the previous one: `feat/catalog-0-spike`, `feat/catalog-1-core`, `feat/catalog-2-links`, `feat/catalog-3-persist`, `feat/catalog-4-pco-songs`, `feat/catalog-5-editing`, `feat/catalog-6-history`. Nothing is pushed and no PR is opened without the user.

**Node.** CI and the server run Node 22 LTS (`.nvmrc`); local development may run a newer Node. Write code against the **Node 22.13** API: check the "Added in" notes in the Node docs before using any `node:sqlite` method or option, because CI runs the tests on 22. The orchestrator re-runs the tests on Node 22 at the end of each phase.

**Migrations.** One migration per phase, applied in order, never edited once committed (a change is a new migration):

| File | Phase | Tables |
|---|---|---|
| `0001_init.ts` | 0 | `settings`, `sync_runs` |
| `0002_catalog.ts` | 1 | `books`, `hymns`, `hymn_aliases`, `tunes`, `tune_aliases`, `songs`, `entries`, `import_runs` |
| `0003_pco_songs.ts` | 2 | `pco_songs` |
| `0004_selections.ts` | 3 | `schedule_selections`, `write_log` |
| `0005_credits_tags.ts` | 4 | `pco_song_credits`, `pco_tag_groups`, `pco_tags`, `pco_song_tags` |
| `0006_marks.ts` | 5 | `song_marks` (and any book changes) |
| `0007_history.ts` | 6 | `plan_occurrences` |

**Database access.**
- `getDb()` opens the file, sets the pragmas and runs `migrate()` once on first open (idempotent). `instrumentation.ts` calls it at boot so a bad database shows up in the log at once, but a boot failure is logged, not thrown: plan pages do not need the database until phase 2, and Settings shows the error.
- Layering mirrors `lib/pco` + `lib/queries`: `lib/db/<area>.ts` holds SQL in named functions that take `db: DatabaseSync` first and are tested on `:memory:` (`lib/db/testing.ts`); `lib/queries/<area>.ts` (server-only) calls `getDb()` and `@/lib/pco` and is what pages import. Writes run inside `withTransaction(db, fn)` with a synchronous `fn`.
- `sync_runs.kind` also takes `'backup'`, so the daily `VACUUM INTO` is listed on Settings like the sync jobs.

**hymns.json.** Phase 2 removes every *runtime* reader of it (`lib/hymnCatalog.ts`, `lib/hymnMatch.ts`, Unused Hymns). The file itself stays as the seed import's input until phase 5 removes the seed module; then the file goes too, replaced by the JSON export.

**Seed import.** Preview always works; apply refuses when the catalog already has books, so the seed can never run twice.

**Server steps belong to the user.** The orchestrator cannot reach the server. Before phase 0 merges, the user installs Node 22 with nvm, makes it the default, and runs `pm2 update` so the PM2 daemon and the app move to it. `deploy.yml` checks `node:sqlite` on the server before extracting the package, so a deploy to an old Node fails and leaves the running build in place.

### Phase 1 design (catalog core)

**Schema (`0002_catalog.ts`, `STRICT` tables, ISO-8601 UTC text timestamps).**
- `books`: `code` unique (`COLLATE NOCASE`), `name`, `short_name`, `numbered` (0/1), `label_format` (`'R-{n}'`; an unnumbered book's is its short name, e.g. `'Chorus Book'`), `sort_order`, `active`.
- `hymns` (`title`, `first_line`, `notes`) and `tunes` (`name`, `meter`, `notes`); titles and names are not unique (two texts can share a title). `hymn_aliases`/`tune_aliases` (`alias`, `normalized` UNIQUE, `ON DELETE CASCADE`).
- `songs`: `hymn_id` NOT NULL, `tune_id` NULL = unknown, `pco_song_id` TEXT UNIQUE NULL, `linked_at`, `linked_by` (`'auto' | 'manual' | 'import'`), `notes`; `UNIQUE(hymn_id, tune_id)` **plus a partial unique index `ON songs(hymn_id) WHERE tune_id IS NULL`** (SQLite treats NULLs as distinct, so the plain UNIQUE would allow two tune-less songs of one hymn).
- `entries`: `book_id`, `song_id` (no cascade: merges move entries explicitly), `number` (NULL or > 0), `position`, `location_label`, `variant_note`; `UNIQUE(book_id, number)`, `UNIQUE(book_id, song_id, variant_note)` **plus a partial unique index `ON entries(book_id, song_id) WHERE variant_note IS NULL`** for the same NULL reason; an index on `song_id`.
- `import_runs`: `at`, `kind` (`'hymns-json' | 'csv'`), `book_id` NULL, `status` (`'preview' | 'applied' | 'discarded'`), `source_name`, `report` (JSON), `rows` (JSON: the planned rows, so apply writes exactly what was previewed).

**Types.** Catalog domain types go in `lib/domain.ts` (convention 4) under a "Catalog" heading: `Book`, `Hymn`, `Tune`, `Entry`, `CatalogSongSummary` (a row of the songs list: song id, hymn id and title, tune id and name, PCO song id, entry labels), `CatalogSongDetail`, `TuneSummary`, `BookSummary`, `ImportRunSummary`. Catalog IDs are integers: `parseCatalogId(raw)` (`/^[1-9][0-9]{0,9}$/`) returns a `number` or `null`; `parseBookCode(raw)` (`/^[A-Za-z][A-Za-z0-9_-]{0,7}$/`) returns the code or `null`; both in `lib/catalog/ids.ts` (pure, client-safe), beside `parsePcoId` in spirit (convention 19: a parser per ID kind).

**Labels** (`lib/catalog/labels.ts`, pure): `formatEntryLabel(book, entry)`: a numbered book replaces `{n}` in `label_format` with the number, or with the title-cased `location_label` when there is no number (`G-Front Cover`); an unnumbered book prints its `label_format` (its short name). A `variant_note` is shown beside the label in the UI, never inside it.

**Seed import** (`lib/import/hymnsJson.ts`, pure; tested against the real `hymns.json`). Plans rows keyed by normalized strings (IDs come at apply time):
- Books `R` "Rejoice Hymns" (`R-{n}`, sort 1) and `G` "Great Hymns of the Faith" (`G-{n}`, sort 2), both numbered.
- Hymn identity = `normalizeTitle(title)` after the alias table; tune identity = upper-cased, space-collapsed name after the alias table; song identity = (hymn, tune). Records with the same identity become one song with several entries. The canonical spelling is the first record's in file order.
- One entry per book whose number is not `-1`; `0` becomes `number NULL, location_label 'front cover'` (the Doxology in G).
- **Variants:** a title ending in `(Descant …)` or `(A Round)` maps to the base title's hymn with `variant_note` = the parenthetical's text; its tune is the record's, or, when empty, the base hymn's only tune (else NULL and flagged). A round with its own tune ("Jesus Loves Me (A Round)", LEOTA) is therefore its own song; descants share the base song.
- **Split pairs:** a Great-only record with no tune whose hymn has Rejoice records with tunes: exactly one distinct tune → the same song (merged); more than one → a tune-less song flagged `ambiguous-split-pair` ("Thank You, Lord", G-221).
- **Merge list** (explicit, listed in the report): tune alias `DARWAL` → `DARWALL`; hymn aliases "Rejoice – the Lord Is King" → "Rejoice, the Lord Is King" and "Hallelujah, What a Savior!" → "Hallelujah! What a Savior"; title fixes (canonical title + the old spelling as an alias) "Is Your All on the Alter?" → "…Altar?" and "Hark! Ten Thousands Harps and Voices" → "Hark! Ten Thousand Harps and Voices". Write non-ASCII characters in these keys as `\u` escapes (convention 16).
- **Report**: input counts, rows planned, split pairs (merged / ambiguous), variants, the merges applied, songs without a tune, and "possible duplicates" (near-identical titles that were *not* merged, e.g. "Walk in the Light" / "Walking in the Light") for human review.
- **Expected counts** (the orchestrator's hand count; the test pins the real values and any difference must be explained): 929 records → 895 hymns, 768 tunes, 921 songs (107 without a tune), 1,247 entries (R 708, G 539, one front cover), 3 split pairs (2 merged, 1 ambiguous), 8 variants, 110 input records with no tune.

**Pages.** `/catalog` (songs list, client-side filter/sort/page over all rows like Unused Hymns: `q`, `book`, `sort`, `page` in the URL through `useUrlState`; an empty catalog shows an `EmptyState` pointing at Import), `/catalog/songs/[songId]` (HymnCard with aliases and the hymn's other tunes, TuneCard with the tune's other hymns, EntriesCard), `/catalog/tunes` and `/catalog/tunes/[tuneId]`, `/catalog/books` and `/catalog/books/[bookCode]` (entries by number, or by position for an unnumbered book; the front cover first), `/catalog/import` (runs list + "Preview seed from hymns.json") and `/catalog/import/[runId]` (the report; Apply and Discard behind a `ui/Dialog` confirm; Apply refuses when books exist). `catalog/layout.tsx` renders `CatalogSectionNav` from `CATALOG_SECTIONS` (Songs · Tunes · Books · Import; Reconcile joins in phase 2) and fetches nothing. Nav: Plans · Catalog · Unused Hymns (Unused Hymns leaves in phase 2). New shared UI: `ui/Segmented`, `ui/Dialog` (native `<dialog>`), `ui/SubmitButton` (`useFormStatus`). Detail pages get `not-found.tsx`; list pages `loading.tsx`; `generateMetadata` reads the DB in a try/catch and never throws.

### Phase 2 design (ID links)

**Mirror (`0003_pco_songs.ts`).** `pco_songs`: `id` TEXT PRIMARY KEY (the PCO id), `title`, `author`, `copyright`, `ccli_number`, `admin`, `themes`, `hidden` (0/1), `last_scheduled_at` (PCO's value: org-local time labelled `Z`, and it counts upcoming plans), PCO's `created_at`/`updated_at`, `synced_at` (last seen by a sync), `removed_at` (gone from PCO; rows are never deleted, so links never dangle), `ignored_at` (Reconcile's "Ignore": not hymnal material), and **`auto_link_blocked_at`** (set when the user undoes an auto-link, so the next sync does not redo it; manual links still work). There is no foreign key from `songs.pco_song_id` (SQLite cannot add one without rebuilding `songs`); the link functions keep the two consistent.

**Sync (`syncPcoSongs`).** One paced `pcoFetchAll('/songs?per_page=100')` (about 4 requests; not the `cache()`d getter), then in one transaction: upsert every song, set `removed_at` on rows the full listing no longer contains (only after a complete fetch), clear it on rows that came back, then auto-link. A `pco-songs` job runs it hourly and at boot (`JOBS` in `lib/jobs.ts`), and "Sync now" (Settings and Reconcile) runs it on demand through `runJob`.

**Matching (`lib/reconcile.ts`, pure).** `levenshtein`/`isNearMatch` move from `lib/unusedHymns.ts` to `lib/fuzzy.ts`. A catalog index maps normalized hymn titles and aliases to songs, and normalized tune names and aliases to tunes. `suggestLinks(pcoSong, index)` returns ranked candidates with `reason`:
- `exact`: the normalized PCO title is a hymn's title;
- `alias`: it is a hymn alias;
- `tune-hint`: a trailing parenthetical names a tune (`/\s*\(.*\)\s*$/`), so base title + tune pick one song;
- `near`: `isNearMatch` on the normalized title.
**Auto-link** only when: the PCO song is unlinked, not ignored, not removed and not blocked; it has exactly one candidate song with a strong reason (exact, alias or tune-hint); that catalog song is unlinked; and no other PCO song has the same unique strong candidate. It sets `linked_by = 'auto'`. A hymn with several tunes is never auto-linked from a bare title.

**Linking.** Link and unlink are named functions in `lib/db/` used by every caller (sync, Reconcile, the plan page, the new-song form). Linking from a page also upserts the PCO song into the mirror first (one `GET /songs/{id}` when the row is missing), so a link made before the first sync is complete. One PCO song links to at most one catalog song and vice versa (`songs.pco_song_id` is UNIQUE): linking a song that is already linked elsewhere is refused with a clear message, never silently moved.

**Plan pages.** `getPlanDetail` drops `hymns` and gains:
- `catalog: Record<pcoSongId, CatalogMatch>`: song id, hymn title, tune name and labelled entries in book order, for every song item whose PCO song is linked;
- `suggestions: Record<pcoSongId, LinkSuggestion[]>`: the top 3, for linked-able items that are not linked yet.
`PlanItemDetail` and the copyright tab are unchanged. The Schedule tab renders a `ScheduleSongCard` per song item:
- linked: the hymn and tune, `EntryNumbers` (`R-396 / G-317`) and the choices **Numbers** (default) / **Leave blank** / **Custom**;
- unlinked, with a PCO song: `LinkToCatalogInline` (suggestions, each with a one-click Link; "Find in catalog" goes to Reconcile) and **Leave blank** (default) / **Custom**;
- no PCO song: **Leave blank** / **Custom**.
`linkPcoSong` in `plans/[serviceTypeId]/[planId]/actions.ts` checks the session, parses every id, links (`manual`) and revalidates the plan, so the numbers appear without leaving the tab.

**Selections.** `ScheduleSelection` becomes `{ option: "numbers" | "blank" | "custom"; customText?: string }` (the phase 3 table's shape); `selectedVersionIndex` and the version picker go. The default is `numbers` for a linked song with entries, else `blank`.

**Schedule text.** One line per song item in sequence: `numbers` → `Title (R-396 / G-317)` (labels in book order, from the link); `custom` with text → `Title (text)`; otherwise `Title`. The header stays as it is until phase 3. **Behavior commits**, each flipping only the assertions it changes: (1) numbers come from the catalog link and the version picker is gone; (2) labels are joined with `" / "` and the Doxology prints `G-Front Cover` (was `G-0`).

**Catalog filters.** List rows gain the link state and the PCO song's `last_scheduled_at`. New URL filters: `linked` (`all` / `yes` / `no`) and `used` (`all` / `never`; never = not linked, or linked and never scheduled). "Export CSV" downloads the filtered rows from the browser (`lib/csv.ts`, RFC 4180, pure; no API route): title, tune, one column per book, linked, last scheduled.

**Reconcile (`/catalog/reconcile`, in `CATALOG_SECTIONS`).** PCO songs not in the catalog (not ignored or removed), each with suggestions, Link, a searchable picker over every catalog song, "New catalog song" (`/catalog/songs/new?pcoSongId=&returnTo=`) and Ignore; recent auto-links with Undo (unlink + block); counts of catalog songs not in PCO (a link to `/catalog?linked=no`); the last sync and "Sync now". Ignored songs are listed collapsed with Unignore.

**New song form (`/catalog/songs/new`).** The first form, and the model for later ones: `lib/forms.ts` (`FormState`, field readers), validators in `lib/catalog/validation.ts`, an action `(prev, formData) => FormState` that checks the session, parses, writes in `withTransaction`, revalidates and redirects on success; the client uses `useActionState` and `ui/SubmitButton`. Fields: the hymn (pick an existing one or type a new title), the tune (existing, new name, or none), an optional first entry (book + number) and the hidden `pcoSongId`/`returnTo` (validated as a safe internal path). With `pcoSongId` the form prefills from the PCO title (a tune hint fills the tune) and links on create. Duplicate song (same hymn and tune) or taken number → a field error with a link to what exists.

**Removed in phase 2.** `/unused-hymns` becomes a permanent redirect to `/catalog?used=never`; `lib/queries/unusedHymns.ts`, `computeUnusedHymns`, `app/components/UnusedHymns/*`, the refresh action, `lib/hymnMatch.ts`, `HymnData`/`HymnVersion`, and the Unused Hymns nav item go. `lib/hymnCatalog.ts` goes too: the seed reads `hymns.json` through a server-only module in `lib/import/` until phase 5.

### Phase 3 design (persist, settings, hymnal notes, dashboard v1)

**Schema (`0004_selections.ts`).**
- `schedule_selections`: `plan_id`, `item_id` (PCO ids, text), `option`, `custom_text`, `updated_at`; primary key `(plan_id, item_id)`.
- `write_log`: `id`, `at`, `kind`, `target` (e.g. `plan 123 item 456`), `ok` (0/1), `payload` (JSON), `result` (JSON).
- Enumerations (`option`, `kind`) are checked in TypeScript, as `sync_runs.kind` is (the Database section's rule). The `settings` table exists since `0001`.

**Settings (`lib/settings.ts`, pure, plus `lib/db/settings.ts` and `lib/queries/settings.ts`).**
- A typed registry: each key has a parser that turns stored JSON into a valid value or rejects it, and a **default that reproduces today's output**, so the app behaves exactly as before until something is saved. A stored value that no longer parses falls back to its default and is reported on Settings.
- Phase 3 keys:
  - `ccliLicenseNumber` (default `"1564484"`);
  - `scheduleHeaderLabels` (by service type id; with no entry, a type named "Sunday Morning" or "Sunday Evening" keeps today's "Sunday AM"/"Sunday PM" and other types get no header);
  - `numberSeparator` (default `" / "`);
  - `hymnNoteCategoryName` (default `"Hymnal"`);
  - `hymnNoteIncludesTune` (default `false`; when true the note reads `R-396 / G-317 · ST. ANNE`).
- Phase 4 adds the credit and email keys.
- `getSettings()` never throws: on a database error it returns the defaults and the error.

**Text reads settings.**
- `formatCopyrightText`'s CCLI line comes from `ccliLicenseNumber`, and the schedule header and separator come from settings.
- With the defaults the output is unchanged, so the existing assertions hold. The change is one commit that threads settings through and adds tests for non-default values.

**Persisted selections.**
- `getPlanDetail` gains `selections` (this plan's rows) and `scheduleSettings`.
- `PlanProvider` seeds its reducer from `selections`. Every change is applied locally at once and saved through `saveScheduleSelection(serviceTypeId, planId, itemId, option, customText)`: custom text goes after the existing debounce, a radio choice at once.
- A failed save shows an inline "Not saved, retry" and keeps the local choice.
- A stored selection that no longer makes sense (`numbers` for a song that lost its link, an item no longer in the plan) falls back to the default and is never deleted silently.
- `docs/architecture.md`'s State section records the exception: the provider is seeded from server data once and then owns the selections.

**Hymnal notes.**
- **Reads.**
  - `getPlanItems` asks for `include=song,item_notes`. Each `PlanItem` gains its notes (`id`, `categoryId`, `categoryName`, `content`).
  - `getItemNoteCategories(serviceTypeId)` is a new `cache()`d getter.
  - The category is found by name, case-insensitively and trimmed, per service type. The ids differ per type (spike).
- **`lib/hymnNotes.ts`** (pure):
  - `formatHymnNote(match, settings)` builds a song item's note from its catalog link: the labels joined by the separator, plus the tune when that is on.
  - `diffHymnNotes(items, categoryName, settings)` gives each song item one of:
    - `create`;
    - `update` (content differs);
    - `unchanged`;
    - `delete` (a Hymnal note with nothing to say: the song is unlinked or has no numbers);
    - `dedupe` (extra Hymnal notes on one item, which PCO allows: keep the first, delete the rest).
  - Notes in other categories are never touched. Schedule-tab choices do not affect notes: notes carry the hymnal numbers for musicians, while the selections are for the bulletin text.
- **`lib/pco/writes.ts`** is the only module that mutates PCO (convention 18):
  - `createItemNote`, `updateItemNote` (PATCH `content` only: a note's category can never change) and `deleteItemNote`;
  - each takes validated ids, uses `pcoMutate` (unpaced: interactive) and returns what changed.
- **`lib/queries/hymnNotes.ts`**:
  - `previewHymnNotes(st, plan)` returns the category, or the reason it is missing, plus the per-item diff.
  - `syncHymnNotes(st, plan)` **re-reads the plan's items first** (refresh-before-write) and recomputes the diff. It then applies the changes one by one, writes a `write_log` row for each (`kind: "item-note"`, with the outcome or the PCO error), and returns per-item results.
  - A missing category refuses with "Create an item note category named "Hymnal" in Planning Center for <service type>" and writes nothing.
- **UI.**
  - `PlanHeader` gets a "Sync hymn notes" button that opens a `ui/Dialog`: the preview (create, update, delete and unchanged per item), Confirm, then the results.
  - **Both the preview and the confirm call Planning Center, so they are server actions called from event handlers with their pending state in `useState`, never `useActionState` or `<form action>`.** A form action runs inside a transition, which would make every navigation wait for PCO (convention 15 as reconciled in phase 1).
  - The dialog cannot be dismissed while the confirm runs, and the result is shown where it can be seen.
  - After a sync the plan is revalidated.
  - Song cards show a small note status: in sync, differs, or missing.

**Dashboard (`/`).**
- `/` stops redirecting and becomes the dashboard. For each service type, it shows the next upcoming plan (`filter=future`, the earliest by `sort_date`) with:
  - its song items and their numbers;
  - link status (with a Link to fix one);
  - hymnal-note status;
  - a "Sync hymn notes" shortcut.
- To-dos: songs not in the catalog, notes out of date, a failed or stale `pco-songs` sync, an empty catalog (link to Import), and a missing Hymnal category.
- `getDashboard()` loads in parallel: the service types, each type's next plan, and that plan's items. A service type that fails shows a quiet warning, as the plans list does.
- The app name links to `/`. On phones, where the name is hidden, a home link must still exist.
- The Plans nav item stops claiming `/`.

**Settings page.**
- One form per card (the "Add a server-action form" recipe), each saving through `lib/queries/settings.ts`:
  - Copyright (CCLI number);
  - Schedule text (a header label for each service type, and the separator);
  - Hymnal notes (category name, whether the note includes the tune, and the category found in each service type, with a warning where it is missing).
- A "Recent writes to Planning Center" card lists the last 20 `write_log` rows.

**Docs.** Two new recipes, "Add a PCO write" and "Add a setting"; the State exception; the write log; and the dashboard in the route map.

### Phase 4 design (PCO song lifecycle and outputs)

**Schema (`0005_credits_tags.ts`).**
- `pco_song_credits` (`pco_song_id`, `role`, `name`, `position`, `parse_status`): derived from each mirrored song's `author` on every sync and every credit save. These rows are never edited directly.
- `pco_tag_groups` (`id`, `name`, `tags_for`, `allow_multiple`), `pco_tags` (`id`, `group_id`, `name`) and `pco_song_tags` (`pco_song_id`, `tag_id`): a mirror of song tag groups only (`tags_for = "song"`).

**Credits (`lib/credits.ts`, pure).**
- Grammar: `credits := group (";" group)*`, `group := label ":" names`, `names := name ("," name)*`.
  - Labels are the `creditRoles` setting (default `Words`, `Music`, `Arr.`, `Trans.`), matched case-insensitively.
  - "Words & Music: X" (or "and") fills both roles.
- `parseCredits(author, roles)` returns one of:
  - `{ status: "ok", credits }`;
  - `{ status: "legacy", credits }` when the string has no labels at all. Today's comma/" and " heuristic moves here **verbatim, quirks included**, so every existing song's copyright text stays byte-identical. The `copyright.test.ts` characterization tests move under it;
  - `{ status: "unparsed", raw }` when it has labels that do not parse. The copyright text then falls back to the legacy rendering of the raw string, so nothing an author typed today changes output.
- `renderCredits(credits)` writes the convention back: `Words: Isaac Watts; Music: Lowell Mason`.
- `renderCreditLine(credits, phrases)` gives "Words by A and B. Music by C. Arr. by D.", and "Words and Music by X" when the same names hold both roles.
- `formatCopyrightText` takes the parsed credits plus settings (`creditPhrases`, `ccliLicenseNumber`). The legacy path's output equals today's.
- New settings: `creditRoles` and `creditPhrases`, with defaults that reproduce today's phrases.

**PCO writes** (`lib/pco/writes.ts`; each takes validated ids and returns what changed; callers write a `write_log` row and update the mirror):
- `createSong(attributes)`: never sends `ccli_number` on create (the spike: PCO then overwrites the credits).
- `updateSong(songId, attributes)`: PATCH without `data.id`, which the spike showed works.
- `getSongDefaultArrangement(songId)`: the first arrangement, for new items.
- `createSongItem(st, plan, { songId, arrangementId, title })`: appended at the end, since no `sequence` was sent.
- `assignSongTags(songId, tagIds)`: replace semantics, so the caller sends the full set and only song-group tag ids.

**Flows** (`lib/queries/pcoSongs.ts`, server-only; each one re-reads first, then writes, then logs):
- **Credits editor.**
  - The song page's CreditsCard shows the parse status (ok, legacy, unparsed) and the roles as rows of names. A guided split turns a legacy string into roles.
  - Save re-reads the PCO song, writes `renderCredits` to `author`, then updates the mirror and the derived credits.
  - Never a mass rewrite: one song, when the user saves.
- **Create in Planning Center** (a catalog song with no link).
  - A form prefilled with the hymn title (plus ` (TUNE)` when the hymn has several tunes, which is the church's practice), the credits as roles, the copyright and an optional CCLI number.
  - Creating POSTs the song without the CCLI number. When there is one, it is then PATCHed in and the song read back; any credit or title PCO replaced is written back unless the user ticked "Use CCLI's details".
  - Then the song is linked (`manual`) and mirrored.
- **Add to plan** (song page, linked songs).
  - Pick one of the upcoming plans (`filter=future` per service type).
  - The item gets the song's PCO title and its default arrangement.
  - Revalidate that plan. Writes go one at a time, with no undo; the confirmation names the plan.
- **Tags.**
  - A `tags` job, hourly after `pco-songs`, reads `tag_groups?include=tags` (song groups only), then `songs?where[song_tag_ids]=<id>` per song tag, using ids only from that fresh read.
  - The song page's TagsCard edits tags per group, respecting `allow_multiple_selections`. Save re-reads the song's tags, sends the full new set, updates the mirror and logs.
  - The catalog list gains a `tag` filter.

**Email** (`lib/email.ts` with Nodemailer over `SMTP_URL`, from `EMAIL_FROM`).
- Not configured → the Email button explains how to configure it and sends nothing.
- `EmailSummaryAction` on the plan header opens a `ui/Dialog` preview:
  - the subject from `emailSubjectTemplate` (e.g. `Songs for {date} · {service}`);
  - recipients from `emailRecipients`;
  - a plain-text body: the plan, the schedule text, then each song's copyright text.
- Send writes a `write_log` row (`kind: "email"`) without the body's personal data; recipients are fine.
- Tests use a stub transport.
- `deploy.yml` writes `SMTP_URL` and `EMAIL_FROM` from secrets when they are set.
- The preview is local, but Send waits on SMTP, so Send is an event-handler action with its pending state in `useState` (convention 15).

**Settings.** New cards for credits (roles and their phrases) and email (recipients, subject template, and whether the transport is configured).

### Phase 5 design (catalog editing and books)

**Schema (`0006_marks.ts`).**
- `song_marks`: `song_id` (FK, cascade), `mark` (`'to-learn'`, checked in TypeScript), `note`, `created_at`, with primary key `(song_id, mark)`.
- Any book change the editing needs goes in the same migration.

**Forms.** Every phase 5 form uses the `onSubmit` + `useState` pattern, as Settings' forms do. The song page renders cards that read Planning Center (for example the Add-to-plan picker), so revalidating it may wait on PCO (convention 15 as refined). Writes go through `lib/db/catalogEdit.ts` (named SQL, one `withTransaction` per action) and server-only `lib/queries/catalogEdit.ts`. Validation lives in `lib/catalog/validation.ts`.
- **Entries** (song page, EntriesCard):
  - add, edit and delete (delete is confirmed);
  - a numbered book takes a number, or a location label such as the front cover;
  - an unnumbered book places the entry by position (append; move up/down);
  - variant note;
  - taken numbers and duplicate plain entries are field errors that link to what exists.
- **Hymn** (song page, HymnCard): edit the title, first line and notes; add or remove aliases (the normalized form must be unique across hymn aliases).
- **Tune** (tune page): edit the name, meter and notes; add or remove aliases.
- **Merge hymns** (from a song's HymnCard: "Merge this hymn into…", pick the target).
  - `lib/catalog/merge.ts` (pure) plans it and the preview shows:
    - every song that moves;
    - songs that collide on the same tune (they merge: entries, marks and notes move; the target keeps its fields);
    - conflicts that refuse the merge: two colliding songs linked to *different* PCO songs, or entries that would collide on a number.
  - The source's title and aliases become aliases of the target, and the source hymn is deleted.
  - One transaction; the result names everything that changed.
- **Merge tunes** (tune page): the same, keyed by hymn.
- **Books** (`/catalog/books`):
  - add a book: code (`parseBookCode` plus the DB CHECK), name, short name, numbered or unnumbered, label format, defaulting to `CODE-{n}` or the short name;
  - edit name, short name, label format and active; reorder (up/down `sort_order`).
  - **Inactive** books stay browsable, but their entries are left out of schedule text, hymnal notes and the book filter.
  - An unnumbered book (such as a "Chorus Book") lists its entries by position. On its book page they can be reordered, and new entries append.

**Book CSV import** (`/catalog/import` → "Import a book from CSV").
- Upload a file (at most 1 MB) for one book, chosen or created first.
- Columns, with a header row:
  - numbered book: `number,title,tune,variant`;
  - unnumbered book: `position,title,tune,variant`.
- `lib/csv.ts` gains an RFC 4180 **parser**. `lib/import/bookCsv.ts` (pure) plans each row against the catalog:
  - the hymn by normalized title or alias, else new;
  - the tune by normalized name or alias, else new;
  - the song by (hymn, tune), else new.
- The report blocks numbers duplicated in the file, numbers already taken in the book and blank titles, and lists ambiguous matches.
- Stored as an `import_runs` row (`kind: "csv"`, `book_id`), previewed on the run page, then applied in one transaction or discarded. Today's seed runs keep rendering in the runs list.

**JSON export** (Settings › Data › "Export catalog (JSON)").
- A server action returns a deterministic JSON document (sorted keys and rows, stable ids, pretty-printed), so two exports diff cleanly in git. The browser downloads it as `catalog-YYYY-MM-DD.json` (Blob).
- Contents: books, hymns with aliases, tunes with aliases, songs (with their PCO link), entries and marks.
- There is no `scripts/export-catalog.ts`: the database lives on the server, and lib code needs Next's module resolution, so the download is the export.

**"To learn" shelf.** The song page gets "Mark to learn" (with an optional note) and "Unmark". The catalog list gains `?mark=to-learn` and a count, and the CSV export includes the mark.

**Plans list.**
- An "Upcoming" section at the top: plans dated today or later, by the plan's calendar date against the server's today.
- Below it, the past plans as today, plus "Jump to month": a select of the months that have plans, which moves `?page=` to the page holding that month's first date. Paging is unchanged, and it is all in the browser.

**Removed in phase 5.**
- The seed import: `lib/import/hymnsJson.ts`, `lib/import/hymnsJsonFile.ts`, `hymns.json`, the "Preview seed" action and its UI.
- Past seed runs still render, so their report types and views stay.
- A fresh database is then restored from a backup file (Database section), not seeded. The PR description must say to apply the seed in production **before** this phase deploys.

**Agent rules** (every implementer brief):
- Work only inside your phase's worktree (named in your brief), with absolute paths. Never touch `/Users/davidpolar/dev/service-integrator` (the main checkout).
- Stay inside your listed file set. Commit with explicit paths (`git commit -m "…" -- <paths>`), retrying if `index.lock` is held, so agents sharing the tree never commit each other's files.
- One conventional commit per logical step; a behavior change gets its own commit that flips the assertions it changes. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Follow `docs/architecture.md` (conventions and recipes) and `CLAUDE.md`.
- Write a `\u` escape (convention 16) through a script that emits the backslash itself (for example Python's `chr(92)`), never by typing it into an editing tool: the tool layer decodes it into the literal character. Check with `grep -rnP '[^\x00-\x7F]' lib --include='*.ts'`.
- Before each commit run the tests for what you touched (`npx vitest run <files>`) and `npm run lint`. When another agent shares the tree, never run `next build`, `next typegen` or `npm run typecheck` unless your brief says you own them (all three write `.next/`); the orchestrator runs the full gates after every wave.
- Report in at most 200 words: commits, files, test counts, deviations from the plan, open questions. No file dumps.

## Spike findings

Phase 0 spike, 2026-10-03, API version 2018-11-01. It made 55 read-only requests, and one live write run (93 requests) against throwaway resources only: a dateless plan in Sunday Evening and two songs, all deleted afterwards and verified gone (404). Later phases build on these facts.

**The organization**
- **Service types:** `1405391` Sunday Morning (121 plans) and `1486055` Sunday Evening (95 plans). Only the next Sunday exists as a future plan. The token's user is an administrator.
- **Item note categories:** only the four defaults (Audio/Visual, Band, Person, Vocals), with different ids in each service type.
  - **There is no "Hymnal" category, and the API cannot create one.** The user creates it in the PCO web app, in both service types, before phase 3's note sync is used. The app finds it by name in each service type.
- **Songs and tags:**
  - 397 songs. Each has at least one arrangement; PCO creates a "Default Arrangement" with every new song.
  - One song tag group, "Type" (Chorus, Hymn, Instrumental, Invitation, Special; several may be chosen). "Speed" and "Style" are arrangement tag groups.
  - The API cannot create tags or tag groups.
- **Query options:** every list response's `meta` lists `can_order_by`, `can_query_by`, `can_include` and `can_filter`. Check there before relying on a parameter.

**Reads**
- **Plan items:** `include=item_notes,song` works. An ItemNote has `category_name`, `content` and an `item_note_category` relationship.
- **Song tags:** `include=tags` on `/songs` is silently ignored. Read song tags with `GET /songs?where[song_tag_ids]=<tagId>`, one request per song tag, or with `GET /songs/{id}/tags`.
  - Use tag ids only from a fresh `tag_groups` read: PCO may ignore an unknown id and return every song.
- **`last_scheduled_at`:** counts upcoming plans in either service type; a dateless plan does not count.
- **`song_schedules`:** with no filter it returns upcoming schedules only.
  - Past schedules need `filter=after&after=<date>`, or `filter=most_recent&amount=N` (past only).
  - A SongSchedule's id is the plan item's id.
- **Plans:** support `where[updated_at][gt|gte]`, `order=-updated_at`, and the filters `future`, `past`, `after`, `before` and `no_dates`.
  - `filter=future` keeps all of today's plans for the whole day. Checked live on Sunday 2026-10-04 at 09:20 EDT, it still returned that day's Sunday Morning plan (`sort_date` 11:00Z) and Sunday Evening plan (`sort_date` 08:00Z).
- **Rate limits:** every response carries lowercase `x-pco-api-request-rate-limit` (100), `-period` (20, a bare number) and `-count` headers. PCO may change the limits at any time and says never to hard-code them; the pacer adapts to them (see `docs/architecture.md`).

**Writes (observed live)**
- **Songs.**
  - `POST /songs` returns 201, and PCO adds a "Default Arrangement" (with no keys).
  - `PATCH` needs neither `data.id` nor `type`.
  - Assignable attributes are `title`, `admin`, `author`, `copyright`, `ccli_number`, `hidden` and `themes`. Any other attribute, such as `notes`, gets a 422 "Forbidden Attribute".
  - **A `ccli_number` on create makes PCO overwrite `title`, `author`, `copyright`, `admin` and `themes` with CCLI's data.** CCLI 22025 turned the test song into "Amazing Grace" with CCLI's credits.
  - `DELETE /songs/{id}` returns 204 even while a plan uses the song, and that plan's items silently become plain items. **The app never deletes a PCO song.**
- **Plan items.**
  - `POST …/items` with only `song_id` returns 201, but the item is titled "New Item" and has **no arrangement**. Send `title` and `arrangement_id` (the song's default arrangement) explicitly. The relationship form works too.
  - `item_type` can only be set to `"header"`.
  - `sequence: n` on create inserts the item there and shifts the rest down.
  - `POST …/item_reorder` with `{ data: { type: "PlanItemReorder", attributes: { sequence: [ids] } } }` returns 204. A partial list moves those ids to the front, in the order given.
  - `DELETE` returns 204.
- **Item notes.**
  - Create with `item_note_category_id` (an integer or a string) or with the `item_note_category` relationship; returns 201.
  - `PATCH` of `content` returns 200. The category cannot change (422 "Forbidden Attribute"). `DELETE` returns 204.
  - **One item can hold several notes in the same category**, so an upsert looks for the existing note by category before it creates one.
  - A missing category gives a 422: `{ title: "Validation Error", detail: "must exist", source: { parameter: "category" } }`.
- **Tags.** `POST /songs/{id}/assign_tags` returns 204 and **replaces** all of the song's tags; an empty list clears them. An arrangement tag id is accepted and silently ignored.
- **`updated_at`.** Creating, reordering and deleting items, and changing notes, through the API did **not** change the plan's or the item's `updated_at`. Edits in the PCO web app appear to bump it, but that evidence is only circumstantial.
- **422 bodies** have the shape `{ errors: [{ status, title, detail, source?: { parameter }, meta? }] }`.

**What changes in the plan**
1. **Pacer** (done in phase 0): it adapts to the rate-limit headers instead of a fixed 80 requests per 20 s.
2. **Phase 3 hymnal notes.**
   - Resolve the "Hymnal" category by name in each service type. If it is missing, the sync skips that service type with a clear message (risk 2).
   - An upsert finds our note on the item by category, then PATCHes its `content` or creates it. It never changes a note's category.
3. **Phase 4.**
   - `addSongToPlan` sends the song's `title` and its default arrangement's `arrangement_id`.
   - `createSongInPlanningCenter` never sends `ccli_number` on create. A CCLI number is set afterwards with a PATCH; the song is then read again, and any credits PCO changed are written back unless the user chose to take CCLI's.
   - `assignTags` reads, merges and writes, and sends only ids from tag groups with `tags_for: "song"`.
   - The tag mirror reads `tag_groups?include=tags`, plus one `songs?where[song_tag_ids]=` request per song tag.
4. **"Used" and "last sung".** `last_scheduled_at` includes upcoming plans, so it means "scheduled", not "sung". Phase 2's "used" may rely on it. Phase 6's "not sung since" uses past plans only.
5. **Phase 6 history.** A plan's `updated_at` does not move when the API edits its items. The incremental sync therefore refetches items for:
   - plans whose `updated_at` changed;
   - every upcoming plan, and every plan from the last 8 weeks;
   - every plan, in a weekly full pass.

   `songs/{id}/song_schedules?filter=after&after=<date>` returns one song's whole history in one request.
