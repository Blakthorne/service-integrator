# Multi-page routing migration — Service Integrator

> **Status:** approved 2026-10-03. Branch `refactor/multi-page-routing`. This copy is the living plan that implementer and reviewer subagents read.
> **PCO spike done.** Results are under Phase 0 and override any earlier assumption in this document.

## Context

The main Plans flow is a client-side SPA: [app/(app)/page.tsx](app/(app)/page.tsx) switches between
`PlansTable → PlanItems → SongDetails` with `useState`, passing the selected objects around in memory.
The URL never changes, so:

- nothing can be linked or shared (e.g. "here's Sunday's schedule");
- refresh drops you back at the list, and Back leaves the view entirely;
- rows are `<tr onClick>`, not links (no open-in-new-tab, no keyboard access);
- every view fetches the app's own `/api/*` from the browser (a waterfall built on `NEXT_PUBLIC_BASE_URL`) and re-implements loading/error UI;
- the `Plan`, `PlanItem`, `HymnVersion` and song types are re-declared in 5+ files.

`/unused-hymns` (PR #1) already shows the route-based pattern working.

**Goal.** Every view has its own URL and is rendered on the server for direct loads and refreshes. Back/forward, deep links and new tabs all work, and `<Link>` keeps transitions fast. Set up conventions so a future feature means adding a folder plus a nav entry.

**Decisions (confirmed with the user)**
- `/plans` is the canonical list. `/` sends a temporary 307 redirect to `/plans`, which keeps `/` free for a future dashboard.
- Plan tabs are **nested routes**: Copyright at `…/{planId}`, Schedule at `…/{planId}/schedule`.
- **Tests:** characterization and unit tests (Vitest), `npm test` gating the deploy workflow, and a scripted manual check of every route in the browser. No component-test or E2E harness.
- **Fixes the user asked for:** match items to songs by PCO ID; fix the custom-text focus loss; delete the dead API routes and code; server-render Unused Hymns.

**Fixes found during planning or research.** Included, each in its own commit. Object at approval if you'd rather defer any.
- **Plans with more than 25 items would be silently cut off.** PCO's per-page default is 25 (max 100), and `/api/plan-items` sets no `per_page`. *Spike: latent today, since the largest current plan has 17 items.* Fix: `per_page=100` and follow `links.next`.
- **The plan list is missing the oldest plans.** `per_page=500` is capped at 100, and Sunday Morning has 121 plans, so the 21 oldest never show. *Spike: fetching the full history costs one extra call today.* Fix: `pcoFetchAll` the plans per service type (`maxPages` cap).
- **The hymn lookup still requires an exact lowercase match.** Commit `a1df0d5` normalized only the client side. 60 `hymns.json` titles have trailing punctuation and 4 have curly quotes, so those hymns never get numbers. Fix: key the lookup by `normalizeTitle()`.
- **A null song author crashes `formatCopyrightText`** (`author.split`). Fix: treat null like "" ("Unknown").
- **IDs from the URL are pasted unchecked into PCO request paths.** `serviceTypeId=../../../people/v2/people%3F` makes the app call another PCO API with the org's token. Fix: validate IDs, and add an origin/path guard in `pcoFetch`.
- **The schedule header date is computed in whichever time zone the code runs in.** PCO's `sort_date` is org-local, so a browser can shift an early service onto the previous day, and server rendering would cause hydration mismatches. Fix: format from the `YYYY-MM-DD` part.

**Freshness stays as it is today** (always fresh). There is per-request dedupe with React `cache()`. HTTP caching per PCO resource kind is a single switch in `lib/pco/cachePolicy.ts` (all `no-store` today). The only cross-request caches are in-memory TTLs: plan labels for page titles, and Unused Hymns, which already works this way.

## Target architecture

### Route map
Boundary placement was checked against the installed Next 15.5.9 source.
```
app/
  layout.tsx                    root; title { default: "Service Integrator", template: "%s · Service Integrator" }
  not-found.tsx                 404 for unmatched URLs. Renders OUTSIDE (app), so no nav: standalone card linking to /plans
  (app)/layout.tsx              export const dynamic = "force-dynamic"; Navigation + <main> + Footer (moved from old Home)
  (app)/error.tsx               shell-level error boundary
  (app)/page.tsx                redirect(routes.plans()), a 307
  (app)/plans/(list)/page.tsx   server: getPlansByDate() → <Suspense><PlansList/></Suspense>
  (app)/plans/(list)/loading.tsx    in a route group so the list skeleton doesn't also wrap the plan routes
  (app)/plans/[serviceTypeId]/loading.tsx | error.tsx | not-found.tsx
                                ↑ one level up, because a segment's own boundaries don't wrap its own layout;
                                  these cover the [planId] LAYOUT's fetch and notFound()
  (app)/plans/[serviceTypeId]/[planId]/layout.tsx
                                server: parsePcoId → getPlanDetail() → <PlanProvider>; generateMetadata via getPlanLabels()
  (app)/plans/[serviceTypeId]/[planId]/error.tsx
                                catches tab/item errors BELOW the provider, so the selections survive
  (app)/plans/[serviceTypeId]/[planId]/(overview)/layout.tsx
                                PageHeader + PlanItemsTable + PlanTabNav. It must be rendered here:
                                useSelectedLayoutSegment() gives null / "schedule" here, but "(overview)" one level up
  (app)/plans/[serviceTypeId]/[planId]/(overview)/page.tsx           Copyright tab (default)
  (app)/plans/[serviceTypeId]/[planId]/(overview)/schedule/page.tsx  Schedule tab; metadata.title "Schedule"
  (app)/plans/[serviceTypeId]/[planId]/items/[itemId]/page.tsx       server: parsePcoId → notFound(); client detail reads the provider
  (app)/plans/[serviceTypeId]/[planId]/items/[itemId]/not-found.tsx
  (app)/unused-hymns/page.tsx + loading.tsx   server-rendered initial data; book/sort/page in the URL
  auth/signin/page.tsx          honours ?callbackUrl= so deep links survive sign-in
```

### Server data layer
```
lib/pco/                  import "server-only". PCO transport, mapping and resource getters
  index.ts                barrel. `git mv lib/pco.ts lib/pco/index.ts` keeps `@/lib/pco` and vi.mock("@/lib/pco") working
  client.ts               pcoFetch<T>(path, kind) · pcoFetchAll<T,I>(path, kind, {maxPages=50}) → {data, included, totalCount} · PcoError(status, path)
  cachePolicy.ts          PCO_CACHE_POLICY: Record<PcoResourceKind, RequestInit>. Today all { cache: "no-store" }
  ids.ts                  parsePcoId(raw): PcoId | null (/^[1-9][0-9]{0,19}$/) · assertPcoId (getters call it)
  resources.ts            raw JSON:API types, moved out of the route files
  mappers.ts              toPlan (uses attributes.planning_center_url) · toPlanItem (+ songId) · toSong · joinItemsToSongs
  serviceTypes.ts plans.ts planItems.ts songs.ts   getters, each `cache()`-wrapped, primitive args, no defaults
  next.ts                 orNotFound(promise): turns a 404 PcoError or invalid ID into notFound()
lib/queries/              import "server-only". Page-facing compositions; pages import from here
  plans.ts                getPlansByDate() → {dates, plansByDate, failedServiceTypeIds}
                          · getPlanDetail(st, plan) → {plan, serviceType, items: PlanItemWithSong[], hymns}
                          · getPlanLabels(st, plan): 5-min TTL, never throws, for generateMetadata
  unusedHymns.ts          getUnusedHymns({ refresh }): 1-h TTL (moved from the route)
lib/hymnCatalog.ts        import "server-only". Wraps hymns.json so its 152 KB never reaches client bundles
lib/ (pure, client-safe)  domain.ts (types) · copyright.ts · serviceSchedule.ts · hymnMatch.ts · plansByDate.ts · format.ts
                          · ttlCache.ts · routes.ts · urlState.ts · safeCallbackUrl.ts
```
**`pcoFetch` / `pcoFetchAll` rules:**
- Normalize the URL and require the PCO origin plus a `/services/v2/` path. Apply the same check to every `links.next`.
- Append `data` page by page in order. Dedupe `included` by type and id.
- Retry a 429 once, and only when `Retry-After` is 5 seconds or less.
- Read `res.headers` only on failure, because the existing mocks are bare `{ok, json}`.

**Getter limits:**
- `getPlansForServiceType` fetches **all** of a type's plans: `order=-sort_date&per_page=100` through `pcoFetchAll` (`maxPages` 20). This changed after the spike; it lands as its own fix commit.
- `getAllPlans` skips a failed type as it does today, but now reports it in `failedServiceTypeIds`.

### Data flow & state
```
page/layout (server) ──► lib/queries ──► lib/pco ──► PCO
        │ serializable props
        ▼
client components (interaction only) ── URL state via useUrlState (shallow history API, no server round trip)
```
**Server work.** The `[planId]` layout fetches the plan once. The server only renders the segments that change, so switching tabs or opening a song and coming back with `<Link>` never re-runs that fetch. Moving to another plan remounts `PlanProvider`, because its key includes `planId`.

**State.** `router.refresh()` does re-run the layout. That's why the provider keeps **server data in props**, never copied into `useState`. Selections live in a separate `useReducer` keyed by item ID, and the merged view (`items` with each item's selection, songs defaulting to version 0) is derived from both.

