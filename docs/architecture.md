# Architecture

How Service Integrator is put together, and how to add to it. Read this before adding a feature, and follow its [conventions](#conventions) and [recipes](#recipes). The plan that produced this structure (decisions, Planning Center spike facts, implementation notes) is `docs/superpowers/plans/2026-10-03-multi-page-routing.md`; the song catalog plan, which adds the [database](#database) and [writes to Planning Center](#writes-to-planning-center), is `docs/superpowers/plans/2026-10-04-song-catalog.md`.

## Overview

A Next.js 15 App Router app (React 19, strict TypeScript, Tailwind 4, Auth.js v5, Vitest) that reads Planning Center Online (PCO) Services data and generates song copyright text and service-schedule text. It runs as one long-running `next start` process under PM2, deployed by GitHub Actions on every push to `main`, so in-memory caches are per process and shared by all requests. It keeps its own data in a local SQLite file (see [Database](#database)), which that process opens at boot.

| URL | Page | Data |
|---|---|---|
| `/` | 307 redirect to `/plans` | none |
| `/plans` | every plan grouped by date, 25 dates a page (`?page=`) | `getPlansByDate()`, in the page |
| `/plans/{serviceTypeId}/{planId}` | one plan: header, items table, Copyright Information tab | `getPlanDetail()`, once, in the `[planId]` layout |
| `/plans/{st}/{plan}/schedule` | the plan's Service Schedule tab | the same data, through `usePlan()` |
| `/plans/{st}/{plan}/items/{itemId}` | one item's song details | the same data, through `usePlan()` |
| `/unused-hymns` | hymnbook entries never scheduled (`?book=`, `?sort=`, `?page=`) | `getUnusedHymns()`, in the page; Refresh is a server action |
| `/settings` | the database: whether it opens, its file, migrations and last backup | `getDatabaseStatus()`, in the page (local database only) |
| `/auth/signin`, `/auth/error` | public sign-in pages | none |

### Request flow

```text
browser
  → middleware.ts           no session: 307 to /auth/signin?callbackUrl=<path+query>
  → app/layout.tsx          <html>, fonts, title template "%s · Service Integrator"
  → app/(app)/layout.tsx    force-dynamic · Navigation · <main> · footer
  → layouts and pages       server: parsePcoId / orNotFound → lib/queries → lib/pco → Planning Center
  → serializable props      client components (interaction only)
```

- **Auth.** `auth.ts` sets up Auth.js with Google; only the addresses in `ALLOWED_EMAIL_1..3` may sign in. `middleware.ts` requires a session for every path except `/auth/…`, `/api/auth/…`, Next's static assets and `favicon.ico`. The exemptions are whole path segments, so `/authors` is still protected. The only API route is `app/api/auth/[...nextauth]/route.ts`.
- **Deep links survive sign-in.** The middleware passes the requested path and query as `?callbackUrl=`, and the sign-in page redirects there through `safeCallbackUrl()` (`lib/safeCallbackUrl.ts`), falling back to `/plans`. It accepts only a path with a single leading slash and printable ASCII after it (a non-ASCII character made `redirect()` fail with a 500), and never an auth page (`/auth` and everything under it): the middleware leaves those public, so redirecting a signed-in visitor there would loop. A path that merely starts with those letters, such as `/authors`, is protected like any other page and is accepted; a test reads the middleware's matcher to keep the two in step.
- **Why `force-dynamic`.** Every page needs the session and live PCO data, and CI builds with no PCO credentials, so nothing may be prerendered at build time. `export const dynamic = "force-dynamic"` in `app/(app)/layout.tsx` covers every `(app)` route. The route table of `npm run build` must show `ƒ (Dynamic)` for each of them (only Next's built-in `/_not-found`, which is outside `(app)`, is static). Never call `connection()` inside `lib/pco`: it throws outside a request.
- **No app `/api/*` for data.** Server components call `lib/queries` directly, and the browser never calls PCO.
- **Boot.** When the Node.js server starts, `instrumentation.ts` opens and migrates the database and starts the background jobs (see [Jobs and boot](#jobs-and-boot)). Nothing of this runs during `next build`.

## Route map

```text
app/
  layout.tsx                    root: <html>, fonts, title template
  not-found.tsx                 404 for unmatched URLs. Renders outside (app), so no nav: its own full-screen card
  api/auth/[...nextauth]/       Auth.js handlers, the only API route
  auth/                         public: layout.tsx, signin/page.tsx, error/page.tsx
  (app)/
    layout.tsx                  force-dynamic; Navigation + <main> + footer
    error.tsx                   shell-level error boundary: the nav stays on screen
    page.tsx                    redirect(routes.plans()), a 307; keeps "/" free for a future dashboard
    plans/
      (list)/page.tsx           server: getPlansByDate() → PageHeader + <Suspense><PlansList/></Suspense>
      (list)/loading.tsx        the list skeleton; in a route group so it does not also wrap the plan routes
      [serviceTypeId]/
        loading.tsx             ┐
        error.tsx               ├ cover the [planId] LAYOUT's fetch and notFound(), so they sit one level up
        not-found.tsx           ┘
        [planId]/
          layout.tsx            server: parsePcoId → getPlanDetail → <PlanProvider>; generateMetadata via getPlanLabels
          error.tsx             errors in the (overview) layout and in item pages, below the provider
          (overview)/
            layout.tsx          PlanHeader + PlanItemsTable + PlanTabNav, with the active tab below
            error.tsx           a failing tab: the header, items table and tab nav stay on screen
            page.tsx            Copyright Information tab (the default)
            schedule/page.tsx   Service Schedule tab; metadata.title "Schedule"
          items/[itemId]/
            page.tsx            server: parsePcoId → notFound(); the client PlanItemDetail reads the provider
            not-found.tsx
    unused-hymns/
      page.tsx · loading.tsx    server-rendered initial data; book, sort and page live in the URL
      actions.ts                "use server": refreshUnusedHymns, which checks the session
    settings/page.tsx           server: getDatabaseStatus() → PageHeader + DatabaseCard. No loading or error file:
                                it reads only the local database, and the query never throws
  components/
    ui/                         shared chrome: PageHeader, Breadcrumbs, LoadingState, ErrorState, EmptyState,
                                CopyButton, LocalTime, Pagination
    Navigation.tsx              the top bar; Navigation/NavLinks.tsx renders NAV_ITEMS, and
                                Navigation/NavUtilityLinks.tsx the icon links beside Sign Out (NAV_UTILITY_ITEMS)
    Settings/DatabaseCard.tsx   the Settings page's database status
    Plans/PlansList.tsx         the paged list of plans
    PlanItems/                  PlanProvider (+ usePlan), PlanHeader, PlanItemsTable, PlanTabNav, PlanItemDetail,
                                the tab connectors (CopyrightTab, ScheduleTab) and their views
    UnusedHymns/                UnusedHymnsView, UnusedHymnsControls, UnusedHymnsTable
    SongDetails.tsx, SongCopyright.tsx
  hooks/useUrlState.ts
```

### Why the boundaries sit where they do

- **One level above a layout that fetches.** A segment's own `loading.tsx`, `error.tsx` and `not-found.tsx` render *inside* its `layout.tsx`, so they never cover that layout. The `[planId]` layout fetches (`getPlanDetail`) and can call `notFound()`, so its boundaries live in `[serviceTypeId]/`. This was checked against the installed Next 15.5.9 source.
- **Below the stateful provider.** `PlanProvider` is rendered by the `[planId]` layout, and `[planId]/error.tsx` and `(overview)/error.tsx` render inside it. An error in a tab or item page therefore never unmounts the provider, and the Schedule selections survive "Try again". Never put an error boundary above a provider whose state must survive.
- **Route groups scope files.**
  - `(list)` keeps the list's `loading.tsx` from also wrapping `[serviceTypeId]/…`.
  - `(overview)` gives the header, items table and tab nav to the two tabs and not to the item pages beside them. It also makes `PlanTabNav` work: `useSelectedLayoutSegment()` returns `null` or `"schedule"` in `(overview)/layout.tsx`, but `"(overview)"` one level up, so that layout has to render the nav.
  - `(overview)/error.tsx` is a boundary *inside* that layout, so a failing tab leaves the header and tab nav on screen; errors in the layout itself fall through to `[planId]/error.tsx`.
- **Layouts do not re-run on `<Link>` navigation.** The server renders only the segments that change, so switching tabs, or opening an item and coming back, never repeats the `[planId]` layout's PCO fetch. Another plan remounts `PlanProvider` (its key includes the plan). `router.refresh()` does re-run the layout.
- **Two kinds of "item not found".** An item ID that is not a PCO ID ends in the server's `notFound()`, caught by `items/[itemId]/not-found.tsx`. A valid ID that is not in this plan renders an inline `EmptyState` from the client `PlanItemDetail`, because client code never calls `notFound()`.
- **List rows.** A row's title is a real `<Link>` stretched over the row (`after:absolute after:inset-0` on the link; `relative transform-gpu` on the `<tr>`, since older Safari ignores `relative` on table rows), so rows work from the keyboard and with cmd-click.
- **`aria-current`.** A nav item gets `"page"` on its own page and `"true"` elsewhere in its section (`navAriaCurrent` in `lib/routes.ts`), so a plan page announces only its breadcrumb and tab as current. The icon links beside Sign Out (`NAV_UTILITY_ITEMS`, the Settings gear) use the same function, and are named by their `aria-label`.

## Data layer

```text
page / layout (server) ──► lib/queries ──┬─► lib/pco ──► Planning Center
        │ serializable props             └─► lib/db  ──► SQLite (DATABASE_PATH)
        ▼
client components (interaction only) ── URL state via useUrlState
```

**Server versus pure modules.**

- **Server-only** modules start with `import "server-only"`, so importing one into a client component fails the build: `lib/pco/*` (except `resources.ts`, which is types only, and the test helpers in `testing.ts`), `lib/queries/*`, `lib/db/*` (except the SQL text in `migrations/`, `errors.ts` and the test helper `testing.ts`), `lib/jobs.ts`, `lib/boot.ts`, and `lib/hymnCatalog.ts`, which wraps `hymns.json` so its ~150 KB never reaches a client bundle.
- **Pure** modules are safe on both sides and unit-tested: `lib/domain.ts` (types), `copyright.ts`, `serviceSchedule.ts`, `hymnMatch.ts`, `plansByDate.ts`, `format.ts`, `normalizeTitle.ts`, `unusedHymns.ts`, `scheduleSelections.ts`, `ttlCache.ts`, `routes.ts`, `urlState.ts` and `safeCallbackUrl.ts`. They take what they need as arguments (`matchHymns` gets its index, `buildScheduleCopyText` gets the plan's date string) and import nothing server-only.
- A client component may `import type` from a server module (the import is erased), never a value.

**`lib/pco/`: transport, mapping, getters.**

| File | What it does |
|---|---|
| `index.ts` | The barrel. Import `@/lib/pco`, never `@/lib/pco/<file>`: `vi.mock("@/lib/pco")` only applies to barrel imports. It leaves out the write plumbing (`pcoMutate`, `jsonApi`, `toOne`, `toMany`), because only `lib/pco` writes to PCO. |
| `client.ts` | `pcoFetch(path, kind, { paced })`, `pcoFetchAll(path, kind, { maxPages, paced })`, `pcoMutate(method, path, body, { paced })`, `jsonApi`, `toOne`, `toMany`, `PcoError(status, path)`, `PcoValidationError`, `PcoUrlError`, `pcoAuthHeaders()`. |
| `pacer.ts` | `pcoPacer()`: the process-wide pacer that paced requests wait on and that every response teaches PCO's current rate limit. `createPacer({ now, sleep })` builds one for tests. |
| `cachePolicy.ts` | `PCO_CACHE_POLICY`: the fetch options for each `PcoResourceKind` (`serviceTypes`, `plans`, `planItems`, `songs`). All `no-store` today. |
| `ids.ts` | `parsePcoId(raw)` returns a branded `PcoId` or `null` (`/^[1-9][0-9]{0,19}$/`); `assertPcoId` throws `InvalidPcoIdError`. |
| `resources.ts` | The raw JSON:API shapes as PCO sends them. Types only. |
| `mappers.ts` | `toServiceType`, `toPlan`, `toPlanItem`, `toSong` and `joinItemsToSongs`: raw resources to the domain types. |
| `serviceTypes.ts`, `plans.ts`, `planItems.ts`, `songs.ts` | The getters. |
| `next.ts` | `orNotFound(promise)`: a 404 `PcoError` or an invalid ID becomes `notFound()`; anything else is rethrown. Server pages and layouts only. |
| `testing.ts` | Test-only builders, fetch stubs keyed by URL or `"METHOD url"`, `calledUrls`, `calledRequests` and `stubPcoPacer`. |

What `client.ts` guarantees:

- **Only the Services API is reachable.** `path` is relative to `/services/v2`. The URL is normalized, then must have the PCO origin, a `/services/v2/` path with no `%` in it, and no userinfo. The same check runs on every `links.next`, and requests use `redirect: "error"`, so the token never goes anywhere else. An ID from a URL is never interpolated unchecked: getters call `assertPcoId` first.
- **`pcoFetchAll` never truncates silently.** It follows `links.next` in order, appends each page's `data`, dedupes `included` by type and id, and throws when a page beyond `maxPages` exists (default 50 at `per_page=100`; plans use 20, songs 100). PCO's default page is 25 and its maximum is 100, so list paths ask for `per_page=100`.
- **Failures are cheap and clear.** An unpaced 429 is retried once, and only when `Retry-After` is whole seconds and at most 5; paced requests wait longer (see [Writes to Planning Center](#writes-to-planning-center)). A 422 is a `PcoValidationError`, whose body is read for PCO's reasons; every other error body is cancelled unread. Headers are read with optional chaining (every response's rate-limit headers go to the pacer), so test doubles can still be a bare `{ ok, json }`.

Getters are wrapped in React `cache()` (calls with the same arguments are deduped within a request), take **primitive** arguments with no defaults (the cache key is argument identity), and call `assertPcoId` on every ID before building a path.

**`lib/queries/`: what pages import.**

- `plans.ts` has `getPlansByDate()` (`{ dates, plansByDate, failedServiceTypeIds }`: a service type whose plans fail to load is skipped, logged and reported, and the list shows a quiet warning), `getPlanDetail(st, plan)` (`{ plan, serviceType, items, hymns }`, loaded in parallel) and `getPlanLabels(st, plan)`, the cheap, never-throwing label lookup for `generateMetadata`.
- `unusedHymns.ts` has `getUnusedHymns({ refresh })`.
- `system.ts` has `getDatabaseStatus()`: `{ ok: true, path, appliedMigrations, latestMigration, lastBackup, backupDir }`, or `{ ok: false, error }` (logged). It never throws, so Settings shows a broken database instead of failing.

**Domain and hymns.**

- `lib/domain.ts` is the one home of `ServiceType`, `Plan`, `PlanSummary`, `Song` (nullable fields), `PlanItem`, `PlanItemWithSong`, `HymnVersion`, `HymnData` and `ScheduleSelection`. Raw PCO shapes stay in `lib/pco/resources.ts`.
- `joinItemsToSongs` gives a song item its song by the PCO song ID on the item, and falls back to an exact title match only when the item has no ID (or its song was not included), so an item renamed in the plan keeps its song.
- `buildHymnIndex(catalog)` groups the hymnbook catalog (`hymns.json`, through `lib/hymnCatalog.ts`) by `normalizeTitle`, and `matchHymns(index, titles)` lists, for each title, the records that match it exactly (ignoring case) first and the other normalized matches after, each in catalog order. It echoes the requested title.

**Where caching would be turned on.** Nothing is cached across requests today except two in-memory results. There are three levels:

- *Per request:* React `cache()` in the getters, already on.
- *HTTP, per PCO resource kind:* `PCO_CACHE_POLICY` in `lib/pco/cachePolicy.ts` is the single switch. Replace a kind's `{ cache: "no-store" }` with, for example, `{ next: { revalidate: 300 } }`. Under `force-dynamic` Next 15.5 forces `revalidate: 0` only onto fetches that name no cache option (`node_modules/next/dist/server/lib/patch-fetch.js`), so an explicit entry is honoured. Confirm it in a production build (`npm run build && npm start`) before relying on it, and remember the cache is shared by every user.
- *In process, for a computed result:* `createTtlCache` (`lib/ttlCache.ts`). `get(key, load)` serves a fresh value, shares one load between concurrent calls and never caches a failure. `refresh(key, load)` replaces the value only when the load succeeds. `invalidate` and `clear` drop entries. It backs `getPlanLabels` (5 minutes) and `getUnusedHymns` (1 hour). It is per process, so a multi-instance or serverless host has one cache per instance. A cache that a server action touches must live on `globalThis` (convention 15).

## Database

The app's own data lives in one SQLite file per server, through Node's built-in `node:sqlite` (unflagged from Node 22.13; no install step and no native binary, so the deploy is unchanged). SQL is hand-written; there is no ORM. Today the database holds `settings` and `sync_runs`; the catalog tables come with later migrations.

```text
lib/db/
  index.ts          getDb(); re-exports withTransaction, databasePath and backupDirectory
  config.ts         databasePath(), backupDirectory(): DATABASE_PATH, DATABASE_BACKUP_DIR and their defaults
  connection.ts     loadSqlite(); openDatabase(location): the connection settings, no migrations
  transaction.ts    withTransaction(db, fn)
  migrate.ts        migrate(db), appliedMigrations(db)
  migrations/       index.ts (MIGRATIONS, the Migration type), 0001_init.ts, …
  syncRuns.ts       start, finish and read sync_runs rows
  backup.ts         backupDatabase(), listBackups(), isBackupDue(), pruneBackups()
  errors.ts         errorMessage(error)
  testing.ts        openTestDb(), for tests
lib/jobs.ts         the background jobs and their scheduler
lib/boot.ts         boot(): open the database, then start the jobs
instrumentation.ts  register(): runs boot() when the Node.js server starts
```

**Opening.** `getDb()` is the only way the app opens the database. On first use it resolves `DATABASE_PATH` (default `./data/service-integrator.sqlite`, relative to the working directory; `/data/` is gitignored), creates its folder, opens it with `openDatabase()`, runs `migrate()`, and caches the connection on globalThis under `Symbol.for("service-integrator.db.v1")`: Next bundles `lib/db` once per layer (instrumentation, server components, server actions), and all of them must share one connection (convention 15). Nothing opens it at import time, so `next build` never does. A failure throws an error that names the file (or says Node 22.13 is needed) and caches nothing, so the next call tries again. Production sets both paths to absolute paths under `~/service-integrator-data/` (`deploy.yml`), outside the folder each deploy extracts into.

**Connection settings** (`openDatabase`, used by `getDb()` and `openTestDb()` alike): `PRAGMA busy_timeout = 5000` first, so the next pragma waits for another connection's lock; `journal_mode = WAL` (stored in the file; an in-memory database stays `memory`); `foreign_keys = ON`.

**Loading `node:sqlite`.** `loadSqlite()` uses `process.getBuiltinModule("node:sqlite")`, not a static import. Webpack and Turbopack handle the import, but Vitest 2 strips the `node:` prefix and fails ("Failed to load url sqlite"), because the module exists only under the prefix. Loading it at first use also turns a Node without it into a clear error from `getDb()`. Import its types with `import type { DatabaseSync } from "node:sqlite"`. Node prints one harmless `ExperimentalWarning` per process when the module loads.

**Node 22.13 API only.** CI and the server run Node 22, so use a `node:sqlite` method or option only if it was added in 22.13 or earlier (`@types/node` tags each with `@since`). Not available there: `isTransaction`, `isOpen`, `location()`, `backup()`, `aggregate()`, the constructor's `timeout` option, `statement.columns()` and `setReturnArrays()`. That is why the busy timeout is a pragma, `withTransaction` tracks nesting itself and backups use `VACUUM INTO`.

**Layering**, as with `lib/pco` and `lib/queries`:

- `lib/db/<area>.ts` holds the SQL, in named functions that take `db: DatabaseSync` first, with mappers from snake_case rows to camelCase types (`toSyncRun` in `syncRuns.ts`). Each is tested on an in-memory database.
- `lib/queries/<area>.ts` (server-only) calls `getDb()` (and `@/lib/pco`), composes those functions, and is what pages import (convention 3). Pages and components never call `getDb()`.
- Enumerations such as `sync_runs.kind` are checked in TypeScript (`SYNC_RUN_KINDS`), not by a CHECK, so a new value needs no migration. Readers skip values a newer build wrote.

**Transactions.** `withTransaction(db, fn)` runs `fn` after `BEGIN IMMEDIATE` (which takes the write lock up front, waiting up to the busy timeout), commits when it returns, and rolls back and rethrows when it throws; a failed commit rolls back too. A nested call is a savepoint, so its failure undoes only its own writes, and the outer `fn` may catch its error and carry on. The exception is an error that makes SQLite roll the whole transaction back by itself (a conflict clause of ROLLBACK, a full disk, an I/O error): the savepoint is then gone, so that call opens a stand-in transaction to hold any later writes and throws a `TransactionAbortedError`, whose `cause` is the original error. Every call still open fails with that same error, even one whose `fn` caught it, and nothing commits. `withTransaction` cannot see that happen to a statement `fn` runs itself, so catch a statement's error inside `fn` only around a nested `withTransaction`. `fn` must be synchronous: one that awaited would let other requests' statements into the transaction and run its own later writes outside it, so a returned promise is refused with a TypeError. Wrap every write of more than one statement in it, and never run BEGIN or COMMIT by hand.

**Migrations.** A migration is a module in `lib/db/migrations/` that default-exports `{ id, sql }`, listed in order in `MIGRATIONS` (`migrations/index.ts`). `migrate(db)` creates `schema_migrations (id, applied_at)`, then applies each migration the database does not record, in order, each in its own transaction with its `schema_migrations` row, so a failure (thrown, naming the migration) leaves the schema as the previous migration left it. A database that records migrations this build does not know (an older build deployed onto a database a newer one migrated) gets a warning in the log, and the app carries on. The rules:

- **Append-only.** Never edit, reorder, rename or remove a committed migration: deployed databases have already run it. Change the schema with a new one.
- One migration per phase (the plan's Execution table), numbered `0001`, `0002`, … with a snake_case name. A test checks the numbering.
- Every table is `STRICT` (a test checks), timestamps are ISO 8601 UTC text (`toISOString()`, which sorts by time), and JSON is `TEXT` with a `json_valid` CHECK.
- The SQL runs inside the migration's transaction: no BEGIN or COMMIT, and `PRAGMA foreign_keys` has no effect. Rebuilding a table that others reference needs foreign keys off, so the first migration that does that must also give `migrate()` a per-migration option for it.
- `getDb()` migrates only when it first opens the database, so restart `next dev` after adding a migration.

To add one, create `lib/db/migrations/0002_catalog.ts` on the model of `0001_init.ts`, append it to `MIGRATIONS`, and test the new tables through the `lib/db/<area>.ts` functions that use them.

**Tests.** `openTestDb()` (`lib/db/testing.ts`) returns a new in-memory database with the same connection settings and every migration applied; close it in `afterEach`. To test a `lib/queries` module, mock only `getDb` and keep the rest of `lib/db` real, as `lib/queries/system.test.ts` does:

```ts
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));
// beforeEach: getDb.mockReturnValue(openTestDb());
```

**Backups.** `backupDatabase(db, { dir })` (`lib/db/backup.ts`) writes a consistent copy with `VACUUM INTO` to `service-integrator-<UTC time>.sqlite` in `DATABASE_BACKUP_DIR` (default `./data/backups`). It writes a `.partial` file, flushes it to disk and renames it, so a crash never leaves a file that looks like a backup. It then keeps the newest 14 backups and never deletes any other file. To restore one, stop the app, delete the `-wal` and `-shm` files beside the database, copy the backup over `DATABASE_PATH`, and start the app.

### Jobs and boot

- **Boot.** `instrumentation.ts` `register()` runs `boot()` (`lib/boot.ts`) in the Node.js runtime only, and never during `next build` (`NEXT_PHASE`). Keep its `process.env.NEXT_RUNTIME === "nodejs"` check a literal wrapped around the dynamic import: Next replaces it at compile time, which keeps `lib/db` out of the Edge bundle. `boot()` calls `getDb()`, so a broken database shows in the log at once; finishes every run the last process left in progress (`finishInterruptedRuns`: `ok = 0`, "interrupted (the server restarted)"), so none shows as in progress forever; then calls `startJobs()`. It never throws: plan pages work without the database, and Settings shows the error.
- **Jobs** (`lib/jobs.ts`). `JOBS` lists the background jobs. A `Job` is `{ kind, everyMs, atBoot?, isDue?, run }`. `startJobs()` checks each job every `everyMs` (and, with `atBoot`, a minute after boot) and runs it when `isDue(db, now)` says so, or every time without `isDue`. It schedules once per process (a globalThis flag), and its timers are `unref()`ed.
- **Runs.** `runJob(job)` records a `sync_runs` row (started, then finished with `ok`, `message` and `counts` from what `run` returns, or with the error) and never throws or rejects. A call while a run of the same kind is in progress joins that run. The runs in progress live on globalThis, so an on-demand server action and the scheduler see each other.
- **The backup job** is checked hourly and a minute after boot, and runs when the newest backup file is a day old, so restarts (every deploy is one) never stretch the gap much past a day. It also runs when the last backup run did not succeed, whether it failed or a restart interrupted it, even if that run had already written its file. Settings shows its last run.
- **Add a job** with one entry in `JOBS`, such as `{ kind: "pco-songs", everyMs: HOUR_MS, atBoot: true, run: (db) => syncPcoSongs(db) }`; a new kind joins `SYNC_RUN_KINDS` (no migration). A "Sync now" button is a server action that checks the session and calls `runJob(job)`.

## Writes to Planning Center

Only modules inside `lib/pco/` write to PCO (convention 18). The barrel exports `PcoValidationError` but not `pcoMutate`, `jsonApi`, `toOne` or `toMany`, and `lib/pco/index.test.ts` checks that they stay out. Nothing writes yet: phase 3 adds `lib/pco/writes.ts`, the single home of writes. Each of its functions does its fresh read first, writes, and returns what changed, and the caller (a `lib/queries` function) logs a `write_log` row.

**`pcoMutate(method, path, body?, { paced })`** (`client.ts`) sends a `POST`, `PATCH` or `DELETE` through the same request path as `pcoFetch`: the URL guard runs before anything is sent, a redirect makes fetch reject, and each attempt has its own 15 s timeout. A write is always `cache: "no-store"`, whatever `PCO_CACHE_POLICY` says, and sends its body as JSON (`Content-Type: application/json`). It resolves to the JSON response, or `null` for `204 No Content` or an empty body, so a caller typed `pcoMutate<PcoSingleResponse<…>>` still handles `null`. A 429 is retried as below; PCO answers 429 before processing a request, so a retried POST cannot apply twice. A request that times out is never retried, which matters for a write: PCO may have applied it. Build the path from IDs that passed `assertPcoId`, as getters do.

**Bodies.** `jsonApi(type, attributes, relationships?)` builds `{ data: { type, attributes, relationships? } }`. `toOne(type, id)` builds a to-one relationship, `{ data: { type, id } }`, and `toMany(type, ids)` a to-many one, `{ data: [{ type, id }, …] }` (an empty list is allowed). Both run every ID through `assertPcoId`, and relationship IDs are typed `PcoId`, so a relationship built by hand from an unchecked string does not compile:

```ts
// Replaces all of the song's tags; PCO answers 204, so this resolves to null.
await pcoMutate(
    "POST",
    `/songs/${assertPcoId(songId)}/assign_tags`,
    jsonApi("TagAssignment", {}, { tags: toMany("Tag", tagIds) })
);
```

**Validation errors.** A 422 throws `PcoValidationError`, a `PcoError` with status 422 whose `errors` are the body's issues as `{ title, detail, parameter }`, and whose `details` give one readable line for each ("category: must exist"). The body is read defensively, so one that is not JSON, or not that shape, gives no details rather than a parse error. The details also appear in the message, JSON-quoted so they cannot forge log lines. Reads share the path, so a GET answered 422 throws the same error; every other non-2xx status is a plain `PcoError`. No error message or property carries the Authorization header (a test checks).

**The pacer** (`pacer.ts`). PCO grants a budget of requests per period and changes it whenever it likes (users report silent drops to 10 per 20 s after a burst at one endpoint), so the pacer learns it and nothing hard-codes it:

- **Every response teaches it**, paced or not, failed ones included. `observe()` adopts `x-pco-api-request-rate-limit` and `x-pco-api-request-rate-period`, each a whole number alone or followed by words (PCO sends `20`; its docs show `20 seconds`). A missing or garbled header, or one out of range (a limit or period of 0, a period over an hour), teaches nothing and never counts as zero. Until a header arrives it assumes 100 per 20 s.
- **Paced requests get 80% of the advertised limit**, at least one a period, and page loads keep the rest. It is a token bucket in which every token comes back a period after it was taken, so no window, fixed or sliding, holds more paced starts than the budget. Turns are granted in call order.
- **A busy window holds paced work.** Once a response's `x-pco-api-request-rate-count` reaches the budget, paced callers wait a whole period, since PCO does not say when its window started. Background syncs can afford the slack.
- **A 429 holds every paced caller**, not just the one that got it, until its `Retry-After` (a whole period without one), and at most 60 s. `Retry-After` wins over the 429's own count, which is past the limit by definition. A page load's 429 holds paced work too.
- **One per process.** It lives on globalThis under `Symbol.for("service-integrator.pcoPacer.v2")`: `instrumentation.ts`, server components and server actions each bundle `lib/pco` (convention 15), and a bucket per copy would let through a multiple of the rate. Its clock is monotonic, so a wall-clock change cannot stall a sync. `limits()` reports `{ limit, periodMs, budget }`.

**`paced: true`** is the switch, on `pcoFetch`, `pcoFetchAll` and `pcoMutate`, and is off by default. A paced call waits for a turn before every request it sends, including each page `pcoFetchAll` follows and each retry, and its timeout starts only once the turn comes; a URL the guard refuses takes no turn. Sync jobs and other background work pass it. Page loads and server actions that someone is waiting on leave it off: they would queue behind a sync, they are few, and the fifth of the limit left over is theirs.

**429s.**

| | Unpaced (page loads, actions) | Paced (sync jobs) |
|---|---|---|
| Retries | one, only when `Retry-After` is whole seconds and at most 5 | up to 3, each after `Retry-After` of any length, or a whole period without one |
| Gives up | otherwise at once, with `PcoError` 429 | with `PcoError` 429 when the retries run out or the wait is over 60 s |

## State

**`PlanProvider`** (`app/components/PlanItems/PlanProvider.tsx`) is rendered by the `[planId]` layout with the `detail` from `getPlanDetail`.

- **Server data stays in props.** It is never copied into `useState`, because `router.refresh()` re-runs the layout and the fresh `detail` must flow straight through.
- **Selections are a reducer.** The Schedule tab's choices live in `useReducer(scheduleSelectionsReducer)` (`lib/scheduleSelections.ts`, pure and tested), keyed by item ID. The merged `scheduleItems` (each song defaulting to version 0) are derived with `useMemo` from `items` and the selections. `chooseOption` and `setCustomText` are stable callbacks.
- `usePlan()` returns `{ plan, serviceType, items, hymns, scheduleItems, chooseOption, setCustomText }` and throws outside a provider, so only components under `[planId]/` may call it.
- The layout keys the provider by `serviceTypeId/planId`, so another plan starts with no selections. Selections survive tab switches, item pages and error retries, but not leaving the plan: Back to the list restores Next's cached page, not provider state.
- On the Schedule tab, `CustomTextInput` keeps what is typed locally and saves it to the reducer 500 ms after typing pauses, or at once on blur.

**URL state** (`app/hooks/useUrlState.ts`, `lib/urlState.ts`). Shareable view state (a filter, sort or page number) lives in the query string.

- Read it with `useSearchParams()`, which `useUrlState()` returns as `searchParams`. The server's `searchParams` prop is fixed for the render that produced it and misses shallow updates.
- Write it with `setSearchParams({ key: value or null }, { history: "replace" | "push" })`. That calls `history.replaceState` or `pushState` with a `null` state, which Next patches into the router, so there is no server round trip. Use `replace` for filters and sorting and `push` for pagination, so Back steps through pages. A call that would not change the query string does nothing.
- Call it only from event handlers. A mount-time effect can run before Next installs its history patch.
- `parsePage(value, totalPages)` and `parseEnum(value, allowed, fallback)` turn what is read into safe values, so a bad `?page=` or `?book=` falls back instead of breaking.
- A parameter that changes what the server fetches does not belong here: navigate with `<Link>` or `router.push`, and read it from `searchParams` on the server.

## Conventions

1 to 14 are the conventions the routing migration set; 15 and 16 are lessons learned during it; 17 onward come with the song catalog.

1. **Routes.** A route is a folder under `app/(app)/`. `page.tsx` and `layout.tsx` are server components, and client components are for interaction only. Type route props with the generated `PageProps<"/plans/[serviceTypeId]/[planId]">` and `LayoutProps<…>` (available after `next typegen`; route groups are not part of the key; `params` is a Promise).
2. **Hrefs.** Internal hrefs come only from the builders in `lib/routes.ts`. Each returns a template literal `as const` (`` `/plans/${st}/${id}` as const ``). Annotating the return type as `Route` fails to compile for dynamic paths. `typedRoutes: true` checks every `<Link href>` against the real routes. `NAV_ITEMS` and `PLAN_TABS` live there too, and links out to PCO's web app come from `pcoWebUrls`.
3. **Data access.** Server pages and layouts get data from `lib/queries/*` and use `parsePcoId` and `orNotFound` from `@/lib/pco`. Nothing fetches `/api/*` from the server: the request passes through the middleware without cookies and is redirected to sign-in. Client components receive data as props or from a provider and never call PCO.
4. **Types.** Domain types live only in `lib/domain.ts`, and raw PCO shapes only in `lib/pco/resources.ts`. UI state such as `ScheduleSelection` is its own type, never a field of a domain type.
5. **URL state.** Shareable view state lives in the URL, through `useUrlState` (see State). A component that reads `useSearchParams()` sits under `<Suspense>`.
6. **Page chrome.** Every page renders `<PageHeader title description breadcrumbs actions>` (the page's one `<h1>`) and exports `metadata` or `generateMetadata`.
7. **Boundaries.** A segment that fetches gets `loading.tsx`, `error.tsx` and `not-found.tsx`, built from the shared `LoadingState`, `ErrorState` and `EmptyState`. When a *layout* fetches, those files go one segment up. Keep an error boundary below any stateful provider.
8. **Validation.** Every dynamic param passes through `parsePcoId(x) ?? notFound()`, and every fetch in a page or layout through `orNotFound(…)`.
9. **Pure logic.** Logic lives in `lib/` with tests. Components stay thin and prop-driven, and a small route-level connector (`CopyrightTab`, `ScheduleTab`) reads the provider and passes props down. Define components at module scope, never inside another component: an inline definition is a new component type on every render, so React remounts it (that is how the custom-text box used to lose focus).
10. **Dates.** A calendar date from PCO is formatted from its `YYYY-MM-DD` part with UTC math (`lib/format.ts`), so the text is the same on the server and in every time zone; the date part of `sort_date` is the org-local date. A true instant such as `computedAt` renders through `<LocalTime iso>`, in the viewer's time zone. It uses `useSyncExternalStore` because React 19 keeps the server's text after a suppressed hydration mismatch.
11. **No prerendering.** Keep `force-dynamic` on the `(app)` layout, and never call `connection()` inside `lib/pco`.
12. **Metadata never throws.** `generateMetadata` re-runs on every navigation, refresh and production prefetch, and a throw breaks the page. Keep it cheap and total: use `getPlanLabels()` (cached for 5 minutes, never throws, falls back to "Plan") and look up only keys that passed `parsePcoId`.
13. **Prefetch.** Rows that link to data-heavy routes use `prefetch={false}`. In production `<Link>` prefetches the rows on screen, so 25 rows would each trigger a metadata lookup and PCO calls. All users share one PCO budget, advertised as 100 requests per 20 seconds and lowered by PCO at times. `PlanItemsTable` rows are the exception and prefetch on purpose: an item page reads the plan the `[planId]` layout already fetched, and its metadata only reads labels `getPlanLabels()` has cached.
14. **Error retry.** `ErrorState` owns the retry: pass it the boundary's `reset` and it runs `startTransition(() => { router.refresh(); reset(); })`. `reset()` alone re-renders with what the client already has, so a failed server render would not run again. Use `onRetry` for a failure outside a boundary. Client code never calls `notFound()`; it renders an inline `EmptyState`.
15. **Server actions.**
    - An action is a public POST endpoint. Call `auth()` and throw without a session, as `refreshUnusedHymns` does; the middleware alone is not enough.
    - **A module-level cache that an action touches must live on `globalThis`.** A client-imported action is compiled in Next's separate "action-browser" layer, so plain module state gets two instances: Refresh updated one while the page kept serving the other. See `sharedCache()` in `lib/queries/unusedHymns.ts`, whose test loads two copies of the module.
    - Track an action's pending state in `useState`, not `useTransition`. A transition held open across the action stalls every navigation until it returns.
    - A failed refresh keeps the previous data: `TtlCache.refresh` replaces the stored value only when the load succeeds.
16. **Non-ASCII in source.** Write non-ASCII characters in regex character classes and matching or normalization keys as `\u` escapes (`/[\u2018\u2019]/`), in tests too. Literal curly quotes were turned into straight quotes, and `normalizeTitle` silently stopped handling them while the test meant to cover it used straight quotes as well. Literal typographic characters in UI strings (·, ©, …) are fine.
17. **Database.** Only `getDb()` opens the database (tests use `openTestDb()`), and pages reach it only through `lib/queries/*`. SQL lives in `lib/db/<area>.ts`, in named functions that take `db` first, tested on `:memory:`. A write of more than one statement runs in `withTransaction` with a synchronous function. Migrations are append-only: never edit, reorder or remove a committed one; change the schema with a new migration. Use only the `node:sqlite` API of Node 22.13. See [Database](#database).
18. **Writes to Planning Center.** Only modules inside `lib/pco/` send a POST, PATCH or DELETE, and only through `pcoMutate` with a body from `jsonApi`. The barrel does not export them, so app code writes through `lib/queries`, which calls `lib/pco/writes.ts` from phase 3. Sync jobs pass `paced: true` on every PCO call; page loads and actions someone is waiting on never do. Never hard-code PCO's rate limits: the pacer learns them from every response. See [Writes to Planning Center](#writes-to-planning-center).

## Recipes

### Add a top-level page

Example: a Reports page at `/reports`.

1. **Query.** Create `lib/queries/reports.ts` (`import "server-only"`) that composes getters imported from `@/lib/pco`, and wrap it in `cache()` if both the page and `generateMetadata` call it. Put pure logic in `lib/reports.ts` with `lib/reports.test.ts`. If the page needs a PCO resource that has no getter, do "Add a PCO resource" first.
2. **Page.** Create `app/(app)/reports/page.tsx`:

   ```tsx
   import type { Metadata } from "next";
   import ReportsView from "@/app/components/Reports/ReportsView";
   import PageHeader from "@/app/components/ui/PageHeader";
   import { getReports } from "@/lib/queries/reports";

   export const metadata: Metadata = { title: "Reports" }; // "Reports · Service Integrator"

   export default async function ReportsPage() {
       const reports = await getReports();
       return (
           <div className="font-sans">
               <PageHeader title="Reports" description="One line about the page." />
               <ReportsView reports={reports} />
           </div>
       );
   }
   ```

   A param, if any, goes through `parsePcoId(x) ?? notFound()` and the fetch through `orNotFound(…)`. A client component that reads `useSearchParams()` goes under `<Suspense fallback={<LoadingState label="…" />}>`.
3. **Boundaries.** Create `app/(app)/reports/loading.tsx` with `LoadingState`. `error.tsx` is optional: `app/(app)/error.tsx` already catches anything below the shell, so add `reports/error.tsx` (`"use client"`, `<ErrorState message="…" reset={reset} />`) only for a page-specific message. If the page can 404, add `not-found.tsx`.
4. **Client components** go in `app/components/Reports/`: props only, no fetching. Shareable view state goes through `useUrlState`. Rows that link to data-heavy pages use `<Link prefetch={false}>`.
5. **Routing.** In `lib/routes.ts`, add `reports: () => "/reports" as const` to `routes`, and an entry to `NAV_ITEMS`:

   ```ts
   {
       href: routes.reports(),
       label: "Reports",
       isActive: (pathname) => isAtOrBelow(pathname, routes.reports()),
   },
   ```

   Extend `lib/routes.test.ts`. `npm run typecheck` runs `next typegen`, which regenerates the route types that the new `href` is checked against.
6. **Tests.** Cover the query (`vi.mock("@/lib/pco")`), the pure logic and the route builder, then run the gates and check the page in the browser.

### Add a plan tab

Example: a Notes tab at `…/{planId}/notes`.

1. **View.** Create a prop-driven `app/components/PlanItems/PlanNotes.tsx`, with any pure logic in `lib/planNotes.ts` and its test.
2. **Connector.** Create `app/components/PlanItems/NotesTab.tsx`, which reads the provider and passes props down:

   ```tsx
   "use client";

   import PlanNotes from "./PlanNotes";
   import { usePlan } from "./PlanProvider";

   export default function NotesTab() {
       const { items } = usePlan();
       return <PlanNotes items={items} />;
   }
   ```

3. **Route.** Create `app/(app)/plans/[serviceTypeId]/[planId]/(overview)/notes/page.tsx`. It exports `metadata = { title: "Notes" }` (the `[planId]` layout's template turns it into "Notes · <plan label> · Service Integrator") and renders `<NotesTab />`. It fetches nothing and has no `loading.tsx`, because the `[planId]` layout already loaded the plan. A failure is caught by `(overview)/error.tsx`.
4. **Tab entry.** In `lib/routes.ts`, add a builder to `routes` and an entry to `PLAN_TABS`, then extend `lib/routes.test.ts`:

   ```ts
   planNotes: (serviceTypeId: string, planId: string) =>
       `/plans/${serviceTypeId}/${planId}/notes` as const,
   // in PLAN_TABS:
   { segment: "notes", label: "Notes", href: routes.planNotes },
   ```

   `segment` is what `useSelectedLayoutSegment()` returns inside `(overview)/layout.tsx`. `PlanTabNav` renders its links and `aria-current` from `PLAN_TABS`, so there is nothing to edit there.
5. **More data.** If the tab needs data that `usePlan()` lacks, add it to `getPlanDetail` in `lib/queries/plans.ts` (the `PlanDetail` type flows through `PlanProvider`) and never fetch in the tab. Tab state that must survive switching tabs belongs in the provider's reducer: `lib/scheduleSelections.ts` is the model, pure and keyed by item ID.

### Add a PCO resource

Example: a team list for a service type.

1. **Raw types.** In `lib/pco/resources.ts`, add `PcoTeamAttributes` and `PcoTeamResource` as PCO sends them, with nullable fields marked `| null`.
2. **Domain type.** Add `Team` to `lib/domain.ts`.
3. **Mapper.** Add `toTeam(resource): Team` to `lib/pco/mappers.ts`. A null stays null, and a field missing from the JSON becomes null. Test it in `lib/pco/mappers.test.ts`, including null attributes.
4. **Cache policy.** In `lib/pco/cachePolicy.ts`, add `"teams"` to `PcoResourceKind` and `teams: { cache: "no-store" }` to `PCO_CACHE_POLICY`. TypeScript requires the entry.
5. **Getter.** Create `lib/pco/teams.ts`:

   ```ts
   import "server-only";
   import { cache } from "react";
   import type { Team } from "../domain";
   import { pcoFetchAll } from "./client";
   import { assertPcoId } from "./ids";
   import { toTeam } from "./mappers";
   import type { PcoTeamResource } from "./resources";

   export const getTeams = cache(async (serviceTypeId: string): Promise<Team[]> => {
       const st = assertPcoId(serviceTypeId);
       const { data } = await pcoFetchAll<PcoTeamResource>(
           `/service_types/${st}/teams?per_page=100`,
           "teams"
       );
       return data.map(toTeam);
   });
   ```

   Keep the arguments primitive with no defaults, call `assertPcoId` before building the path, use `pcoFetchAll` with `per_page=100` for a list (pass `maxPages` if it could exceed 5,000 rows) and `pcoFetch` for one resource. Only `/services/v2/` paths pass the guard: another PCO product needs a deliberate change to `guardUrl` in `lib/pco/client.ts`.
6. **Barrel.** Export it from `lib/pco/index.ts`. Consumers import `@/lib/pco`, never the file.
7. **Tests.** Create `lib/pco/teams.test.ts` with the stubbed-fetch pattern (see Testing): the exact URL including `per_page` and `include`, the auth header and `no-store`, a multi-page merge, and `InvalidPcoIdError` raised before any fetch.
8. **Use it** from a `lib/queries/*` composition, never directly from a page.

## Testing

- **No jsdom: keep logic in `lib/`.** `npm test` runs `vitest run` over `**/*.test.ts` in a `node` environment (`.claude/**` is excluded: agent worktrees hold full repo copies). There are no component tests and no E2E harness, so anything worth testing is a pure function in `lib/`, and components stay thin and are checked in the browser.
- **Characterization tests.** Before moving or changing logic, pin what it does today, quirks included (a copyright that already starts with © gets a second ©). Move the logic with the tests green, then change behavior in its own commit, which flips exactly the assertions it changes. See `lib/copyright.test.ts`, `lib/serviceSchedule.test.ts` and `lib/hymnMatch.test.ts`.
- **The stubbed-fetch pattern** (`lib/pco/testing.ts`).
  - Call `stubPcoCredentials()` in `beforeEach`, and in `afterEach` call `vi.restoreAllMocks()`, `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()`.
  - `stubFetchRoutes({ [url]: body })` replaces global `fetch` with a table of full URLs, and a URL missing from the table fails the test. Each call returns a **fresh** `Response` (`json(body)`), because a body can be read only once.
  - A bare URL key answers GET only, so a stray write fails the test. Key a write as `` [`POST ${url}`] ``. The method is matched as sent: fetch upper-cases POST and DELETE but not PATCH, and PCO rejects `patch`. A route that is a function receives the request init and builds the `Response`, such as `() => new Response(null, { status: 204 })`.
  - `listPage(data, { next, included, total })` builds a paged JSON:API list, and `serviceTypeResource`, `planResource`, `itemResource` and `songResource` build raw resources. `calledUrls(fetchMock)` returns the URLs requested, in order, and `calledRequests(fetchMock)` returns `{ method, url, body }` for each call, with the body parsed from JSON.
  - Use fake timers for 429 retries. Test a query module against the stubbed fetch, or mock the barrel with `vi.hoisted` plus `vi.mock("@/lib/pco", …)`; queries import only from the barrel, so the mock applies. For module-level caches, load a fresh copy per test with `vi.resetModules()` and `import(…)`.
  - **The pacer.** Every response feeds the shared pacer, so a test of paced code calls `stubPcoPacer()` first. It swaps in a fresh pacer until `vi.unstubAllGlobals()`, and that pacer runs on `Date.now`, so `vi.useFakeTimers()` drives it. Spy on its `acquire` to see the turns, or send rate-limit headers and 429s and advance the clock. Test the pacer itself through `createPacer({ now, sleep })` with a hand-driven clock.
- **The database.** Test `lib/db` functions on `openTestDb()`, a migrated in-memory database, and `lib/queries` modules with only `getDb` mocked to return one (see [Database](#database)). Tests that touch files (`getDb`, backups) use a `mkdtempSync` folder and `vi.stubEnv` for `DATABASE_PATH` and `DATABASE_BACKUP_DIR`. CI runs the tests on Node 22, so run `npx vitest run lib/db` under Node 22 too when you change `lib/db`.
- **The `server-only` alias.** The real package throws outside a React Server environment, so `vitest.config.mts` aliases `/^server-only$/` to `test/stubs/server-only.ts` (`export {}`), and server modules can be imported in tests. Do not use `resolve.conditions: ["react-server"]` instead: it switches `react` to its server build in every test. `esbuild.jsx: "automatic"` compiles TSX.
- **Gates.** Run all four before every commit:

  ```sh
  npm test
  npm run lint
  npm run typecheck   # clears .next/types, runs `next typegen`, then `tsc --noEmit`
  npm run build       # then check the route table: every (app) route is ƒ (Dynamic)
  ```

  `typecheck` clears `.next/types` first because `next typegen` never deletes the types of removed or renamed routes, and those leftovers fail `tsc`. `next build` and `typecheck` both write `.next/`, so do not run them at the same time in one tree. In a nested git worktree (`.claude/worktrees/*`), `npm run lint` picks up the parent `.eslintrc`; lint with `ESLINT_USE_FLAT_CONFIG=false npx eslint --no-eslintrc -c .eslintrc.json --ext .js,.jsx,.ts,.tsx app lib`. CI runs `npm test` before it builds and deploys.
- **Browser check.** Check UI changes with `npm run dev` while signed in (Google sign-in cannot be automated). Prefetch behavior shows only in a production build: `npm run build && npm start`.
