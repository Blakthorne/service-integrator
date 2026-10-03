# Architecture

How Service Integrator is put together, and how to add to it. Read this before adding a feature, and follow its [conventions](#conventions) and [recipes](#recipes). The plan that produced this structure (decisions, Planning Center spike facts, implementation notes) is `docs/superpowers/plans/2026-10-03-multi-page-routing.md`.

## Overview

A Next.js 15 App Router app (React 19, strict TypeScript, Tailwind 4, Auth.js v5, Vitest) that reads Planning Center Online (PCO) Services data and generates song copyright text and service-schedule text. It runs as one long-running `next start` process under PM2, deployed by GitHub Actions on every push to `main`, so in-memory caches are per process and shared by all requests.

| URL | Page | Data |
|---|---|---|
| `/` | 307 redirect to `/plans` | none |
| `/plans` | every plan grouped by date, 25 dates a page (`?page=`) | `getPlansByDate()`, in the page |
| `/plans/{serviceTypeId}/{planId}` | one plan: header, items table, Copyright Information tab | `getPlanDetail()`, once, in the `[planId]` layout |
| `/plans/{st}/{plan}/schedule` | the plan's Service Schedule tab | the same data, through `usePlan()` |
| `/plans/{st}/{plan}/items/{itemId}` | one item's song details | the same data, through `usePlan()` |
| `/unused-hymns` | hymnbook entries never scheduled (`?book=`, `?sort=`, `?page=`) | `getUnusedHymns()`, in the page; Refresh is a server action |
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
  components/
    ui/                         shared chrome: PageHeader, Breadcrumbs, LoadingState, ErrorState, EmptyState,
                                CopyButton, LocalTime, Pagination
    Navigation.tsx              the top bar; Navigation/NavLinks.tsx renders NAV_ITEMS
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
- **`aria-current`.** A nav item gets `"page"` on its own page and `"true"` elsewhere in its section (`navAriaCurrent` in `lib/routes.ts`), so a plan page announces only its breadcrumb and tab as current.

## Data layer

```text
page / layout (server) ──► lib/queries ──► lib/pco ──► Planning Center
        │ serializable props
        ▼
client components (interaction only) ── URL state via useUrlState
```

**Server versus pure modules.**

- **Server-only** modules start with `import "server-only"`, so importing one into a client component fails the build: `lib/pco/*` (except `resources.ts`, which is types only, and the test helpers in `testing.ts`), `lib/queries/*`, and `lib/hymnCatalog.ts`, which wraps `hymns.json` so its ~150 KB never reaches a client bundle.
- **Pure** modules are safe on both sides and unit-tested: `lib/domain.ts` (types), `copyright.ts`, `serviceSchedule.ts`, `hymnMatch.ts`, `plansByDate.ts`, `format.ts`, `normalizeTitle.ts`, `unusedHymns.ts`, `scheduleSelections.ts`, `ttlCache.ts`, `routes.ts`, `urlState.ts` and `safeCallbackUrl.ts`. They take what they need as arguments (`matchHymns` gets its index, `buildScheduleCopyText` gets the plan's date string) and import nothing server-only.
- A client component may `import type` from a server module (the import is erased), never a value.

**`lib/pco/`: transport, mapping, getters.**

| File | What it does |
|---|---|
| `index.ts` | The barrel. Import `@/lib/pco`, never `@/lib/pco/<file>`: `vi.mock("@/lib/pco")` only applies to barrel imports. |
| `client.ts` | `pcoFetch(path, kind)`, `pcoFetchAll(path, kind, { maxPages })`, `PcoError(status, path)`, `PcoUrlError`, `pcoAuthHeaders()`. |
| `cachePolicy.ts` | `PCO_CACHE_POLICY`: the fetch options for each `PcoResourceKind` (`serviceTypes`, `plans`, `planItems`, `songs`). All `no-store` today. |
| `ids.ts` | `parsePcoId(raw)` returns a branded `PcoId` or `null` (`/^[1-9][0-9]{0,19}$/`); `assertPcoId` throws `InvalidPcoIdError`. |
| `resources.ts` | The raw JSON:API shapes as PCO sends them. Types only. |
| `mappers.ts` | `toServiceType`, `toPlan`, `toPlanItem`, `toSong` and `joinItemsToSongs`: raw resources to the domain types. |
| `serviceTypes.ts`, `plans.ts`, `planItems.ts`, `songs.ts` | The getters. |
| `next.ts` | `orNotFound(promise)`: a 404 `PcoError` or an invalid ID becomes `notFound()`; anything else is rethrown. Server pages and layouts only. |
| `testing.ts` | Test-only builders and fetch stubs. |

What `client.ts` guarantees:

- **Only the Services API is reachable.** `path` is relative to `/services/v2`. The URL is normalized, then must have the PCO origin, a `/services/v2/` path with no `%` in it, and no userinfo. The same check runs on every `links.next`, and requests use `redirect: "error"`, so the token never goes anywhere else. An ID from a URL is never interpolated unchecked: getters call `assertPcoId` first.
- **`pcoFetchAll` never truncates silently.** It follows `links.next` in order, appends each page's `data`, dedupes `included` by type and id, and throws when a page beyond `maxPages` exists (default 50 at `per_page=100`; plans use 20, songs 100). PCO's default page is 25 and its maximum is 100, so list paths ask for `per_page=100`.
- **Failures are cheap and clear.** A 429 is retried once, and only when `Retry-After` is whole seconds and at most 5. Unread error bodies are cancelled. Response headers are read only on failure, so test doubles can be a bare `{ ok, json }`.

Getters are wrapped in React `cache()` (calls with the same arguments are deduped within a request), take **primitive** arguments with no defaults (the cache key is argument identity), and call `assertPcoId` on every ID before building a path.

**`lib/queries/`: what pages import.**

- `plans.ts` has `getPlansByDate()` (`{ dates, plansByDate, failedServiceTypeIds }`: a service type whose plans fail to load is skipped, logged and reported, and the list shows a quiet warning), `getPlanDetail(st, plan)` (`{ plan, serviceType, items, hymns }`, loaded in parallel) and `getPlanLabels(st, plan)`, the cheap, never-throwing label lookup for `generateMetadata`.
- `unusedHymns.ts` has `getUnusedHymns({ refresh })`.

**Domain and hymns.**

- `lib/domain.ts` is the one home of `ServiceType`, `Plan`, `PlanSummary`, `Song` (nullable fields), `PlanItem`, `PlanItemWithSong`, `HymnVersion`, `HymnData` and `ScheduleSelection`. Raw PCO shapes stay in `lib/pco/resources.ts`.
- `joinItemsToSongs` gives a song item its song by the PCO song ID on the item, and falls back to an exact title match only when the item has no ID (or its song was not included), so an item renamed in the plan keeps its song.
- `buildHymnIndex(catalog)` groups the hymnbook catalog (`hymns.json`, through `lib/hymnCatalog.ts`) by `normalizeTitle`, and `matchHymns(index, titles)` lists, for each title, the records that match it exactly (ignoring case) first and the other normalized matches after, each in catalog order. It echoes the requested title.

**Where caching would be turned on.** Nothing is cached across requests today except two in-memory results. There are three levels:

- *Per request:* React `cache()` in the getters, already on.
- *HTTP, per PCO resource kind:* `PCO_CACHE_POLICY` in `lib/pco/cachePolicy.ts` is the single switch. Replace a kind's `{ cache: "no-store" }` with, for example, `{ next: { revalidate: 300 } }`. Under `force-dynamic` Next 15.5 forces `revalidate: 0` only onto fetches that name no cache option (`node_modules/next/dist/server/lib/patch-fetch.js`), so an explicit entry is honoured. Confirm it in a production build (`npm run build && npm start`) before relying on it, and remember the cache is shared by every user.
- *In process, for a computed result:* `createTtlCache` (`lib/ttlCache.ts`). `get(key, load)` serves a fresh value, shares one load between concurrent calls and never caches a failure. `refresh(key, load)` replaces the value only when the load succeeds. `invalidate` and `clear` drop entries. It backs `getPlanLabels` (5 minutes) and `getUnusedHymns` (1 hour). It is per process, so a multi-instance or serverless host has one cache per instance. A cache that a server action touches must live on `globalThis` (convention 15).

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

1 to 14 are the conventions the routing migration set; 15 and 16 are lessons learned during it.

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
13. **Prefetch.** Rows that link to data-heavy routes use `prefetch={false}`. In production `<Link>` prefetches the rows on screen, so 25 rows would each trigger a metadata lookup and PCO calls. All users share one PCO budget of 100 requests per 20 seconds. `PlanItemsTable` rows are the exception and prefetch on purpose: an item page reads the plan the `[planId]` layout already fetched, and its metadata only reads labels `getPlanLabels()` has cached.
14. **Error retry.** `ErrorState` owns the retry: pass it the boundary's `reset` and it runs `startTransition(() => { router.refresh(); reset(); })`. `reset()` alone re-renders with what the client already has, so a failed server render would not run again. Use `onRetry` for a failure outside a boundary. Client code never calls `notFound()`; it renders an inline `EmptyState`.
15. **Server actions.**
    - An action is a public POST endpoint. Call `auth()` and throw without a session, as `refreshUnusedHymns` does; the middleware alone is not enough.
    - **A module-level cache that an action touches must live on `globalThis`.** A client-imported action is compiled in Next's separate "action-browser" layer, so plain module state gets two instances: Refresh updated one while the page kept serving the other. See `sharedCache()` in `lib/queries/unusedHymns.ts`, whose test loads two copies of the module.
    - Track an action's pending state in `useState`, not `useTransition`. A transition held open across the action stalls every navigation until it returns.
    - A failed refresh keeps the previous data: `TtlCache.refresh` replaces the stored value only when the load succeeds.
16. **Non-ASCII in source.** Write non-ASCII characters in regex character classes and matching or normalization keys as `\u` escapes (`/[\u2018\u2019]/`), in tests too. Literal curly quotes were turned into straight quotes, and `normalizeTitle` silently stopped handling them while the test meant to cover it used straight quotes as well. Literal typographic characters in UI strings (·, ©, …) are fine.

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
- **Characterization tests.** Before moving or changing logic, pin what it does today, quirks included (an empty copyright gives "© ."). Move the logic with the tests green, then change behavior in its own commit, which flips exactly the assertions it changes. See `lib/copyright.test.ts`, `lib/serviceSchedule.test.ts` and `lib/hymnMatch.test.ts`.
- **The stubbed-fetch pattern** (`lib/pco/testing.ts`).
  - Call `stubPcoCredentials()` in `beforeEach`, and in `afterEach` call `vi.restoreAllMocks()`, `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()`.
  - `stubFetchRoutes({ [url]: body })` replaces global `fetch` with a table of full URLs, and a URL missing from the table fails the test. Each call returns a **fresh** `Response` (`json(body)`), because a body can be read only once.
  - `listPage(data, { next, included, total })` builds a paged JSON:API list, and `serviceTypeResource`, `planResource`, `itemResource` and `songResource` build raw resources. `calledUrls(fetchMock)` returns the URLs requested, in order.
  - Use fake timers for the 429 retry. Test a query module against the stubbed fetch, or mock the barrel with `vi.hoisted` plus `vi.mock("@/lib/pco", …)`; queries import only from the barrel, so the mock applies. For module-level caches, load a fresh copy per test with `vi.resetModules()` and `import(…)`.
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