**Back/forward** from the list restores Next's cached page but not provider state; that's today's behavior.

## Conventions (written up in `docs/architecture.md`)
1. **Routes.** A route is a folder under `app/(app)/`. `page.tsx` and `layout.tsx` are server components; client components are used only for interaction.
2. **Hrefs.** Hrefs come only from `lib/routes.ts` builders, which return `` `/plans/${st}/${id}` as const `` (a plain `: Route` annotation fails to compile), with `typedRoutes: true`. `NAV_ITEMS` and `PLAN_TABS` live there too. External PCO web links come from the `pcoWebUrls` helpers (the same URLs as today).
3. **Data access.** Server pages and layouts get data from `lib/queries/*`, and use `parsePcoId`/`orNotFound` from `lib/pco`. Nothing fetches `/api/*` from the server: it goes through middleware without cookies and gets redirected to sign-in. Client components receive data as props or from a provider.
4. **Types.** Domain types live only in `lib/domain.ts`; raw PCO shapes only in `lib/pco/resources.ts`. UI state (`ScheduleSelection`) is kept out of domain types.
5. **URL state.** Shareable view state lives in the URL. Client-only state goes through `useUrlState` (`history.replaceState/pushState` with `null` state, called only from handlers or effects). The current value is read with `useSearchParams()`, because the server's `searchParams` prop misses shallow updates. Parameters that change the server data are read from `searchParams` on the server.
6. **Page chrome.** Every page uses `<PageHeader title description breadcrumbs actions>` and exports `metadata` or `generateMetadata`.
7. **Boundaries.** Data segments get `loading/error/not-found.tsx`, using the shared `LoadingState/ErrorState/EmptyState`. When a *layout* fetches, those files go one segment up. Keep a boundary below any stateful provider.
8. **Validation.** Dynamic params pass through `parsePcoId(x) ?? notFound()`, and fetches through `orNotFound(...)`.
9. **Pure logic.** Pure logic lives in `lib/` with tests. Components stay thin and prop-driven; small route-level connectors read from providers.
10. **Dates.**
    - Calendar dates from PCO are formatted from their `YYYY-MM-DD` part, using UTC math, so the output is the same in every time zone.
    - True instants such as `computedAt` render through `<LocalTime iso>`, in the viewer's time zone, without hydration warnings.
11. **No prerendering.** `force-dynamic` is set on the `(app)` layout, because CI builds without PCO credentials. Never call `connection()` inside `lib/pco`, since it throws outside a request.
12. **Metadata.** Never throw from metadata, and keep it cheap: it re-runs on every navigation, refresh and production prefetch. Use `getPlanLabels()` with a fallback title.
13. **Prefetch.** Rows that link to data-heavy routes use `prefetch={false}`. Otherwise, in production, 25 rows would each trigger a metadata lookup and PCO calls. All users share one PCO budget of 100 requests per 20 seconds.
14. **Error retry.** Retry with `startTransition(() => { router.refresh(); reset(); })`; calling `reset()` alone doesn't refetch. Client code never calls `notFound()`: it renders an inline `EmptyState`.

## Reuse (don't rebuild)
- `pcoAuthHeaders()` and the `links.next` loop in `fetchAllSongs` [lib/pco.ts](lib/pco.ts) become the core of `pcoFetchAll`.
- `normalizeTitle` [lib/normalizeTitle.ts](lib/normalizeTitle.ts) is the hymn index key.
- `computeUnusedHymns` [lib/unusedHymns.ts](lib/unusedHymns.ts) is kept as is.
- `Pagination` [app/components/ui/Pagination.tsx](app/components/ui/Pagination.tsx) is kept as is.
- `CopyButton` [app/components/PlanItems/CopyButton.tsx](app/components/PlanItems/CopyButton.tsx) moves to `ui/` and gains a `label` prop. It replaces the duplicated clipboard code in `SongDetails` and `SongCopyright`.
- `UnusedHymnsView`'s `updateParam` and `parseBook`/`parseSort` generalize into `useUrlState` and `lib/urlState.ts`.
- Test patterns: `vi.stubGlobal("fetch")` [lib/pco.test.ts](lib/pco.test.ts) (return a fresh `new Response()` per call) and `vi.hoisted` + `vi.mock` [route.test.ts](app/api/unused-hymns/route.test.ts).
- The existing Tailwind card, table, spinner and error markup becomes the shared UI components.

## Phases
**Every step ends green** on `npm test`, `npm run lint`, `npm run typecheck` (after Phase 2) and `npm run build`. The app works at every commit.

**Commits.** Conventional commits, one per step, and every behavior change gets its own commit, flipping the characterization assertion it changes. Branch `refactor/multi-page-routing`, one PR, like #1. Main auto-deploys, so merge only after the full browser check.

### Phase 0: Set up the safety net (no behavior change)

**PCO spike results (2026-10-03).** These are facts; build on them.

**Service types and plan counts**
- Two service types: Sunday Morning `1405391` and Sunday Evening `1486055`, neither archived.
- Plans per type: 121 for Sunday Morning, 95 for Sunday Evening.
- `per_page=500` is capped at 100, and `links.next` keeps `order` and `per_page`.

**Plan items**
- The largest plan has 17 items, so the 25-item truncation doesn't affect today's data. It's still fixed, because it costs nothing.
- Items carry `relationships.song.data {type:"Song", id}`, and every included resource has type `Song`.
- The items `links.next` keeps `include=song` and `per_page`.

**A single plan**
- `GET /service_types/{st}/plans/{id}` returns `dates` ("October 4, 2026"), `short_dates`, `sort_date` ("2026-10-04T08:00:00Z"), `title` (may be null), `items_count`, and `relationships.service_type.data.id`.
- `planning_center_url` is the **web** URL (`https://services.planningcenteronline.com/plans/{id}`). `links.html_url` is null.

**Dates and time zone**
- `sort_date`'s date part equals the date in `dates`, even for an evening plan. So format calendar dates from the `YYYY-MM-DD` part using UTC math. No org time zone is needed; for reference, the org's is `America/New_York`.

**Errors and rate limits**
- A non-numeric ID returns **404**, and a nonexistent plan returns **404**.
- Rate-limit headers are `x-pco-api-request-rate-{count,limit=100,period=20}`.

**Baseline capture:** best-effort. Claude in Chrome is disconnected, so the characterization tests stand in until the browser check in W6.

- [ ] Copy this plan to `docs/superpowers/plans/2026-10-03-multi-page-routing.md`.
- [ ] **Capture a baseline** on the current build. Record both "Copy All" texts for 3–4 real plans: one with more than 25 items, one with a renamed song item, one with a multi-tune hymn, and one evening service.
- [ ] **PCO spike.** Each line confirms a research finding:
  ```sh
  set -a; source .env.local; set +a; B=https://api.planningcenteronline.com/services/v2
  pco() { curl -sS -u "$PLANNING_CENTER_ID:$PLANNING_CENTER_TOKEN" "$B$1"; }
  ST=$(pco '/service_types' | jq -r '.data[0].id')
  pco "/service_types/$ST/plans?order=-sort_date&per_page=500" | jq '{len:(.data|length),total:.meta.total_count}'  # expect len 100
  BIG=$(pco "/service_types/$ST/plans?order=-sort_date&per_page=100" | jq -r '[.data[]|select(.attributes.items_count>25)][0].id')
  pco "/service_types/$ST/plans/$BIG/items?include=song" | jq '{len:(.data|length),total:.meta.total_count}'       # expect len 25 → truncation
  pco "/service_types/$ST/plans/$BIG/items?include=song&per_page=2" | jq '{next:.links.next,s:[.data[].relationships.song.data]}'  # song ids; next keeps include?
  pco "/service_types/$ST/plans/$BIG" | jq '{a:(.data.attributes|{dates,sort_date,planning_center_url}),st:.data.relationships.service_type.data}'
  curl -sS -o /dev/null -w '%{http_code}\n' -u "$PLANNING_CENTER_ID:$PLANNING_CENTER_TOKEN" "$B/service_types/abc/plans/$BIG"  # expect 404
  ```
  Also, for an **evening** plan, check that `sort_date`'s date part equals the date in `dates`. If it doesn't, `sort_date` is real UTC, and `lib/format.ts` must use the org's `time_zone` from `GET /services/v2`.
- [ ] Add an `npm test` step before "Build app" in [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
- [ ] **Test tooling, first, because `lib/hymnCatalog.ts` below already imports `server-only`.** Run `npm i server-only`. In [vitest.config.mts](vitest.config.mts), alias `/^server-only$/` to `test/stubs/server-only.ts` (`export {}`) and add `esbuild: { jsx: "automatic" }`. Do not use `resolve.conditions: ["react-server"]`: it would switch `react` to its server build in every test.
- [ ] **Characterization tests: move the logic out unchanged, have today's code call it, and pin current behavior.**
  - **`lib/copyright.ts`:** `formatCopyrightText` and `buildCopyrightCopyAllText`.
    - Author rules: a single author; "A and B"; "A, B, C" → Words A and B / Music C; a 4th author dropped; "A, B" treated as one; "" → Unknown.
    - Copyright rules: null → "Public Domain."; "" → "© ." (a quirk, pinned); case-insensitive public domain; no doubled "."; admin suffix.
    - Copy All: song items only, in sequence order, unmatched items skipped, joined with "\n\n". A renamed item (title ≠ song title) gets **no** entry today; this assertion flips with the PCO-ID join.
  - **`lib/serviceSchedule.ts`:** `formatHymnNumbers` and `buildScheduleCopyText`.
    - Header only for the exact "Sunday Morning"/"Sunday Evening".
    - Songs only, sorted by sequence.
    - No hymn match: Custom / blank.
    - Hymn match: default, other and out-of-range versions; Leave blank still prints the numbers; Custom with empty text.
    - Titles matched by `normalizeTitle`.
    - Joined with "\n", no trailing newline.
  - **`lib/hymnMatch.ts`** (`buildHymnIndex(catalog)`, `matchHymns`), plus `lib/hymnCatalog.ts`, called by `/api/hymns`.
    - Case-insensitive exact match; the requested title is echoed back.
    - Tune variants keep catalog order; `id` format; the numbers as strings including "-1"; `selected` only when there's a single version.
    - "Title!" or a curly apostrophe does **not** match (this assertion flips in Phase 1).
  - **`lib/plansByDate.ts`:** `groupPlansByDate` and `formatPlanDateHeading`.
    - Newest first by string compare; grouped by date part; ties keep service-type order.

### Phase 1: Types and server-only data layer (UI unchanged)
- [ ] `lib/domain.ts`: `ServiceType`, `Plan`, `PlanSummary`, `Song` (nullable fields), `PlanItem` (+ `songId`), `PlanItemWithSong`, `HymnVersion`, `HymnData`, `ScheduleSelection`. Replace every duplicate.
- [ ] Build `lib/pco/` as designed above (`git mv` first, then fix `./unusedHymns` → `../unusedHymns`).
  - Delete `/api/plans` and `/api/service-types`, which have no consumers, once their types move.
  - The old `/api/all-plans` and `/api/plan-items` stay untouched until Phases 3–4 remove their consumers.
- [ ] `lib/ttlCache.ts` and `lib/queries/plans.ts` (`getPlansByDate`, `getPlanDetail`, `getPlanLabels`).
- [ ] **Data-layer tests** (stubbed fetch):
  - **Requests:** exact paths including `per_page`/`order`/`include`; auth header; `no-store`.
  - **Errors:** `PcoError` status; 429 retry (fake timers); a traversal path or foreign `next` link rejected before any fetch.
  - **Pagination:** three-page merge with `included` deduped; `maxPages`.
  - **IDs:** `parsePcoId` accepts "1" and "123"; rejects "", "0", "01", "-1", "1.5", "1e3", " 1", "../1", full-width digits, 21 digits, and non-strings.
  - **Mappers:** `songId` present, missing or null; null attributes kept.
  - **Getters:** 120 items across 2 pages come back complete and sorted; `getAllPlans` reports partial failure.
  - **Caches:** `ttlCache` hit, expiry, and no caching of failures; `getPlanLabels` returns the fallback on error.
- [ ] **Fix commits.** Each one is separate and flips its pinned assertion where one exists; (1) adds a new test instead. Users get these at cutover, since the old API routes stay untouched:
  - (1) plan items paginate past 25;
  - (2) **match songs by PCO ID**: `joinItemsToSongs` matches by ID first, then by exact title;
  - (3) normalized hymn lookup;
  - (4) a null author is treated as "Unknown".

### Phase 2: Routing foundations
- [ ] `export const dynamic = "force-dynamic"` in [app/(app)/layout.tsx](app/(app)/layout.tsx). Check that the `next build` route table lists every `(app)` route as ƒ (Dynamic).
- [ ] `lib/routes.ts` (`routes.*`, `NAV_ITEMS`, `PLAN_TABS`, `pcoWebUrls`) plus tests.
  - `typedRoutes: true` in [next.config.ts](next.config.ts).
  - Type props with the generated `PageProps<'/plans/[serviceTypeId]/[planId]'>` / `LayoutProps<…>` (route groups are dropped from the key; `params` is a Promise).
  - Add the script `"typecheck": "next typegen && tsc --noEmit"`. Without generated types, `Route` quietly becomes `string`.
- [ ] `lib/urlState.ts` (`parsePage`, `parseEnum`) and `app/hooks/useUrlState.ts`.
- [ ] **TZ-safe dates.**
  - `lib/format.ts` with UTC math on the `YYYY-MM-DD` part.
  - `buildScheduleCopyText` takes the plan's date string instead of a `Date`; update its test in the same commit.
  - Add the `<LocalTime>` client component.
- [ ] **Shell.**
  - Add the root metadata title template.
  - In the `(app)` layout, add the Footer (moved) and make the nav brand a `<Link>` to `/plans` instead of a second `<h1>`; removing the old Home also removes its nested `<main>`.
  - `NavLinks` reads `NAV_ITEMS`; Plans is active on `/` and `/plans/*`.
- [ ] `app/components/ui/`: `PageHeader`, `Breadcrumbs`, `LoadingState`, `ErrorState` (with the refresh + reset retry), `EmptyState`, and `CopyButton` (moved, with a `label` prop). Add `app/not-found.tsx` and `app/(app)/error.tsx`.
- [ ] **Deep links survive sign-in.**
  - [middleware.ts](middleware.ts) adds `callbackUrl` (pathname + search).
  - [signin/page.tsx](app/auth/signin/page.tsx) passes `safeCallbackUrl(cb) ?? routes.plans()` to both `redirect()` and `signIn("google", { redirectTo })`.
  - `safeCallbackUrl` accepts only a single leading `/`, rejecting `//`, `/\` and `/auth/*`; it has tests.
  - next-auth's default `redirect` callback already keeps `signIn` same-origin, but our own `redirect()` would otherwise be an open redirect.

### Phase 3: Plan detail and item routes (detail-flow cutover)
- [ ] `[serviceTypeId]/{loading,error,not-found}.tsx` and `[planId]/layout.tsx` → `PlanProvider` / `usePlan()`, plus `[planId]/error.tsx`.
- [ ] `generateMetadata` in the `[planId]` layout: `title: { default: label, template: "%s · <label> · Service Integrator" }`. Children supply only the leading part, e.g. "Schedule" or the item title.
- [ ] `lib/scheduleSelections.ts` reducer plus tests. The provider derives the merged items; `buildScheduleCopyText`'s tests stay green.
- [ ] `(overview)/layout.tsx`:
  - a `PageHeader` with breadcrumb Plans › label and the PCO plan link as an action;
  - `PlanItemsTable`, where the title cell is a `<Link>` stretched across the row and author/CCLI come from `item.song`;
  - `PlanTabNav`: a `<nav>` of links with `aria-current`, driven by `PLAN_TABS`.
- [ ] `(overview)/page.tsx` → `CopyrightInformation`. `schedule/page.tsx` → `ServiceSchedule`. Both stay prop-driven, fed by small connectors, and use `item.song` instead of the title lookup.
- [ ] **Fix the custom-text focus loss.**
  - **Cause:** `CustomTextInput`/`CustomOption`/etc. are defined inside `ServiceSchedule`'s render, so they remount whenever the parent re-renders, and the debounced update makes that happen about 0.5 s after typing pauses.
  - **Fix:** move them to module scope, and update through the reducer with functional updates.
- [ ] `items/[itemId]/page.tsx`:
  - server: `parsePcoId` → `notFound()`, caught by `items/[itemId]/not-found.tsx`;
  - client `PlanItemDetail` reads the provider and shows an inline `EmptyState` if the ID isn't there;
  - `SongDetails` becomes presentational, with breadcrumb Plans › label › item and the shared `CopyButton`.
- [ ] **Cutover.** Make the `PlansTable` rows `<Link prefetch={false}>` to `routes.plan(...)`, and have Home render only the list. Delete the `PlanItems.tsx` container, `/api/plan-items` and `/api/hymns`.

### Phase 4: Plans list route and redirect
- [ ] `plans/(list)/page.tsx` (`metadata.title = "Plans"`, with the old hero description) and `plans/(list)/loading.tsx`.
- [ ] `PlansTable` → `PlansList` inside `<Suspense>`: no fetching, page kept in `?page=` via `useUrlState`, `<Link prefetch={false}>` rows. Show a quiet warning when `failedServiceTypeIds` isn't empty.
- [ ] `(app)/page.tsx` → `redirect(routes.plans())`. Point the nav at `/plans`. Delete `/api/all-plans` and the old Home/`PlansTable` code.

### Phase 5: Server-render Unused Hymns
- [ ] `lib/queries/unusedHymns.ts` `getUnusedHymns({ refresh })` on `ttlCache` (1 h), replacing the module cache in [route.ts](app/api/unused-hymns/route.ts).
  - Port its cache-hit, refresh-bust and error tests.
  - Import `fetchAllSongs` from the `@/lib/pco` barrel. Importing from `@/lib/pco/songs` would quietly bypass `vi.mock("@/lib/pco")`.
- [ ] `page.tsx` awaits the data and passes `initialResult`; add `loading.tsx`.
- [ ] Refresh becomes a server action (`refreshUnusedHymns` in `app/(app)/unused-hymns/actions.ts`) using `useTransition`, which replaces the fetch/abort/mounted-ref logic in [UnusedHymnsView.tsx](app/components/UnusedHymns/UnusedHymnsView.tsx). The action calls `auth()` and throws without a session: actions are public POST endpoints, so don't rely only on middleware.
- [ ] book, sort and **page** use `useUrlState`. A `router.replace` would now re-run the server render.
- [ ] Use the shared chrome; render `computedAt` with `<LocalTime>`. Delete `/api/unused-hymns` and its old test.

### Phase 6: Cleanup and docs
- [ ] Delete `HymnVersionSelector.tsx`, and drop `HymnVersion.selected` if nothing reads it.
- [ ] grep should find no `fetch("/api`, no `NEXT_PUBLIC_BASE_URL`, and no `app/api/*` except auth.
- [ ] Remove `NEXT_PUBLIC_BASE_URL` from deploy.yml (build env and env-file writer). Tell the user they can delete the GitHub secret and the `.env.local` line.
- [ ] `docs/architecture.md` (route map, data layer, conventions 1–14, and a "how to add a page" recipe), a README update, and a short `CLAUDE.md` pointing to it.

## Execution strategy (subagents)

**Roles**
- **Orchestrator (main session).**
  - Owns the branch and the order of work.
  - Does the small setup steps itself: branch, plan copy, CI step, `server-only` and the Vitest alias, the PCO spike.
  - **Runs the gates itself after every wave** (`npm test`, `lint`, `typecheck`, `build` and the route table) rather than trusting agent reports.
  - Sorts review findings and never redoes delegated work.
- **Implementers** (`general-purpose`), one per track.
  - Brief: "Implement Phase N, steps …, of `docs/superpowers/plans/2026-10-03-multi-page-routing.md`", plus the files they own and the rules below.
  - Review fixes go back to the **same** implementer via `SendMessage`, so it keeps its context. Phase 4 also goes back to the Phase 3 implementer, which already knows the plans flow.
- **Reviewers** (read-only).
  - Scoped to `git diff <wave-base>..HEAD` and checked against the phase checklist and the conventions.
  - Report only verified findings, with file:line.
  - `ecc:typescript-reviewer`, with a security focus, for the data layer, ID validation and `callbackUrl`. `ecc:react-reviewer` for routing and UI.

**Rules in every implementer brief**
- **Files:** stay inside the listed file set. Commit with explicit paths (`git commit -m "…" -- <paths>`), so two agents sharing a tree never commit each other's staged files. Retry if `index.lock` is held.
- **Commits:** one conventional commit per plan step, behavior changes in their own commit, and every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks:** run `npm test` and `npm run lint` before each commit. When sharing the tree with another agent, never run `next build`/`typecheck`, because both write `.next/`; the orchestrator runs those.
- **Report:** at most 200 words: commits, files, test counts, deviations from the plan, open questions. No file dumps.

**Waves** (→ sequential, ∥ parallel)
| Wave | Work | Agents (model) |
|---|---|---|
| W0 | Branch, plan copy, CI `npm test` step, `server-only` + Vitest alias, PCO spike (results recorded in the docs copy of the plan) | orchestrator |
| W1 | Phase 0 characterization: (a) copyright + schedule ∥ (b) hymnMatch/hymnCatalog + plansByDate, same tree, files disjoint | 2 implementers (Sonnet) |
| W2 | Phase 1 data layer and its fix commits, a single coherent design | 1 implementer (Opus) |
| W3 | Phase 2: (a) force-dynamic, routes/typedRoutes/typecheck, shell, shared UI, boundaries ∥ (b) urlState/useUrlState, format/LocalTime, CopyButton move, `callbackUrl`. ∥ review of W2 (it touches only `lib/pco`, `lib/queries`) | 2 implementers (Sonnet) + reviewer (Opus) |
| W4 | Phase 3 → Phase 4, same implementer ∥ Phase 5 in an **isolated worktree** (`npm ci` first; the orchestrator cherry-picks it once Phase 4 lands). ∥ review of W3 | 2 implementers (Opus) + reviewer (Opus) |
| W5 | Reviews of Phases 3–5 → fixes via `SendMessage`; then Phase 6 cleanup and docs | reviewers (Opus) + 1 implementer (Sonnet) |
| W6 | Final whole-branch review, full gates, production-build pass, browser check | reviewer (Opus) + orchestrator + the user's signed-in session |

**Stop points (I check in with you)**
- After W0, if the spike contradicts the research (e.g. `sort_date` turns out to be real UTC).
- Whenever a review finding would change the plan.
- **Before pushing the branch or opening the PR**, because that's outward-facing and main auto-deploys.

**Browser check.** It needs your signed-in session: reconnect Claude in Chrome before W6, or run the checklist yourself. The Phase 0 baseline is captured the same way if a browser is available. Otherwise the characterization tests stand in for it, since they pin the copy-text logic exactly.

## Verification
- **Per step:** `npm test && npm run lint && npm run typecheck && npm run build`, plus the build route table showing ƒ for `(app)` routes.
- **Browser check** (`npm run dev`, signed in). Google sign-in can't be automated, so this runs through Claude in Chrome on the user's signed-in session. That extension disconnected during planning; reconnect it before Phase 0's baseline capture, or the user runs the checklist by hand.
  1. `/` redirects to `/plans`. Page 2 sets `?page=2`; refresh keeps it; Back returns to page 1.
  2. A plan row goes to `/plans/{st}/{id}`; cmd-click opens a new tab; the tab title shows the plan; the breadcrumb leads back.
  3. Schedule: the URL becomes `/schedule`. Pick a non-default version and type custom text; **focus stays after a pause**. Open a song, go Back, and the selections are still there.
  4. Both "Copy All" texts match the Phase 0 baseline, apart from the listed fixes: the >25-item plan now shows its closing songs; the renamed item now shows its copyright; normalized hymn matches.
  5. Every URL renders correctly on a hard refresh.
  6. `/plans/abc/1`, a nonexistent plan, and `/plans/{st}/{id}/items/abc` all show not-found pages, with the nav for the nested ones.
  7. Signed out, opening a deep link → sign in → lands on that deep link. `/auth/signin?callbackUrl=//evil.com` goes to `/plans`.
  8. `/unused-hymns?book=rejoice&sort=number&page=2` works as a deep link; Refresh works; changing a filter resets the page.
  9. Keyboard-only: rows are reachable and Enter opens them; the tab nav uses `aria-current`. Check dark mode and phone width.
  10. No hydration warnings in the console. No client `/api/*` calls in the network panel; PCO is called only from the server.
- **Production-build pass** (`npm run build && npm start`; prefetch only happens in production):
  - `/plans` fires no plan-route prefetches for the visible rows.
  - Tab switches make no PCO calls, only a cached label lookup.
  - With a temporarily bad PCO token on the Schedule tab, `[planId]/error.tsx` keeps the header and selections, and Try again recovers.

## Risks
| Risk | Mitigation |
|---|---|
| A route gets pre-rendered at build (no PCO credentials in CI) | `force-dynamic` on the `(app)` layout; checked in the build route table every step |
| `generateMetadata` re-runs on every navigation and prefetch, and a throw breaks the page | `getPlanLabels()` is TTL-cached and never throws; list rows use `prefetch={false}` |
| An error in a tab wipes the plan view and the selections | `[planId]/error.tsx` below the provider; no client `notFound()` |
| The intended fixes change the copy text | Phase 0 baseline; every difference must trace to a listed fix commit |
| One shared PCO rate-limit budget (100 requests / 20 s) | Fewer client fan-outs, a 429 retry, prefetch off on list rows |
| `vi.mock("@/lib/pco")` quietly stops applying | Tests and queries import only from the barrel |
| Main auto-deploys | One PR, merged after the full browser check and production-build pass |

**Intentionally not fixed (pinned by tests; follow-ups to raise with the user):**
- "© ." for songs whose copyright is an empty string. What it should say instead is a product decision.
- The `output: 'standalone'` vs `next start` warning in deploy.

## Implementation notes (2026-10-03)

Deviations from the plan, and things found while building it, by phase.

**PCO data (Phase 1)**
- The getters first copied today's behavior. Separate `fix:` commits then added what the plan listed as fixes: items past 25 (PCO's default page), the full plan history (Sunday Morning has 121 plans, so the 21 oldest were missing), and the PCO-ID song join (a renamed song item now finds its song, and so its copyright).
- The hymn lookup lists exact (case-insensitive) matches first and the normalized ones after, so a title that already matched keeps its default version.
- The `normalizeTitle` curly-quote bug was not on the original list: the quote character classes held straight quotes where curly ones were meant, so curly quotes were never straightened. Fixing it changes Unused Hymns: a curly/straight pair that used to land in the review bucket as a near-match now counts as used. The first fix wrote the literal characters again, so a follow-up wrote the classes as `\u` escapes, in the code and in the tests.
- A null song author no longer crashes `formatCopyrightText`; it reads as "Unknown".
- The PCO client is stricter than planned: it refuses redirects (a redirect would re-send the token), cancels unread error bodies, rejects percent-encoded paths and userinfo, and throws past `maxPages` instead of truncating. `fetchAllSongs` passes `maxPages: 100` (the library has 397 songs); the default is 50.

**Phase 2 UI**
- `LocalTime` uses `useSyncExternalStore`: React 19 keeps the server's text after a suppressed hydration mismatch, so a bare `suppressHydrationWarning` left the server's time zone on screen.
- `ErrorState` owns the retry (`router.refresh()` then `reset()`, in a transition); an `error.tsx` passes it `reset` and nothing else.
- `safeCallbackUrl` accepts printable ASCII only: a non-ASCII `callbackUrl` made `redirect()` return a 500, because Node refuses characters above U+00FF in the `Location` header.
- `aria-current` is "page" on a nav item's own page and "true" elsewhere in its section, so a plan page does not announce both its nav item and its breadcrumb as the current page.

**Phase 3 plan routes**
- Stretched-link rows carry `transform-gpu` as well as `relative`: older Safari ignores `relative` on `<tr>` (WebKit bug 240961), so the link's overlay would not be sized to the row.
- `CustomTextInput` also saves on blur, not only 500 ms after typing pauses, so a radio or Copy All clicked right after typing keeps the text. Because the box no longer remounts, a save that lands mid-typing must not overwrite what is still pending; that is handled too.

**Phase 4**
- Added `(overview)/error.tsx`. With `[planId]/error.tsx` alone, a failing tab replaced the whole plan page, header and items table included. Now the header, items table and tab nav stay, and `[planId]/error.tsx` keeps only errors in that layout and in item pages.
- The middleware matcher exempts only `auth/` and `api/auth/` as whole path segments. It used to exempt every path that merely started with those letters, such as `/authors`.

**Phase 5 Unused Hymns**
- The Refresh pending state is plain `useState`, not `useTransition`: a transition held open across the server action stalled every navigation until the action returned.
- The cache lives on `globalThis`. A client-imported server action is compiled in Next's "action-browser" layer, so the module-level cache was really two caches: Refresh updated one, and the page kept serving the other for up to an hour.
- A failed refresh keeps the cached data (`TtlCache.refresh` replaces the stored value only when the load succeeds), so page loads still work while Planning Center is down.

**Phase 6 cleanup**
- Deleted `HymnVersionSelector.tsx` (no commit ever imported it) and dropped `HymnVersion.selected` (only `matchHymns` set it, and only tests read it).
- Removed `NEXT_PUBLIC_BASE_URL` from `deploy.yml`. The GitHub secret and the `.env.local` line can now be deleted.
- `typecheck` clears `.next/types` before `next typegen`, which never deletes the types of removed routes; those leftovers broke typecheck three times during this work.
- Added `docs/architecture.md`, the README update and `CLAUDE.md`.

**Spike facts, confirmed while building**
- The largest plan has 17 items, so the 25-item truncation never showed on today's data.
- `sort_date`'s date part is the org-local date, even for an evening plan, so calendar dates are formatted from the `YYYY-MM-DD` part with UTC math and no org time zone is needed.
