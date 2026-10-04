# Architecture

How Service Integrator is put together, and how to add to it. Read this before adding a feature, and follow its [conventions](#conventions) and [recipes](#recipes). The plan that produced this structure (decisions, Planning Center spike facts, implementation notes) is `docs/superpowers/plans/2026-10-03-multi-page-routing.md`; the song catalog plan, which adds the [database](#database), [writes to Planning Center](#writes-to-planning-center), songs' [credits](#credits) and [tags](#tags) and the plan [email](#email), is `docs/superpowers/plans/2026-10-04-song-catalog.md`.

## Overview

A Next.js 15 App Router app (React 19, strict TypeScript, Tailwind 4, Auth.js v5, Vitest) that reads Planning Center Online (PCO) Services data and generates song copyright text and service-schedule text. It runs as one long-running `next start` process under PM2, deployed by GitHub Actions on every push to `main`, so in-memory caches are per process and shared by all requests. It keeps its own data in a local SQLite file (see [Database](#database)), which that process opens at boot. The song catalog lives there (see [The song catalog](#the-song-catalog)): books, hymns, tunes, songs and their entries, seeded once from `hymns.json`. So does a mirror of the Planning Center song library, refreshed every hour, through which each catalog song links to the Planning Center song it is (see [Planning Center links](#planning-center-links)); plan pages take a song's numbers from that link. The Schedule tab's choices are saved there per plan, and so are the settings (see [Settings](#settings)) and a log of what the app writes to Planning Center and of the emails it sends. It writes to Planning Center only when someone asks: a hymnal note on each song item, which carries the song's numbers for the musicians (see [Hymnal notes](#hymnal-notes)); and, from a song's page, its credits (see [Credits](#credits)), a new song created from the catalog and a song added to an upcoming plan (see [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans)) and its tags (see [Tags](#tags)). A plan's header emails its songs to the staff (see [Email](#email)). The app opens on a dashboard (see [The dashboard](#the-dashboard)): each service type's next plan, with its songs' numbers and notes, and what needs doing.

| URL | Page | Data |
|---|---|---|
| `/` | the dashboard: each service type's next plan as a card, its song items with their numbers (or "Not in the catalog", linking to the Schedule tab) and hymnal-note status; then the to-dos, each linking to what fixes it | `getDashboard()`, in the page |
| `/plans` | every plan grouped by date, 25 dates a page (`?page=`) | `getPlansByDate()`, in the page |
| `/plans/{serviceTypeId}/{planId}` | one plan: header with Sync hymn notes (a preview, then the writes) and Email this plan (a preview, then the send), items table, Copyright Information tab | `getPlanDetail()`, once, in the `[planId]` layout; Sync hymn notes' and Email this plan's preview and write are server actions |
| `/plans/{st}/{plan}/schedule` | the plan's Service Schedule tab: a card per song with its numbers from its catalog link, or suggestions to link it, its hymnal note's status, and Numbers, Leave blank or Custom, each choice saved as it is made | the same data, through `usePlan()`; Link and each save are server actions |
| `/plans/{st}/{plan}/items/{itemId}` | one item's song details | the same data, through `usePlan()` |
| `/catalog` | every catalog song, searched, filtered by book, by Planning Center link, by use and by Planning Center tag, sorted and paged in the browser (`?q=`, `?book=`, `?linked=`, `?used=`, `?tag=`, `?sort=`, `?page=`), with Export CSV | `getCatalogSongs()`, `getCatalogBooks()`, `getSongTagGroups()` and `getTagIdsBySong()`, in the page; the CSV is made in the browser |
| `/catalog/songs/new` | the new-song form; `?pcoSongId=` prefills it from a Planning Center song and links that song, `?returnTo=` is where it goes back to | `getNewSongFormData()`, in the page; Add song is a server action |
| `/catalog/songs/{songId}` | one song: its entries, its hymn and its tune, with their other songs, and its Planning Center link, with Unlink and Add to a plan, or, for a song not linked, Create in Planning Center; for a linked song also its Credits and its Tags, each with an editor | `getCatalogSong()`, `getCatalogBooks()`, `getMirroredPcoSong()`, `getSettings()`, `getSongTagGroups()` and `getPcoSongTags()`, in the page, which makes no Planning Center request; Unlink is a server action, and the song page's other actions (Save credits, Save tags, Create in Planning Center, the upcoming plans and Add to plan) are called from clicks |
| `/catalog/tunes` | every tune with how many songs use it (`?q=`, `?page=`) | `getCatalogTunes()`, in the page |
| `/catalog/tunes/{tuneId}` | one tune and its songs | `getCatalogTune()`, in the page |
| `/catalog/books` | every book with its entry count | `getCatalogBooks()`, in the page |
| `/catalog/books/{bookCode}` | one book's entries in browse order, with Go to number | `getCatalogBook()`, in the page |
| `/catalog/import` | the import runs, and Preview seed from hymns.json | `getCatalogImportRuns()` and `getCatalogCounts()`, in the page; the preview is a server action |
| `/catalog/import/{runId}` | one run's report, with Apply and Discard, each confirmed in a dialog | `getCatalogImportRun()`, in the page; Apply and Discard are server actions |
| `/catalog/reconcile` | the Planning Center songs not in the catalog, each with its suggestions, a search over every catalog song, New catalog song and Ignore (`?q=` searches them); the recent auto-links, with Undo; the ignored songs; the last sync, with Sync now | `getReconcileData()`, in the page; every change is a server action |
| `/unused-hymns` | 308 redirect to `/catalog?used=never`, the songs never scheduled | none |
| `/settings` | the settings, a card and a form each: Copyright (the CCLI number), Credits (the credit roles and the phrase printed before each), Schedule text (each service type's header label, the number separator), Hymnal notes (the category's name, the tune, and whether each service type has the category) and Email (whether the server can send, the recipients, the subject); then the recent writes (to Planning Center, and the emails sent), the song sync with Sync now, and the database | the local database in the page (`getSettings()`, `getSettingsIssues()`, `getRecentWrites()`, `getDatabaseStatus()`, `getLastPcoSongsSync()`) and the server's environment (`getEmailStatus()`), and `getHymnNoteCategories()` from Planning Center, streamed into two cards; each Save and Sync now is a server action |
| `/auth/signin`, `/auth/error` | public sign-in pages | none |

### Request flow

```text
browser
  → middleware.ts           no session: 307 to /auth/signin?callbackUrl=<path+query>
  → app/layout.tsx          <html>, fonts, title template "%s · Service Integrator"
  → app/(app)/layout.tsx    force-dynamic · Navigation · <main> · footer
  → layouts and pages       server: parsePcoId / orNotFound → lib/queries → lib/pco → Planning Center
                            catalog: parseCatalogId / parseBookCode → lib/queries → lib/db → SQLite
  → serializable props      client components (interaction only)
```

- **Auth.** `auth.ts` sets up Auth.js with Google; only the addresses in `ALLOWED_EMAIL_1..3` may sign in. `middleware.ts` requires a session for every path except `/auth/…`, `/api/auth/…`, Next's static assets and `favicon.ico`. The exemptions are whole path segments, so `/authors` is still protected. The only API route is `app/api/auth/[...nextauth]/route.ts`.
- **Deep links survive sign-in.** The middleware passes the requested path and query as `?callbackUrl=`, and the sign-in page redirects there through `signInTarget()` (`lib/safeCallbackUrl.ts`), which keeps it when `safeCallbackUrl()` accepts it and otherwise goes to the dashboard at `/`. `safeCallbackUrl()` accepts only a path with a single leading slash and printable ASCII after it (a non-ASCII character made `redirect()` fail with a 500), and only one that stays a path on this site once a browser resolves it: Next's router resolves a redirect against the page's URL, which removes dot segments, so `/.//evil.example` or `/a/..//evil.example` would become the protocol-relative `//evil.example`. So it resolves the value against a dummy origin and refuses it unless it keeps that origin and its resolved path does not start with `//`. It also refuses a backslash anywhere (the URL parser reads one as a slash) and a percent-encoded dot, slash or backslash in the path (the parser reads `%2E` as a dot; a router that decodes the path would make the others separators); in the query they stay, so `?returnTo=%2Fcatalog` works. It never accepts an auth page (`/auth` and everything under it, also when dot segments lead there): the middleware leaves those public, so redirecting a signed-in visitor there would loop. A path that merely starts with those letters, such as `/authors`, is protected like any other page and is accepted; a test reads the middleware's matcher to keep the two in step. The new-song form's `returnTo` goes through it too.
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
    (home)/page.tsx · loading.tsx
                                the dashboard at /: getDashboard() → PageHeader + DashboardView; in a route group
                                so that its loading.tsx covers / alone
    plans/
      (list)/page.tsx           server: getPlansByDate() → PageHeader + <Suspense><PlansList/></Suspense>
      (list)/loading.tsx        the list skeleton; in a route group so it does not also wrap the plan routes
      [serviceTypeId]/
        loading.tsx             ┐
        error.tsx               ├ cover the [planId] LAYOUT's fetch and notFound(), so they sit one level up
        not-found.tsx           ┘
        [planId]/
          layout.tsx            server: parsePcoId → getPlanDetail → <PlanProvider>; generateMetadata via getPlanLabels
          actions.ts            "use server": linkPcoSong (the Schedule tab's one-click Link), saveScheduleSelection
                                (each choice), previewHymnNotesAction and syncHymnNotesAction (Sync hymn notes;
                                the sync gets the preview back, parsed by lib/previewedHymnNotes.ts),
                                previewPlanEmailAction and sendPlanEmailAction (Email this plan)
          error.tsx             errors in the (overview) layout and in item pages, below the provider
          (overview)/
            layout.tsx          PlanHeader + PlanItemsTable + PlanTabNav, with the active tab below
            error.tsx           a failing tab: the header, items table and tab nav stay on screen
            page.tsx            Copyright Information tab (the default)
            schedule/page.tsx   Service Schedule tab; metadata.title "Schedule"
          items/[itemId]/
            page.tsx            server: parsePcoId → notFound(); the client PlanItemDetail reads the provider
            not-found.tsx
    catalog/
      layout.tsx                CatalogSectionNav (Songs · Tunes · Books · Reconcile · Import) above every catalog
                                page; fetches nothing, and leaves the width to each page
      (list)/page.tsx · loading.tsx
                                the songs list at /catalog: getCatalogSongs() → <Suspense><CatalogSongsView/></Suspense>
      songs/new/                page.tsx (parsePcoId, safeCallbackUrl → getNewSongFormData → SongForm)
                                · actions.ts ("use server": createSongAction)
      songs/[songId]/
        page.tsx                parseCatalogId → getCatalogSong, getMirroredPcoSong, getSettings, getSongTagGroups,
                                getPcoSongTags → SongDetailView; metadata via getCatalogSongLabel
        actions.ts              "use server": saveSongCreditsAction, saveSongTagsAction, createInPlanningCenterAction,
                                listUpcomingPlansAction, addSongToPlanAction: the song page's writes to Planning
                                Center, each called from a click
        not-found.tsx
      tunes/(list)/page.tsx · loading.tsx
                                getCatalogTunes() → <Suspense><CatalogTunesView/></Suspense>
      tunes/[tuneId]/           page.tsx (parseCatalogId → getCatalogTune) · not-found.tsx
      books/(list)/page.tsx · loading.tsx
                                getCatalogBooks() → BooksList
      books/[bookCode]/         page.tsx (parseBookCode → getCatalogBook → BookEntriesTable, GoToNumber)
                                · not-found.tsx
      import/(list)/page.tsx · loading.tsx
                                the runs (ImportRunsList) and PreviewSeedForm
      import/[runId]/           page.tsx (parseCatalogId → getCatalogImportRun → SeedReport, ImportRunActions)
                                · not-found.tsx
      import/actions.ts         "use server": previewSeedImportAction, applyImportAction, discardImportAction,
                                each checking the session
      reconcile/                page.tsx · loading.tsx: getReconcileData() → ReconcileView, RecentAutoLinks,
                                IgnoredSongs. actions.ts ("use server"): linkSongAction, undoAutoLinkAction,
                                ignorePcoSongAction, unignorePcoSongAction and the song page's unlinkSongAction:
                                every change to a link made from a catalog page
    unused-hymns/page.tsx       permanentRedirect (308) to routes.catalogFiltered({ used: "never" })
    settings/
      page.tsx                  server: the settings, their issues, the recent writes, the sync, the database and
                                whether email is set up (local and quick), and getHymnNoteCategories() under a 5 s
                                deadline → SettingsIssuesCard, CopyrightCard, CreditsCard, ScheduleTextCard (in
                                Suspense), HymnalNotesCard, EmailCard, RecentWritesCard, PcoSyncCard, DatabaseCard.
                                No loading or error file: no query throws, and the Planning Center parts stream in
      actions.ts                "use server": saveCopyrightAction, saveCreditsAction, saveScheduleTextAction,
                                saveHymnalNotesAction, saveEmailAction (each form's Save, called from its onSubmit);
                                syncPcoSongsAction, Sync now (Settings and Reconcile)
  components/
    ui/                         shared chrome: PageHeader, Breadcrumbs, LoadingState, ErrorState, EmptyState,
                                CopyButton, LocalTime, Pagination, Segmented, Dialog, SubmitButton
    Navigation.tsx              the top bar; Navigation/NavHomeLink.tsx is the link to the dashboard (the app's
                                name, a house below md), NavLinks.tsx renders NAV_ITEMS and NavUtilityLinks.tsx the
                                icon links beside Sign Out (NAV_UTILITY_ITEMS); NavIcon.tsx draws the icons, and
                                classes.ts holds the classes they share
    Dashboard/                  DashboardView; NextPlanCard, a service type's next plan, with PlanSongs, its song
                                rows; TodoList; styles.ts
    Settings/                   SettingsIssuesCard; CopyrightCard, CreditsCard, ScheduleTextCard, HymnalNotesCard and
                                EmailCard, each with its form (CopyrightForm, CreditsForm, ScheduleTextForm,
                                HymnalNotesForm, EmailForm, and HymnalCategoryStatus); EmailSetupNotice, which the
                                plan's Email dialog shows too; RecentWritesCard; PcoSyncCard and DatabaseCard; what
                                the forms share (SettingsCard, SettingsFields, SaveButton, useSettingsForm);
                                SyncRunStatus and SyncNowButton, which Reconcile shows too
    Plans/PlansList.tsx         the paged list of plans
    PlanItems/                  PlanProvider (+ usePlan), PlanHeader with SyncHymnNotesAction and EmailSummaryAction
                                (the two dialogs share PlanDialogParts), PlanItemsTable, PlanTabNav, PlanItemDetail,
                                PlanNotice (a tab's banner), the tab connectors (CopyrightTab, ScheduleTab) and their
                                views; the Schedule tab's ScheduleSongCard, EntryNumbers, LinkToCatalogInline and
                                ScheduleChoices
    Catalog/                    CatalogSectionNav, and what the catalog pages share: CatalogCard, EntryLabels,
                                SearchBox, OptionPicker
      Songs/                    CatalogSongsView, CatalogSongsControls (with the tag filter), SongsTable (a tune's
                                page uses it too), downloadCsv
      Song/                     SongDetailView and its cards: EntriesCard, HymnCard, TuneCard, RelatedSongs,
                                PcoLinkCard (with AddToPlanAction and CreatePcoSongForm), CreditsCard (with
                                CreditNamesEditor and CreditsPreviewBox) and TagsCard; PendingButton and styles.ts,
                                which the cards that write to Planning Center share
      SongForm/                 SongForm and its parts: PcoSongNotice, HymnFields, TuneFields, EntryFields,
                                ChoiceFromList, Fields
      Reconcile/                ReconcileView, UnlinkedSongRow, SongPicker, LinkForm, RecentAutoLinks, IgnoredSongs,
                                RowNoticeText, useRowNotice, PcoSongWebLink
      Tunes/                    CatalogTunesView, TunesTable, TuneDetailsCard
      Books/                    BooksList, BookEntriesTable, GoToNumber
      Import/                   PreviewSeedForm, ImportRunsList, SeedReport, ImportRunActions, ImportNotice,
                                ImportStatusBadge
    SongDetails.tsx, SongCopyright.tsx
  hooks/useUrlState.ts
```

### Why the boundaries sit where they do

- **One level above a layout that fetches.** A segment's own `loading.tsx`, `error.tsx` and `not-found.tsx` render *inside* its `layout.tsx`, so they never cover that layout. The `[planId]` layout fetches (`getPlanDetail`) and can call `notFound()`, so its boundaries live in `[serviceTypeId]/`. This was checked against the installed Next 15.5.9 source.
- **Below the stateful provider.** `PlanProvider` is rendered by the `[planId]` layout, and `[planId]/error.tsx` and `(overview)/error.tsx` render inside it. An error in a tab or item page therefore never unmounts the provider, and the Schedule selections survive "Try again". Never put an error boundary above a provider whose state must survive.
- **Route groups scope files.**
  - `(home)` holds the dashboard, so its `loading.tsx` covers `/` alone: in `app/(app)/` it would wrap every page.
  - `(list)` keeps the list's `loading.tsx` from also wrapping `[serviceTypeId]/…`.
  - `(overview)` gives the header, items table and tab nav to the two tabs and not to the item pages beside them. It also makes `PlanTabNav` work: `useSelectedLayoutSegment()` returns `null` or `"schedule"` in `(overview)/layout.tsx`, but `"(overview)"` one level up, so that layout has to render the nav.
  - `(overview)/error.tsx` is a boundary *inside* that layout, so a failing tab leaves the header and tab nav on screen; errors in the layout itself fall through to `[planId]/error.tsx`.
  - The catalog's lists sit in `(list)` groups as well: `catalog/(list)/`, `tunes/(list)/`, `books/(list)/` and `import/(list)/`. A `loading.tsx` wraps everything below its folder, so without them the songs list's loading state would also cover every song, tune, book and import page. Those pages read only the local database and have no `loading.tsx`, so a link to one keeps the previous page on screen until it is ready (about 100 ms in a production build) instead of flashing a spinner. The new-song form has none either: it reads the database, and Planning Center only for a song the mirror lacks. Reconcile has its own `loading.tsx` beside its page (nothing is below it, so it needs no group): it builds every unlinked song's suggestions.
  - Because of `catalog/(list)/`, `useSelectedLayoutSegment()` in the catalog layout returns `"(list)"` at `/catalog`, not null. `CatalogSectionNav` finds its section with `catalogSectionFor(catalogLayoutSegment(useSelectedLayoutSegments()))`; `catalogLayoutSegment` (`lib/catalog/sections.ts`) skips route groups.
- **A local page that needs Planning Center for a part of it streams that part.** Settings reads the database, which is quick and never throws, so the page is on screen at once with no `loading.tsx`. The service types and their item note categories come from Planning Center: the page starts that read before it renders (`getHymnNoteCategories()`, which never rejects), and the two cards that need it wait under their own Suspense boundaries. The wait has a deadline, `PCO_WAIT_MS` (5 s, through `withDeadline` in `lib/deadline.ts`), because a navigation away waits for the page's open response, and a Planning Center that hangs could hold it for its 15 s timeout per read. Past the deadline the cards say that Planning Center did not answer.
- **The catalog layout fetches nothing**, so each catalog page's `not-found.tsx` sits beside its page and a 404 renders under the section nav. A catalog read that throws (a database that cannot be opened) falls through to `app/(app)/error.tsx`.
- **Layouts do not re-run on `<Link>` navigation.** The server renders only the segments that change, so switching tabs, or opening an item and coming back, never repeats the `[planId]` layout's PCO fetch. Another plan remounts `PlanProvider` (its key includes the plan). `router.refresh()` does re-run the layout.
- **Two kinds of "item not found".** An item ID that is not a PCO ID ends in the server's `notFound()`, caught by `items/[itemId]/not-found.tsx`. A valid ID that is not in this plan renders an inline `EmptyState` from the client `PlanItemDetail`, because client code never calls `notFound()`.
- **List rows.** A row's title is a real `<Link>` stretched over the row (`after:absolute after:inset-0` on the link; `relative transform-gpu` on the `<tr>`, since older Safari ignores `relative` on table rows), so rows work from the keyboard and with cmd-click.
- **`aria-current`.** A nav item gets `"page"` on its own page and `"true"` elsewhere in its section (`navAriaCurrent` in `lib/routes.ts`), so a plan page announces only its breadcrumb and tab as current. The icon links beside Sign Out (`NAV_UTILITY_ITEMS`, the Settings gear) use the same function, and are named by their `aria-label`. So does the link to the dashboard (`NAV_HOME_ITEM`), which is "page" on `/` alone; the Plans item claims only `/plans` and the pages below it. The catalog's section nav follows the same rule: "page" on a section's own list, "true" on a page inside it (a song's page is in Songs).

### Shared UI

Beyond the page chrome (`PageHeader`, `Breadcrumbs`, `LoadingState`, `ErrorState`, `EmptyState`, `Pagination`), `app/components/ui/` has:

- `Segmented`: a row of toggle buttons (`aria-pressed`) in a labelled group, exactly one chosen, for a filter or a sort order (the songs list's book filter and sort). An option may show a short label with its full name as `title`. `describedBy` names the id of text about the choice, such as a form's error about it, which every button is then described by. On a phone, a row too wide for its container scrolls sideways.
- `Dialog`: a modal on the browser's own `<dialog>` (`showModal()`), for confirming an action (Apply, Discard, Sync hymn notes' Confirm, Email this plan's Send, the song page's Add to a plan and Create in Planning Center). It is controlled through `open` and `onClose`. The browser makes the page behind it inert and closes it on Escape; focus starts on its close button and returns to `returnFocusRef`, the button that opened it. Its content stays rendered while it is closed, so a form inside keeps its state.
  - **`onClose` comes once the dialog has closed, however it closed**: Escape, its close button (which closes the `<dialog>` itself), or `open` going false. The parent must always set `open` to false there; left true, `open` would say the dialog is showing when it is not.
  - `dismissible={false}` stops Escape and hides the close button while an action runs, but it stops only a stray key press: Chromium's close watcher closes the dialog on the third Escape. Such a close calls `onClose` like any other, so a parent that must show what the action brings back opens the dialog again when it comes, as the sync dialog, the email dialog and Add to a plan do.
- `buttonClasses(variant, pending)`: the classes of every solid button, the one place their look comes from. `SubmitButton` uses it, and so do the buttons that keep their pending state in `useState`: Settings' `SaveButton` and Sync now, and the sync and email dialogs'. A test pins every variant. The song page's Planning Center cards keep their own looks (the same colours, and the boxes that say how an action went) in `Song/styles.ts`.
- `SubmitButton`: the submit button of a form whose `action` is a function, which suits only an action that takes milliseconds, such as a write to the local database (convention 15). It reads `useFormStatus`, so render it inside its form. While the action runs it shows its pending label and is `aria-disabled` rather than `disabled`, so a keyboard user keeps focus when the action comes back with a refusal. `variant` is "primary" (the default), "danger" (Discard, Unlink) or "secondary", a quieter button for an action that should not draw the eye (Reconcile's Ignore, beside Choose another song and New catalog song, and its Undo and Unignore).

The catalog's pages share four pieces in `app/components/Catalog/`:

- `CatalogCard`: a titled card for a detail page, `flush` when its body is a table, with `CardField` for its labelled values.
- `EntryLabels`: a song's entry labels, each with its variant note beside it.
- `SearchBox`: the search field of a list whose search lives in the URL. It shows what is typed at once, from local state, because `useUrlState`'s writes reach `useSearchParams()` in a transition and an input fed straight from the URL drops keystrokes. When the URL's search changes without typing (Back, a link to the bare list), it shows the URL's.
- `OptionPicker`: a search field over a long list of options with the best few matches under it (`lib/catalog/pickers.ts` searches and ranks them in the browser), and a line, read out as it changes, that says how many match. Each match's row is what the caller renders: a button that chooses it (the new-song form's hymn and tune, through `SongForm/ChoiceFromList`) or a Link form (Reconcile's "Choose another song"). Enter never submits the form around it.

**The top bar at 320 px.** Below `sm` the bar must hold the link to the dashboard, the section links (Plans · Catalog), the gear and Sign Out in a 320 px phone: it uses `<main>`'s narrow gutter and the links have less padding. The app's name appears only from `md`, where there is room for it; below `md` a house icon stands in for it, named "Dashboard" by its `aria-label` and filled on `/` like a current section (`NavHomeLink`). Only one of the two is displayed at any width, so the other is out of the tab order. Every link of the bar shows keyboard focus as a 2 px outline 2 px outside it (`NAV_FOCUS_CLASS` in `Navigation/classes.ts`): the browser's own ring, drawn on the link's edge, all but vanished against a current link's blue fill.

## Data layer

```text
page / layout (server) ──► lib/queries ──┬─► lib/pco ──► Planning Center
        │ serializable props             └─► lib/db  ──► SQLite (DATABASE_PATH)
        ▼
client components (interaction only) ── URL state via useUrlState
```

**Server versus pure modules.**

- **Server-only** modules start with `import "server-only"`, so importing one into a client component fails the build: `lib/pco/*` (except `resources.ts`, which is types only, and the test helpers in `testing.ts`), `lib/queries/*`, `lib/db/*` (except the SQL text in `migrations/`, `errors.ts` and the test helper `testing.ts`), `lib/jobs.ts`, `lib/boot.ts`, `lib/email.ts` (it loads Nodemailer and reads the environment), `lib/previewedHymnNotes.ts` (it parses ids with `parsePcoId`), and `lib/import/hymnsJsonFile.ts`, the only module that imports `hymns.json` (for the seed import), so its ~150 KB never reaches a client bundle.
- **Pure** modules are safe on both sides and unit-tested: `lib/domain.ts` (types), `copyright.ts`, `credits.ts`, `creditRows.ts`, `serviceSchedule.ts`, `scheduleSelections.ts`, `scheduleSelectionsStore.ts`, `scheduleCards.ts`, `hymnNotes.ts`, `hymnNoteText.ts`, `planEmail.ts`, `planEmailText.ts`, `settings.ts`, `settingsForms.ts`, `settingsText.ts`, `writeLogText.ts`, `dashboard.ts`, `reconcile.ts`, `fuzzy.ts`, `forms.ts`, `csv.ts`, `plansByDate.ts`, `planLabel.ts`, `format.ts`, `normalizeTitle.ts`, `ttlCache.ts`, `debouncedSave.ts`, `deadline.ts`, `routes.ts`, `urlState.ts` and `safeCallbackUrl.ts`, and every module in `lib/catalog/` and `lib/import/` but `hymnsJsonFile.ts` (see [The song catalog](#the-song-catalog)). They take what they need as arguments (`suggestLinks` gets its catalog index, `buildScheduleCopyText` gets the plan's date string and the settings it follows, `diffHymnNotes` gets the notes the app wrote, `buildPlanEmail` gets a plan's detail and the subject template, `planHymnsJsonImport` gets the records of `hymns.json`) and import nothing server-only; a type may come from a server module (`import type`).
- A client component may `import type` from a server module (the import is erased), never a value.

**`lib/pco/`: transport, mapping, getters.**

| File | What it does |
|---|---|
| `index.ts` | The barrel. Import `@/lib/pco`, never `@/lib/pco/<file>`: `vi.mock("@/lib/pco")` only applies to barrel imports. It exports the writes of `writes.ts`, which `lib/queries` call, but leaves out the write plumbing (`pcoMutate`, `jsonApi`, `toOne`, `toMany`), because only `lib/pco` writes to PCO. |
| `client.ts` | `pcoFetch(path, kind, { paced })`, `pcoFetchAll(path, kind, { maxPages, paced })`, `pcoMutate(method, path, body, { paced })`, `jsonApi`, `toOne`, `toMany`, `PcoError(status, path)`, `PcoValidationError`, `PcoUrlError`, `pcoAuthHeaders()`. |
| `pacer.ts` | `pcoPacer()`: the process-wide pacer that paced requests wait on and that every response teaches PCO's current rate limit. `createPacer({ now, sleep })` builds one for tests. |
| `cachePolicy.ts` | `PCO_CACHE_POLICY`: the fetch options for each `PcoResourceKind` (`serviceTypes`, `plans`, `planItems`, `itemNoteCategories`, `songs`, `arrangements`, `tags`). All `no-store` today. |
| `ids.ts` | `parsePcoId(raw)` returns a branded `PcoId` or `null` (`/^[1-9][0-9]{0,19}$/`); `assertPcoId` throws `InvalidPcoIdError`. |
| `resources.ts` | The raw JSON:API shapes as PCO sends them. Types only. |
| `mappers.ts` | `toServiceType`, `toPlan`, `toPlanItem`, `toSong`, `toItemNote`, `toItemNoteCategory`, `joinItemsToSongs` and `itemNotesByItem` (each item's notes from `included`), `toSongArrangement`, `toPcoTag` and `toPcoTagGroups` (each group's tags from `included`): raw resources to the domain types. |
| `serviceTypes.ts`, `plans.ts`, `planItems.ts`, `songs.ts` | The getters. `plans.ts` has `getNextPlan(st)`, the earliest plan PCO counts as future (`filter=future`, which keeps all of today's plans until midnight, so on a Sunday the dashboard shows that day's services) and `getUpcomingPlans(st)`, every plan PCO counts as future, earliest first (the plans Add to a plan offers). `planItems.ts` reads a plan's items with their songs and notes (`include=song,item_notes`): `getPlanItems` is deduped within a request, and `fetchPlanItems` reads afresh, for refresh-before-write; `getItemNoteCategories(st)` gives a service type's item note categories. `songs.ts` has `fetchSongLibrary()`, the whole library for the song sync (paced, never cached, and refused when it got fewer songs than PCO counted), `fetchSong(id)`, one song read afresh, for a write that starts from what PCO has now, `getSong(id)`, its `cache()`d twin, for a link made before the sync has it, and `getSongArrangements(id)`, a song's arrangements. |
| `tags.ts` | The song tag reads, none in `cache()` (the tags job runs outside any request, and a write starts from what PCO has now), each with a `paced` option: `fetchSongTagGroups()` (the groups for songs, with their tags), `fetchSongIdsWithTag(tagId)` (every song with a tag, asked only about an id from a fresh group read) and `fetchSongTags(songId)`. See [Tags](#tags). |
| `writes.ts` | The only module that writes to PCO: `createItemNote`, `updateItemNote` (its content only: a note's category can never change) and `deleteItemNote`; `createSong` (never with a CCLI number: see [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans)) and `updateSong` (a PATCH without `data.id`); `createSongItem` (a song item with its title and arrangement, appended to the plan); and `assignSongTags` (which replaces all of a song's tags). See [Writes to Planning Center](#writes-to-planning-center). |
| `next.ts` | `orNotFound(promise)`: a 404 `PcoError` or an invalid ID becomes `notFound()`; anything else is rethrown. Server pages and layouts only. |
| `testing.ts` | Test-only builders (`itemNoteResource`, `itemNoteCategoryResource`, `noteLinks`, `tagGroupResource`, `tagResource` and `arrangementResource` among them), fetch stubs keyed by URL or `"METHOD url"`, `calledUrls`, `calledRequests` and `stubPcoPacer`. |

What `client.ts` guarantees:

- **Only the Services API is reachable.** `path` is relative to `/services/v2`. The URL is normalized, then must have the PCO origin, a `/services/v2/` path with no `%` in it, and no userinfo. The same check runs on every `links.next`, and requests use `redirect: "error"`, so the token never goes anywhere else. An ID from a URL is never interpolated unchecked: getters call `assertPcoId` first.
- **`pcoFetchAll` never truncates silently.** It follows `links.next` in order, appends each page's `data`, dedupes `included` by type and id, and throws when a page beyond `maxPages` exists (default 50 at `per_page=100`; plans use 20, songs 100). PCO's default page is 25 and its maximum is 100, so list paths ask for `per_page=100`.
- **Failures are cheap and clear.** An unpaced 429 is retried once, and only when `Retry-After` is whole seconds and at most 5; paced requests wait longer (see [Writes to Planning Center](#writes-to-planning-center)). A 422 is a `PcoValidationError`, whose body is read for PCO's reasons; every other error body is cancelled unread. Headers are read with optional chaining (every response's rate-limit headers go to the pacer), so test doubles can still be a bare `{ ok, json }`.

Getters are wrapped in React `cache()` (calls with the same arguments are deduped within a request), take **primitive** arguments with no defaults (the cache key is argument identity), and call `assertPcoId` on every ID before building a path.

**`lib/queries/`: what pages import.**

- `plans.ts` has `getPlansByDate()` (`{ dates, plansByDate, failedServiceTypeIds }`: a service type whose plans fail to load is skipped, logged and reported, and the list shows a quiet warning), `getPlanDetail(st, plan)` (`{ plan, serviceType, items, catalog, suggestions, catalogError, selections, selectionsError, scheduleSettings, settingsError, hymnNoteStatus }`: the plan, service type, items with their notes and the item note categories loaded in parallel, then their songs' catalog links (see [Planning Center links](#planning-center-links)), the saved choices (see [State](#state)), the settings the plan's text follows (`planTextSettings`: the header label, the separator, the CCLI number and the credit roles and phrases) and each song item's hymnal note against the category (see [Hymnal notes](#hymnal-notes)); each part that cannot be read leaves the plan's pages working, with the reason) and `getPlanLabels(st, plan)`, the cheap, never-throwing label lookup for `generateMetadata`, which reads only Planning Center.
- `system.ts` has `getDatabaseStatus()`: `{ ok: true, path, appliedMigrations, latestMigration, lastBackup, backupDir }`, or `{ ok: false, error }` (logged). It never throws, so Settings shows a broken database instead of failing. `getLastPcoSongsSync()` gives the song sync's latest run the same way: `{ ok: true, lastRun }`, or `{ ok: false }` (logged).
- `catalog.ts` has the catalog's reads, all synchronous like the database: `getCatalogSongs()`, `getCatalogSong(id)`, `getCatalogTunes()`, `getCatalogTune(id)`, `getCatalogBooks()`, `getCatalogBook(code)` and `getCatalogCounts()`. A detail read takes an ID or code its parser already checked (convention 19) and returns null when there is no such row, for the page's `notFound()`. Any read throws when the database cannot be opened, for the error boundary. `getCatalogSongLabel`, `getCatalogTuneLabel` and `getCatalogBookLabel` are the never-throwing labels for `generateMetadata` (convention 12): built on `labelOr`, they take the raw param, parse it themselves and fall back to "Song", "Tune" or "Book".
- `catalogImport.ts` has the seed import's: `previewSeedImport()`, `getCatalogImportRuns()`, `getCatalogImportRun(id)` (the run, and why Apply would be refused now), `applyCatalogImport(id)` and `discardCatalogImport(id)`, which return a refusal for the form rather than throw, and `getCatalogImportRunLabel`.
- `sync.ts` has `syncPcoSongs(db)`, the work of the song sync (which derives every song's credits too), and `describePcoSongsSync(counts)`, its run's message.
- `reconcile.ts` has linking from the app's pages: `getReconcileData()`, `mirrorPcoSong(id)`, `linkCatalogSong(songId, pcoSongId)`, `undoAutoLink`, `ignorePcoSong`, `unignorePcoSong` and `syncPcoSongsNow()`.
- `catalogEdit.ts` has the catalog's forms: `getNewSongFormData(pcoSongId)`, `getNewSongBooks()`, `createSong(input)`, and for the song page `getMirroredPcoSong(id)` and `unlinkCatalogSong(songId, pcoSongId)`.
- `selections.ts` has the Schedule tab's saved choices: `saveScheduleSelection(planId, itemId, option, customText)`, which checks every argument and returns a refusal as a value, and `getScheduleSelections(planId)`.
- `settings.ts` has `getSettings()` and `getSettingsIssues()`, which never throw, `saveSettings(values)` and `getRecentWrites()` (see [Settings](#settings)).
- `hymnNotes.ts` has `previewHymnNotes(st, plan)`, `syncHymnNotes(st, plan, previewed)` and, for Settings, `getHymnNoteCategories()` (see [Hymnal notes](#hymnal-notes)).
- `dashboard.ts` has `getDashboard()`, which never throws (see [The dashboard](#the-dashboard)).
- `credits.ts` has `rederiveAllCredits()`: every mirrored song's credits read again, after the credit roles change (see [Credits](#credits)).
- `pcoSongs.ts` has the song page's writes to Planning Center: `saveSongCredits`, `createSongInPlanningCenter`, `listUpcomingPlans`, `addSongToPlan` and `saveSongTags`, and `pcoSongTitleFor`, the title a catalog song gets in Planning Center (see [Credits](#credits), [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans) and [Tags](#tags)).
- `tags.ts` has `syncTags(db)`, the work of the tags job, and the mirror's reads, which are synchronous like the database's: `getSongTagGroups()`, `getTagIdsBySong()` and `getPcoSongTags(id)`.
- `email.ts` has `previewPlanEmail(st, plan)`, `sendPlanEmail(st, plan, expected)` and, for Settings, `getEmailStatus()` (see [Email](#email)).

**Domain and links.**

- `lib/domain.ts` is the one home of `ServiceType`, `Plan`, `PlanSummary`, `Song` (nullable fields), `PlanItem`, `ItemNote`, `ItemNoteCategory`, `PlanItemWithSong` (an item with its song and its notes) and `ScheduleSelection`, of the catalog's types (under "Catalog"), and of the links' (under "Planning Center links": `PcoLibrarySong`, `MirroredPcoSong`, `LinkReason`, `CatalogMatch`, `LinkSuggestion`, `UnlinkedPcoSong`, `AutoLinkedSong`, `CatalogSongOption`), of songs' credits (under "Credits": `Credit`, `SongCredits`, `CreditParseStatus`) and of the song tags (under "Song tags": `PcoTagGroup`, `PcoTag`), and `SongArrangement`. Raw PCO shapes stay in `lib/pco/resources.ts`. A form's own types live beside its validators (`lib/catalog/validation.ts`) and a picker's beside its search (`lib/catalog/pickers.ts`).
- `joinItemsToSongs` gives a song item its song by the PCO song ID on the item, and falls back to an exact title match only when the item has no ID (or its song was not included), so an item renamed in the plan keeps its song. Its numbers then come from that song's catalog link, never from the item's title.

**Where caching would be turned on.** Nothing is cached across requests today except one in-memory result. There are three levels:

- *Per request:* React `cache()` in the getters, already on.
- *HTTP, per PCO resource kind:* `PCO_CACHE_POLICY` in `lib/pco/cachePolicy.ts` is the single switch. Replace a kind's `{ cache: "no-store" }` with, for example, `{ next: { revalidate: 300 } }`. Under `force-dynamic` Next 15.5 forces `revalidate: 0` only onto fetches that name no cache option (`node_modules/next/dist/server/lib/patch-fetch.js`), so an explicit entry is honoured. Confirm it in a production build (`npm run build && npm start`) before relying on it, and remember the cache is shared by every user.
- *In process, for a computed result:* `createTtlCache` (`lib/ttlCache.ts`). `get(key, load)` serves a fresh value, shares one load between concurrent calls and never caches a failure. `refresh(key, load)` replaces the value only when the load succeeds. `invalidate` and `clear` drop entries. It backs `getPlanLabels` (5 minutes). It is per process, so a multi-instance or serverless host has one cache per instance. A cache that a server action touches must live on `globalThis` (convention 15).

### The song catalog

The app's own hymnal index, in the database (migration `0002_catalog`). A **hymn** is the words and a **tune** the melody. A **song** is one hymn to one tune, the unit a Planning Center song links to (see [Planning Center links](#planning-center-links)). An **entry** places a song in a **book**: by number (`R-396`), by position in an unnumbered book, or at a location (`G-Front Cover`), with an optional variant note ("Descant - last stanza only") shown beside its label, never in it. Hymns and tunes keep their other spellings as aliases. The types are in `lib/domain.ts`, under "Catalog".

```text
lib/catalog/              pure and tested, safe on both sides
  ids.ts                  parseCatalogId, parseBookCode (convention 19)
  labels.ts               formatEntryLabel: "R-396", "G-Front Cover", an unnumbered book's short name
  normalize.ts            normalizeTuneName, the key tunes and their aliases are matched by
  filter.ts               the songs list: read its view from the URL; search, filter by book, link, use and
                          tag (parseCatalogTag); sort; page. foldForSearch, the folding every catalog search uses
  songsCsv.ts             the songs list as CSV: its records and columns, and the file's name
  lastScheduled.ts        a song's last scheduled date, from the date part of PCO's value
  tuneFilter.ts           the tunes list: search and page, and the trimmed row the browser gets
  entryNotes.ts           the notes beside a label, never repeating a location the label already says
  counts.ts               "1,247", "921 songs", "12 of 921 songs"
  sections.ts             catalogLayoutSegment, which tells the section nav where it is
  bookText.ts             the books pages' words, and the row ids that Go to number scrolls to
  importText.ts           the import pages' words
  validation.ts           the new-song form: its fields, validateNewSong, draftFromPcoTitle, previewEntryLabel
  pickers.ts              the pickers' searches (songs, hymns, tunes) and Reconcile's list search
  linkText.ts             the words for links: reasons, sources, counts, and what Reconcile says after a change
  creditsEditor.ts        the song page's credit editor: rows of names, previews, words (see Credits)
  newPcoSong.ts           the Create in Planning Center form: its fields, check, confirmation and words
  addToPlan.ts            Add to a plan: the upcoming plans as options, and what each step says
  tagsEditor.ts           the Tags card: a song's tags by group, the editor's choices, words
lib/import/               the seed import, pure: hymnsJson.ts plans the rows and the report,
                          rows.ts types the planned rows and checks stored ones (parsePlannedRows);
                          hymnsJsonFile.ts (server-only) is the one module that reads hymns.json
lib/db/catalog.ts         the reads, in a handful of queries each, labelling every entry
lib/db/catalogWrites.ts   createCatalogSong: the new-song form's write
lib/db/importRuns.ts      import_runs: create, list, find, finish and discard runs; ImportRunError
lib/db/catalogImport.ts   applyImportRun, findApplyRefusal
lib/queries/catalog.ts, lib/queries/catalogImport.ts, lib/queries/catalogEdit.ts
                          what pages and actions import (see lib/queries above)
lib/csv.ts                RFC 4180 CSV text, with a guard against cells a spreadsheet would run as formulas
```

**Reads.** `lib/db/catalog.ts` labels every entry with `formatEntryLabel`, so pages and client components never format one. The songs list sends all of its roughly 920 rows to the browser as `CatalogSongSummary` (about 50 KB gzipped), where `filter.ts` narrows them; the tunes list sends rows trimmed to what it shows (`toCatalogTuneRow`).

**The songs list's filters and Export CSV.** A row carries its link (`pcoSongId`, `linkedBy`) and its Planning Center song's `lastScheduledAt`. `?linked=` (`all`, `yes`, `no`) keeps the songs linked to a Planning Center song, or not; `?used=never` keeps the songs never scheduled: not linked, or linked to a song Planning Center has never scheduled (`isUsed`; PCO counts upcoming plans, so "used" means scheduled, not sung). `routes.catalogFiltered({ linked, used })` builds those URLs: Reconcile links to `?linked=no`, and `/unused-hymns`, which the filter replaced, redirects (308) to `?used=never`. `?tag=` (the id of one of Planning Center's song tags) keeps the songs linked to a Planning Center song that has the tag; a select chooses it, so no route builder makes it (see [Tags](#tags)). Export CSV downloads every song the filters leave, not just the page, entirely in the browser (`downloadCsv`: a Blob with a UTF-8 byte order mark, so Excel reads it as UTF-8): title, tune, a column per book, linked, last scheduled (`songsCsv.ts`, written by `lib/csv.ts`).

**The seed import: preview, then apply.**

1. *Preview* (`previewSeedImportAction` → `previewSeedImport()`). `planHymnsJsonImport` turns the records of `hymns.json` into planned rows that refer to each other by normalized keys (ids exist only once apply inserts them) and a report: input counts, the rows it adds and the entries per book, split pairs, variants, the merge list, songs without a tune, entries left out and possible duplicates. `createImportRun` stores both in `import_runs` with the status `preview`. Previewing always works, and the action redirects to the run.
2. *Review* (`/catalog/import/{runId}`). The page shows the report and, when `findApplyRefusal` says Apply would be refused now (the catalog has books), the reason beside an `aria-disabled` Apply.
3. *Apply* (`applyImportAction` → `applyImportRun`), confirmed in a `Dialog`. One transaction refuses a run that is not a preview, or any run while the catalog has books (so the seed never runs twice), checks the stored rows with `parsePlannedRows`, inserts exactly what was previewed and marks the run `applied`; a refusal or a bad row leaves the catalog as it was. *Discard* marks a preview `discarded`. The three forms use `useActionState`, which convention 15 allows because their actions touch only the local database: a refusal comes back to the form as a message, and success revalidates the catalog's pages and redirects.

**Adding a song** is the new-song form (`/catalog/songs/new`, the model for the forms to come; see [Add a server-action form](#add-a-server-action-form)). It chooses the hymn (one in the catalog, found by title, other title or tune, or a new title), the tune (one in the catalog, a new name, or none) and an optional first entry (a number or a location in a numbered book, or the end of a book without numbers). `createCatalogSong` (`lib/db/catalogWrites.ts`) writes the hymn, tune, song, entry and link in one transaction, after collecting every problem the catalog's rules raise, each naming the part of the form it is about and the row it clashes with: a title or tune name already taken, by an alias too (titles compared by `normalizeTitle`, names by `normalizeTuneName`); a song the hymn already has to that tune, or with no tune; a number another song has. A link that is refused afterwards rolls the whole song back.

### Planning Center links

A catalog song links to the Planning Center song it is, and plan pages take a song's numbers from that link, never from an item's title. `songs.pco_song_id` holds the link (with `linked_at` and `linked_by`: `auto`, `manual` or `import`), and it is unique: a Planning Center song links to at most one catalog song and the other way round.

```text
lib/reconcile.ts          pure: buildCatalogIndex, suggestLinks, chooseAutoLinks, readTuneHint, tunesNamedBy
lib/fuzzy.ts              levenshtein, isNearMatch
lib/db/pcoSongs.ts        the mirror: upsert a listing, mark removed, ignore, block, and its reads
lib/db/links.ts           linkSong, unlinkSong, applyAutoLinks, listAutoLinks: the only writers of a link
lib/queries/sync.ts       syncPcoSongs, the song sync; describePcoSongsSync, its run's message
lib/queries/reconcile.ts  what Reconcile shows, and the links made from pages (see lib/queries above)
```

**The mirror** (`pco_songs`, migration `0003_pco_songs`) is the app's copy of the Planning Center song library: each song's id, title, author, copyright, CCLI number, admin, themes, hidden flag, `last_scheduled_at` (PCO's: org-local time labelled `Z`, and it counts upcoming plans), PCO's own dates, and `synced_at`. Rows are never deleted, so a link never points at nothing: a song a complete listing no longer has gets `removed_at`, cleared if it comes back. The app's own marks are `ignored_at` (Reconcile's Ignore: not hymnal material) and `auto_link_blocked_at` (set when a person undoes or removes a link, so syncs leave that song alone; a link by hand still works). There is no foreign key from `songs.pco_song_id` (SQLite cannot add one without rebuilding `songs`): `linkSong` checks that the song is in the mirror instead.

**The sync** (`syncPcoSongs`) reads the whole library with one paced `fetchSongLibrary()` (about four requests), and only then writes, in one transaction: it upserts every song, marks removed the songs the listing lacks (only those the mirror last read before the listing began, so a song a page mirrored during the sync is never marked removed) and unmarks those that came back, and makes the auto-links. A failed or partial read writes nothing, and so does a listing with no songs while the mirror has some (taken for a failure, not an emptied library). The `pco-songs` job runs it every hour and a minute after boot; "Sync now" (Settings and Reconcile) runs it through `runJob`, so it joins a run already in progress, and says how that run went, never an older one. Each run's `sync_runs` row says what it did: "Synced 397 songs: 2 added, 5 auto-linked".

**Matching** (`lib/reconcile.ts`, pure) compares titles by `normalizeTitle` and tune names by `normalizeTuneName`. `suggestLinks(pcoSong, index)` gives the catalog songs a Planning Center song may be, best first, each with its reason: `exact` (the title is a hymn's title, so each of its tunes is a candidate), `alias` (another title of a hymn), `tune-hint` (the title before a trailing parenthetical is a hymn's, and the parenthetical names the tune: "Abba, Father (PRITCHARD)"; `readTuneHint` splits it off and `tunesNamedBy` finds the tunes) or `near` (`isNearMatch`, or a parenthetical that names none of the hymn's tunes). Pages show the best three (`TOP_SUGGESTIONS`).

**Auto-links.** A sync links a Planning Center song by itself (`chooseAutoLinks`, then `applyAutoLinks` with `linked_by = 'auto'`) only when all of these hold:

- it is not linked, still in Planning Center, not ignored and not blocked;
- exactly one catalog song is a candidate for it with a strong reason (exact, alias or tune-hint), so a hymn sung to several tunes is never linked from its bare title, nor a title two hymns share;
- that catalog song is not linked;
- no other Planning Center song still in Planning Center has that same single strong candidate.

Near matches never link. Reconcile lists the auto-links of the last 30 days for review, each with Undo.

**Linking by hand.** `linkSong` and `unlinkSong` (`lib/db/links.ts`) are the only functions that change a link, for every caller: the sync, Reconcile, the plan page's Link, the new-song form, Create in Planning Center and the song page's Unlink. A link that would take a song already linked elsewhere is refused with a message that says so, never moved; linking a Planning Center song also takes it off the ignored list. A link made from a page first mirrors the Planning Center song when the mirror lacks it (`mirrorPcoSong`: one unpaced `GET /songs/{id}`), so a link made before the first sync still points at a mirrored song. Undoing an auto-link and the song page's Unlink both block the Planning Center song's auto-link, so the next sync does not undo what a person did.

**Reconcile** (`/catalog/reconcile`, `getReconcileData()`, a fixed number of queries) lists:

- the Planning Center songs not in the catalog (neither linked, ignored nor removed), by title, each with its suggestions (with their reason, and Link, or a note when that catalog song is linked to another Planning Center song), "Choose another song" (a search over every catalog song, by title, tune or entry, with Link), "New catalog song" (the new-song form, prefilled from the song, which links it and comes back) and Ignore. A search over their titles and authors narrows the list in the browser and lives in `?q=`;
- the auto-links of the last 30 days that still stand, with Undo;
- the ignored songs, collapsed, with Unignore;
- the last sync, with Sync now, and how many catalog songs are not in Planning Center, linking to `/catalog?linked=no`.

Its actions (`reconcile/actions.ts`, which also holds the song page's Unlink) check the session, parse every id and revalidate every page that shows links: `revalidatePath("/catalog", "layout")` and `revalidatePath("/plans", "layout")`. A row that is resolved leaves its list: the list says what was done in a status line and moves focus to the row that took its place (`useRowNotice`), or to that line when the list is empty. A refusal shows in the row as an alert keyed per attempt (`formStateKey`), so a refusal repeated word for word is announced again.

**The song page's Planning Center card** (`PcoLinkCard`) shows the linked song as the mirror has it (title, author, copyright, when it was last scheduled, whether it was deleted from Planning Center), a link to it in Planning Center (`pcoWebUrls.song`), how and when the link was made, Add to a plan (for a song still in Planning Center) and Unlink, confirmed in a `Dialog`. A song that is not linked says so, with a link to Reconcile, and offers Create in Planning Center. Add to a plan and Create in Planning Center are described in [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans). The card stays mounted when an action swaps its content, so that it can say what happened (what was unlinked, or the song created and anything that did not go as planned) and take focus there; the links to Reconcile inside its sentences are underlined (convention 20).

**Plan pages.** `getPlanDetail` adds, for the plan's song items, `catalog` (the linked catalog song of each Planning Center song, by its id: title, tune and labelled entries in book order) and `suggestions` (the best three for each one not linked and not ignored, matched by the Planning Center song's own title, not the item's). It reads the database in at most seven queries, however long the plan. When the database cannot be read it logs, returns both empty with `catalogError`, and the plan's pages work without them; the Schedule tab says the numbers cannot be shown. The Schedule tab renders a `ScheduleSongCard` per song item (`scheduleSongView` in `lib/scheduleCards.ts` decides which):

- linked: the catalog song and its numbers (`EntryNumbers`), with Numbers (the default when it has entries), Leave blank or Custom;
- not linked: `LinkToCatalogInline`, its suggestions with a one-click Link (`linkPcoSong` in the plan's `actions.ts`, which checks the session, parses every id, links by hand, and revalidates the plan and the catalog's pages) plus "Create in catalog" and "Find in catalog"; Leave blank or Custom. The Link is called from its click, with its pending state in `useState` (it may read a song the mirror lacks from Planning Center). Once it is made, the card says what was linked in a status region that is always in it ("Linked: R-553 / G-17") and takes focus on its heading, since the suggestion that had focus is gone; a refusal is an alert keyed per attempt;
- ignored, without a Planning Center song, or when the catalog cannot be read: Leave blank or Custom.

The schedule text prints, for each song item in sequence, `Title (R-396 / G-317)` for Numbers (its labels in book order, joined with the `numberSeparator` setting, " / " by default; the Doxology prints `G-Front Cover`; a descant a book prints under a number of its own is left out when the song has a plain entry, as `scheduleEntries` explains), `Title (text)` for Custom with text, and the title alone otherwise. Above the lines goes the header, the service type's label from the settings and the plan's date (`Sunday AM 10/4/26`), or none for a type without a label (see [Settings](#settings)).

### Hymnal notes

Each song item of a plan can carry a note, in one item note category of its service type, that gives the musicians its hymnal numbers from its catalog link: `R-396 / G-317`, or `R-396 / G-317 · ST. ANNE` with the `hymnNoteIncludesTune` setting. The category is "Hymnal" by default (the `hymnNoteCategoryName` setting). Planning Center's API cannot create a category, so someone adds it once per service type in Planning Center's web app.

- **The category is found by name, and the notes are matched to it by id.** `matchHymnNoteCategory` finds a service type's category of that name, without regard to case or spacing (`sameCategoryName`); its id differs in each service type. A note is in it when the note's category id is the category's. Only a note Planning Center sent without a category id is matched by name, so a note in a deleted category of the same name is never touched.
- **Two live categories of the name are refused** ("Hymnal" and "hymnal"): the notes have no one place to go. The status is `unavailable` with the reason `ambiguous-category`, and its message asks for all but one to be renamed or deleted. Settings' Hymnal notes card says "More than one".

```text
lib/hymnNotes.ts          pure: formatHymnNote, matchHymnNoteCategory, diffHymnNotes, planHymnNoteStatus,
                          matchesPreview, hymnNoteState
lib/hymnNoteText.ts       pure: the words of the dialog, its preview and results, and of every note's state
                          (HYMN_NOTE_STATE_WORDS), which the dashboard and the cards share
lib/previewedHymnNotes.ts server-only: parses the preview the dialog sends back with Confirm
lib/pco/writes.ts         createItemNote, updateItemNote, deleteItemNote
lib/queries/hymnNotes.ts  previewHymnNotes, syncHymnNotes, and getHymnNoteCategories for Settings
lib/db/writeLog.ts        recordWrite, and findCreatedItemNoteIds: which notes the app wrote
```

**What a note says** (`formatHymnNote`): the song's numbers as the schedule text prints them, joined with the `numberSeparator` setting, then the tune when that is on and known. A song that is not linked, or is in no book, has nothing to say. The Schedule tab's choices play no part: the notes are for the musicians, the choices for the bulletin.

**The rules** (`diffHymnNotes`, for each song item, in sequence):

- Notes in other categories are never touched.
- **The app updates any hymnal note on a linked song with numbers**: that is its job, whoever wrote the note. Of an item's notes in the category, the one brought in step is the first that already says the right thing, else the first the app wrote, else the first. So a note typed by hand is changed only when the app has no note of its own there.
- **It deletes only notes it wrote.** It knows them from the write log (`findCreatedItemNoteIds`): a successful `item-note` create whose result is that note. Any other note it would delete (an extra in the category, or a note on a song with nothing to say) is left alone and shown as kept. A log that has lost history (a restored database) can therefore only keep a note that could have gone, never delete one.
- Each item gets one action: `create`, `update`, `unchanged`, `delete` (its song has nothing to say, and the app's notes go), `dedupe` (in step, with extras of the app's to remove), `keep` (nothing to say, and the notes are not the app's) or `none`.

**Preview, then sync.** `previewHymnNotes(st, plan)` reads the service type, the plan's items with their notes and the categories (three requests in parallel), then the catalog and the app's notes, and gives `planHymnNoteStatus`, checked in this order:

1. `unavailable`, reason `settings`, when the settings cannot be read. Their defaults could name another category, or drop the tune the church chose from every note, so nothing is compared or written with them.
2. `unavailable`, reason `categories`, when the categories cannot be read.
3. `no-category`, whose message asks for the category (`Create an item note category named "Hymnal" in Planning Center for Sunday Evening.`), or `unavailable`, reason `ambiguous-category`, for two of the name.
4. `unavailable`, reason `catalog`, when the catalog cannot be read.
5. Otherwise `ready`, with each item's diff.

`syncHymnNotes(st, plan, previewed)`:

- **Holds Confirm to what the preview showed.** It reads the plan's items again with `fetchPlanItems`, never the request's cached read, and computes each item's diff afresh. It then writes an item only when that diff is what was previewed for it (`matchesPreview`: the same action and the same writes, each to the same note with the same words). Any other item, or one the preview did not have, is reported `changed`, with nothing written, and the person previews again.
- **Never trusts the preview.** It comes from the browser, so it is only compared: every write is the sync's own. The action parses it first (`lib/previewedHymnNotes.ts`): every id through `parsePcoId`, every action, kind and reason checked, at most 200 items and 50 writes to one. A preview that does not parse is refused before Planning Center is read.
- **Refuses, writing nothing**, for any status but `ready`.
- **Makes each item's changes in order**, unpaced, with a `write_log` row for each. An item whose write fails stops there, and the sync goes on to the next item, **except at Planning Center's rate limit**: after a 429 the client did not retry, every later item that needed a write is reported `not-attempted`, and nothing more is sent.
- **Runs one sync per plan at a time.** Each plan's sync in progress is kept on globalThis (convention 15), set before the sync's first await. A second call for that plan gets `kind: "busy"` and writes nothing. It does not join the running sync, whose preview may not be its own. Other plans sync alongside.
- **Returns** each item's outcome (`done`, `failed`, `nothing-to-do`, `changed` or `not-attempted`) and the counts (`created`, `updated`, `deleted`, `unchanged`, `kept`, `failed`, `changed`, `notAttempted`).

See [Add a PCO write](#add-a-pco-write) for the pattern.

**On the pages.**

- **The dialog.** The plan header's "Sync hymn notes" (`SyncHymnNotesAction`) opens a `ui/Dialog`. It first says what a sync does (`SYNC_DIALOG_DESCRIPTION`): each song's hymnal note is rewritten to its numbers, whoever wrote it; only notes the app wrote are ever removed; notes in other categories are never touched.
- **The preview** has a row per song, each with lines for a note in sync, added, changed, removed or left alone.
- **Confirm** sends the preview back with the sync. The results come next, with the songs that failed, changed or were not tried first. Preview again sits beside Done when any changed or were not tried.
- **Event handlers, not form actions.** Both steps are server actions (`previewHymnNotesAction`, `syncHymnNotesAction`) called from their clicks, with the dialog's state in `useState` (convention 15).
- **No dismissing it mid-sync**, short of the browser closing it (see `Dialog` in [Shared UI](#shared-ui)). After such a close, a sync that finishes opens the dialog again with its results, and Sync hymn notes pressed during a sync opens it on the sync rather than a new preview. A sync revalidates the plan.
- **One wording for a note's state** (`HYMN_NOTE_STATE_WORDS` in `lib/hymnNoteText.ts`): in sync, needs sync (which covers a note of the app's to remove), missing, and left alone. The dashboard's badges and the Schedule-tab cards read it as "Note in sync", "Note needs sync" and so on (`hymnNoteBadgeLabel`), and the dialog tags its lines from it (`hymnNoteStateTag`). `getPlanDetail` carries the plan's `hymnNoteStatus` for the cards, and a card's "Note left alone" says beside it that the app did not write the note.
- **Elsewhere.** The dashboard shows each next plan's notes (see [The dashboard](#the-dashboard)), and Settings' Hymnal notes card shows whether each service type has the category.

### Credits

A song's credits say who wrote its words and its music, and who arranged or translated it. Planning Center has one `author` field for them, so the app reads and writes a **labelled convention** in it, with the roles of the `creditRoles` setting as the labels (Words, Music, Arr. and Trans. by default):

```text
Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe
Words & Music: John Newton
```

The author's own text stays the one truth: the credits the app keeps are derived from it, never edited by themselves.

```text
lib/credits.ts            pure: parseCredits, checkCredits, renderCredits, renderCreditLine, creditLineOf,
                          phraseFor, and the legacy reading (readLegacyAuthor, renderLegacyCreditLine)
lib/creditRows.ts         pure: the Settings Credits form's rows, in a flat FormValues
lib/catalog/creditsEditor.ts
                          pure: the song page's credit editor: rows of names, previews, words
lib/db/credits.ts         pco_song_credits: replaceSongCredits, deriveSongCredits, findSongCredits
lib/queries/credits.ts    rederiveAllCredits
```

- **The grammar.** `credits := group (";" group)*`, `group := label ":" names`, `names := name ("," name)*`. A label is a role, matched without regard to case, or two roles joined by "&" or "and", which the names then hold both of (`Words & Music: John Newton`). A name never holds a colon, semicolon or comma, so it reads back as one name.
- **What an author reads as** (`parseCredits(author, roles)`). **Any colon makes an author labelled**, and it is then either:
  - `ok`: it follows the convention. Its credits are one per role, in the order of the roles, each role's names in the order written;
  - `unparsed`: its labels do not parse (a label that names no role, a group with no label, an empty name). It is flagged on the song's page and never rewritten, and its copyright text prints exactly as it always did.

  An author with no colon is `legacy`, whatever else it says (an empty or missing author too).
- **The legacy parser** is the heuristic the copyright text always used, moved verbatim into `readLegacyAuthor` and `renderLegacyCreditLine`, quirks included. Three or more comma-separated parts are two words authors and one music author (any more are dropped). Otherwise, with no lower-case " and ", the author wrote both words and music; with one, the first part wrote the words and the second the music. An empty author is "Unknown". So every song whose author predates the convention prints byte for byte as before, and no assertion of `copyright.test.ts` changed (`credits.test.ts` pins the line an author always printed). The credits derived from the legacy reading put the words under the first role and the music under the second, which is why `creditRoles` needs at least two roles, the first for the words and the second for the music.
- **Printing.** `creditLineOf(parsed, settings)` is the credit line of a song's copyright text. For an `ok` author with credits it is `renderCreditLine(credits, phrases)` ("Words by A and B. Music by C. Arr. by D."), with one phrase for two roles next to each other that the same names hold ("Words and Music by John Newton."). For any other author it is the legacy line and a period. A role's phrase is the `creditPhrases` setting's, or "<role> by" ("<role> and <role> by" for a pair). `formatCopyrightText` takes the roles and phrases with the CCLI number, which `planTextSettings` puts in `scheduleSettings`, so the Copyright tab, Copy All and the plan email all print with them.
- **Writing.** `renderCredits(credits)` writes the convention back (two roles next to each other with the same names go together: `Words & Music: …`). `checkCredits(credits, roles)` makes credits typed in the app ready to write: names trimmed, blank and repeated ones dropped, a role given twice merged, each role spelled as `roles` spells it and in their order, a role with no names dropped. It refuses a role that is not one of the roles, and a name with a colon, semicolon or comma, a line break or more than 100 characters. What it gives back reads back identically through `renderCredits` and `parseCredits`.
- **The derived rows** (`pco_song_credits`) hold what each mirrored song's author reads as: a row per name of each role, in order, each with the author's parse status (an author that names nobody has one row with a NULL role and name, which holds its status). They are never edited. A song's rows are replaced whole on every song sync (with the stored `creditRoles`, or the defaults when that does not parse) and whenever a write mirrors the song afresh (a credit save, a created song, a song added to a plan), and every song's by `rederiveAllCredits()` when the roles change (see [Settings](#settings)). The pages read the author itself today; the rows are there for the filters and reports to come (`findSongCredits` reads a song's).
- **The credit editor** is the song page's Credits card, for a song linked to a Planning Center song. It shows the song's author as Planning Center has it, with how it reads (Labelled; Not in the labelled form yet; Labels the app cannot read), then a row of names for each role (a field for each name, with Add a name, Remove, and Split into names for a field that holds several), and under them, live, the credit line the copyright text will print and the exact author Planning Center will be sent. It starts from the author's credits; for a legacy author, from the guided split (the reading the copyright text gives it now, to check); for an unparsed one, from the groups that do parse, with the others listed to place by hand (`draftCredits`). **Save is the only thing that writes**, never Enter in a field, and **never in bulk**: one song, when someone saves it (`saveSongCredits`, see [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans)). A song deleted from Planning Center shows its credits and cannot save them. A button that changes the rows moves focus and says what it did only when the rows it made are the ones on screen.

### Creating songs and adding them to plans

The song page writes to Planning Center through `lib/queries/pcoSongs.ts` (and `lib/pco/writes.ts`, the only module that sends a write): a song's credits (see [Credits](#credits)) and tags (see [Tags](#tags)), a new song created from a catalog song, and a song added to an upcoming plan. They share one shape.

- **Each flow reads afresh first, writes, then brings the mirror up to date** (the song as Planning Center has it now, and its credits derived), and logs a `write_log` row for every write it sends, made or refused, with a payload a person can read. The database is opened before anything is sent and written only after Planning Center has answered: nothing waits on Planning Center inside a transaction.
- **A refusal is a value.** A field or id that is not valid, no such song or plan, a song with no arrangement, a catalog song that is linked already or is being created already, and a write Planning Center refuses with a 422 (`PcoValidationError`, whose reasons come back as `details`) all return `{ ok: false, reason, message }`. Anything unexpected (Planning Center failing, a database that cannot be opened) throws, after the failed write is logged.
- **None revalidates a page**: its caller, the song page's action, does.

**The song page's actions** (`app/(app)/catalog/songs/[songId]/actions.ts`: `saveSongCreditsAction`, `saveSongTagsAction`, `createInPlanningCenterAction`, `listUpcomingPlansAction` and `addSongToPlanAction`). Each is a public POST endpoint: it calls `auth()` first, takes its arguments as anything the network may send, passes every id through the parser for its kind (convention 19) and every other argument through a reader of its shape (`readCreditsInput`, `readNewPcoSongInput`, `readTagIdsInput`, which check the shape only; the query checks the rest), calls only `lib/queries`, and returns a refusal with its message. A failure nobody expected is logged and comes back as a message that says what may or may not have been written ("Look at the song in Planning Center before trying again"). **All of them wait on Planning Center, so the page calls each from a click, with its pending state in `useState`**, never as a form action or in a transition (convention 15). Their button is `PendingButton`: a plain `type="button"`, `aria-disabled` while pending, so Enter in a field never writes. After a write each revalidates what shows it:

| Action | Revalidates |
|---|---|
| Save credits | the catalog's pages, and the plans' (their copyright text prints the credits); not `/`, which shows none |
| Save tags | the catalog's pages (the song's, and the list's tag filter); the plans and `/` show no tags |
| Create in Planning Center | the catalog's pages, the plans' and `/` (the new link brings numbers to them) |
| Add to plan | the plan's pages, `/` (it lists the next plans' songs) and the catalog's |

**The song page makes no Planning Center request.** It reads the database (the settings never throw), so it has no `loading.tsx`, and a prefetch of it costs no request. What reads Planning Center, the upcoming plans, happens when Add to a plan's dialog opens.

**Create in Planning Center** (`createSongInPlanningCenter`; the Planning Center card of a catalog song that has no link). The form starts from the title the church's practice gives the song, the hymn's, with ` (TUNE)` added when the hymn is sung to other tunes too (`pcoSongTitleFor`), a blank row of names for each credit role (the credit editor, with its previews), a copyright and an optional CCLI song number, with "Use CCLI's details". "Create in Planning Center…" checks the form first, marking every part that needs fixing at once (`checkNewPcoSongFields`, which applies the query's own rules), then confirms in a `Dialog` that shows exactly what Planning Center will get; Create song calls the action from its click. The query checks the form again, refuses a catalog song that is linked already or is being created already (the songs in progress are kept on globalThis, convention 15), and then:

1. POSTs the song with its title, its credits (as its author, in the convention) and its copyright, **never its CCLI number**: this is the CCLI rule. The spike found that a `ccli_number` on create makes Planning Center replace the song's title, author, copyright, admin and themes with CCLI's.
2. With a CCLI number, PATCHes it in and reads the song back. Unless "Use CCLI's details" is ticked, **only the typed title and credits are written back** over CCLI's (the credits only when some were typed): the copyright and admin stay CCLI's.
3. Mirrors the song, derives its credits and links the catalog song to it (`manual`).

Each write is logged as `song` (`create`, `ccli-number`, `restore-typed-details`). **Once the song exists nothing is undone and nothing is retried.** A step that fails after it (the CCLI number, the read back, the write back, the mirror, the link) is a warning in an ok result, since creating the song again would make a second one. When the action's answer is lost, the card says that it is not known whether the song was created, and to look in Planning Center, or on Reconcile after the next sync, before trying again. The outcome is shown on the card, not in the dialog.

**Add to a plan** (`listUpcomingPlans`, `addSongToPlan`; the Planning Center card of a linked song that is still in Planning Center). The button opens a dialog that reads the upcoming plans as it opens: every service type that is not archived, each one's plans that Planning Center counts as future (`getUpcomingPlans`: `filter=future` keeps all of today's plans), earliest first, as radio buttons with the date, the service type and the plan's own title. A service type whose plans cannot be read is left out and counted. The person picks a plan, and the confirmation names it and says what the write does: the item goes **at the end of the plan, titled as the song is in Planning Center, with the song's default arrangement** (`defaultArrangement`: the first that is not archived), and **the app cannot take it out again**. The add reads the song, its arrangements and the plan afresh, in parallel, refuses a song with no arrangement, and POSTs the item with its title and arrangement (`createSongItem`): the spike found that an item given only its song is titled "New Item" and has no arrangement. It is logged as `item` (`add-song`, with the plan's date, the song's title and the arrangement), and the song is mirrored as read; a mirror that cannot be written is only logged, since the item is in the plan. One write, no undo. The dialog then says what was added, with a link to the plan's Schedule tab.

**The two dialogs cannot be dismissed while a write runs**, short of the browser closing them (see `Dialog` in [Shared UI](#shared-ui)). Add to a plan then goes on: its button opens the dialog on the add rather than read the plans again, and the add's outcome, failures included, opens the dialog itself. A create goes on too, with its outcome on the card.

### Tags

Planning Center's song tags (its "Type" group: Chorus, Hymn, Instrumental, Invitation, Special) live in tag groups. The app mirrors them, shows a song's tags on its page, assigns them through the API, and filters the songs list by one. Only the groups for songs are mirrored (`tags_for = "song"`): "Speed" and "Style" are arrangement groups. Planning Center's API cannot create tags or groups, so they are made in its web app.

**The mirror** (migration `0005_credits_tags`): `pco_tag_groups` (with `allow_multiple`: a group takes several of its tags unless Planning Center says `allow_multiple_selections: false`), `pco_tags` and `pco_song_tags`. `lib/db/tags.ts` replaces them whole (`replaceSongTagGroups`, `replaceTagSongs`, `replaceSongTags`) and reads them (`listSongTagGroups`, `findSongTags`, `listTagIdsBySong`), groups and tags by name.

**The tags job** (`tagsJob`, kind `tags`) runs every hour and a minute after boot, after the song sync, so that a song the sync adds gets its tags at once. It waits for a song sync that is in progress (`runJob` joins it) or runs one first, and a song sync that fails does not stop it. `syncTags` first reads everything, paced: the song tag groups with their tags (`fetchSongTagGroups`, `tag_groups?include=tags`), then, for each of those tags and only those, the songs that have it, one tag at a time (`fetchSongIdsWithTag`, `songs?where[song_tag_ids]=<id>`). The spike found that `include=tags` on `/songs` is silently ignored, and that Planning Center may list every song for an id it does not know, so an id comes only from a fresh group read, and a listing with fewer songs than Planning Center counted is an error, not a part of the list. Only then does it write, in one transaction: the groups and tags replace the mirror's, and each tag's songs replace its song tags, leaving out the songs the song mirror does not have yet (a later run gives them theirs). A failed read writes nothing. The run's message reads "Synced 5 tags in 1 group: 412 song tags".

**The editor** is the song page's Tags card, for a linked song. It lists the song's tags by group, then an editor per group that respects it: a checkbox per tag for a group that takes any number, a radio button per tag and "None" for a group that takes one. Before the tags job has brought any tags, the card says so. **Save sends the song's whole set** (`saveSongTags`), since `assign_tags` replaces all of a song's tags. Every id must be a tag of one of the mirror's song groups (an arrangement tag's id is accepted by Planning Center and silently ignored, so it is never sent), and a group that takes one tag may have only one. The song's tags are read afresh first, and a tag it has that the mirror does not know yet (made since the last tags sync, so nobody could have chosen to drop it) is **kept**, and reported. Nothing is sent when the song has exactly that set. The write is logged as `tags` (`assign`, with the song's title and the tags it had and has, by name), and the mirror's tags for the song are replaced.

**The filter.** `/catalog?tag=<id>` keeps the songs linked to a Planning Center song that has the tag; a song that is not linked has no tags, so it never matches. `parseCatalogTag(params, tagIds)` (`lib/catalog/filter.ts`) reads it, and gives the id only when it is one of the mirror's song tags, spelled exactly (anything else is any tag). The page sends the tag groups that have tags and each linked song's tag ids (`catalogTagIdsBySong` trims `getTagIdsBySong()` to the songs the list shows). The controls show the filter, a list grouped by tag group with "Any tag" first, only once the tags job has brought some, and Export CSV honours it.

### Email

A plan's header has **Email this plan**: a preview of the plan's songs as an email, then a send to the staff. The recipients and the subject are settings (`emailRecipients`, `emailSubjectTemplate`).

```text
lib/email.ts              server-only: emailStatus, sendEmail, EmailError, over Nodemailer
lib/planEmail.ts          pure: buildPlanEmail, formatPlanEmailSubject
lib/planEmailText.ts      pure: the dialog's words, and how Settings explains setting email up
lib/queries/email.ts      previewPlanEmail, sendPlanEmail, getEmailStatus
```

**Configuration.** Email goes over SMTP through Nodemailer, set up by two environment variables that the app reads as it starts:

- `SMTP_URL`: the server and its login, as a URL. `smtps://` is TLS from the start (port 465 unless the URL names one), as in `smtps://office%40example.org:app-password@smtp.gmail.com`. `smtp://` (port 587) must switch to TLS with STARTTLS before it sends a login, and a server with no login may stay plain. Percent-encode `@`, `:`, `/`, `%`, `#`, `?` and `$` in the user name and password. **It holds the password, so it is never shown, logged or put in an error message**: `EmailError`'s messages have the URL, the password and its encoded forms taken out.
- `EMAIL_FROM`: who the email is from, an address or `Name <address>`.

`emailStatus()` says whether email can be sent: `{ configured: true }`, or `{ configured: false, missing }`, where `missing` is **a list** of the variables that are not set (blank counts as not set) or not usable (an `SMTP_URL` that is not an `smtp://` or `smtps://` URL with a host, an `EMAIL_FROM` with no "@"). It reads only the environment, connects to nothing and never gives a value. In production they are in `~/service-integrator/.env.production`, which `deploy.yml` writes from the `SMTP_URL` and `EMAIL_FROM` secrets **only when they are set**, so an unset secret writes no empty value, which would hide one set in the server's own `~/service-integrator/.env`. A send waits at most 15 s for each of the connection, the greeting and the DNS lookup, and gives up after 30 s of silence from the server. `package.json` has `nodemailer` ^10.0.14 (which ships its own types) and `"overrides": { "nodemailer": "$nodemailer" }`, so that npm accepts it beside next-auth, which declares an optional peer `^7`.

**The email** (`buildPlanEmail(detail, settings)`, pure: a plan's page data in, `{ subject, text }` out). The subject is the `emailSubjectTemplate` with `{date}` (the plan's short date, "10/4/26", from the date part of its `sortDate`, so the same in every time zone) and `{service}` (its service type's name), each on one line; any other `{…}` stays as typed. The body is plain text: the plan's label ("October 4, 2026 · Sunday Morning"), the Schedule tab's copy text (its header, and a line per song with its saved choice or its default, as Copy All copies it), then each song's copyright text, as the Copyright tab's Copy All copies them, with a blank line between.

**Preview and send** (`lib/queries/email.ts`):

- `previewPlanEmail(st, plan)` gives `{ configured, missing?, to, subject, text }`: the email as it would go now, with whether email is set up and who it would go to. It reads the plan as its pages do (`getPlanDetail`) and the settings, and sends nothing.
- `sendPlanEmail(st, plan, expected)` sends the email the person previewed and confirmed: `expected` is the preview's `{ to, subject, text }`, sent back. It gives `{ ok: true, to, subject, accepted, rejected, textChanged }` or `{ ok: false, kind, message }`, where `kind` is `not-configured`, `no-recipients`, `unavailable` (the settings could not be read), `busy`, `changed` or `failed`. It refuses without sending in the first five cases. **One send per plan runs at a time**: a call for a plan whose email is still being sent (another tab, or a request sent twice) is refused as `busy`, through a map of the sends in progress kept on globalThis (convention 15). Otherwise **it reads the plan afresh and builds the email from what it finds, never from a preview**, and sends it, unpaced because someone is waiting. **It sends only what was confirmed**: recipients (in any order or case) or a subject that are not the preview's refuse the send as `changed`, sending nothing, since the email would not go to whom, or as, the person saw (the recipients are checked before the plan is read). A text that changed alone, from an edit to the plan, is sent as it reads now, with `textChanged` true. A failed send comes back as a value with a message that never holds `SMTP_URL`; an id that is not one, or a plan that cannot be read, throws before anything is sent.
- **The write log** gets a row (`kind: "email"`, target `plan <id>`) whether the send worked or not: `{ to, subject }` as its payload and the outcome as its result (the Message-ID and who the server took and refused, or the error with Nodemailer's code and the server's reply code). **Never the email's text.** Settings' Recent writes shows it as "Sent a plan's email", with the recipients, the subject and who the server refused.

**The dialog** (`EmailSummaryAction`, on `ui/Dialog`) previews first: the recipients, the subject and the whole text, in a scrolling region that takes the keyboard. Email that is not set up on the server is explained (which variables are missing or not usable, what each holds, and that the server's `.env.production` needs them: `EmailSetupNotice`, which Settings' Email card shows too), and so is a plan with no recipients (with a link to Settings); neither offers Send. Send says how many it goes to ("Send to 2 recipients"), and the outcome says who the mail server took the email for and who it refused (some refused is a warning, since the others got it); a failure says why, with Preview again. Both steps are server actions called from clicks, with the dialog's state in `useState` (convention 15): the preview waits on Planning Center and the send on the SMTP server. **The dialog cannot be dismissed while the email goes**, and a second click on Send does nothing: an email is not taken back. The browser may still close it (see `Dialog` in [Shared UI](#shared-ui)): the send then goes on, Email this plan opens the dialog on it rather than prepare another email, and its outcome opens the dialog itself. When the action's answer is lost, the dialog says that it is not known whether the email was sent, and to look at Recent writes in Settings before sending it again. `sendPlanEmailAction` revalidates nothing: no page shows what a send changes except Settings' recent writes, which is read afresh whenever Settings is opened, and a revalidation would render the plan's page again, reading Planning Center, while the person waits.

The unit tests give `sendEmail` a stand-in transport (`SendEmailOptions.transport`), so no test connects to anything. To check Send in a browser, see [Testing](#testing).

### Settings

The app's settings are a typed registry in `lib/settings.ts` (pure). Each key has a parser, which turns a stored (JSON) or posted value into a valid one or says why not, and **a default that reproduces the app's text from before settings existed**, so nothing changes until something is saved. The keys:

- `ccliLicenseNumber`: the license number on the last line of every copyright block, `"1564484"`;
- `scheduleHeaderLabels`: the schedule text's header for each service type, by its id;
- `numberSeparator`: `" / "`, between a song's numbers in the schedule text and the hymnal notes;
- `hymnNoteCategoryName`: `"Hymnal"`;
- `hymnNoteIncludesTune`: `false`;
- `creditRoles`: `["Words", "Music", "Arr.", "Trans."]`, the labels of the credits convention, in the order they are written and printed. At least two (the first is the words, the second the music) and at most 12, none holding a colon, semicolon, comma or "&", none twice;
- `creditPhrases`: what the copyright text prints before a role's names, by role (`Words: "Words by"`, `Music: "Music by"`, `Arr.: "Arr. by"`, `Trans.: "Trans. by"`), and before the names of two roles next to each other that the same people hold, by the two joined with " & " (`"Words & Music": "Words and Music by"`). A role with none prints "<role> by", so the defaults print what the text always printed;
- `emailRecipients`: `[]`, at most 25 plain addresses, none twice. No email is sent until there are some;
- `emailSubjectTemplate`: `"Songs for {date} · {service}"`, on one line, at most 150 characters, with `{date}` and `{service}` the only placeholders.

```text
lib/settings.ts           the registry (SETTINGS, DEFAULT_SETTINGS), resolveSettings, the header labels'
                          defaults, and what each text reads (planTextSettings, CopyrightSettings, HymnNoteSettings)
lib/settingsForms.ts      the Settings forms' fields and readers, which parse with the registry's parsers
lib/settingsText.ts       the Settings page's words and previews
lib/db/settings.ts        listStoredSettings, writeSettings: rows of JSON text, nothing more
lib/queries/settings.ts   getSettings, getSettingsIssues, saveSettings, getRecentWrites
```

- **Reading never throws.** `getSettings()` gives every setting: its stored value where that parses, else its default. Without a database it returns the defaults and the reason, which a plan's pages show as a banner (`settingsError`) while their text follows the defaults. A stored value that no longer parses (a newer build's, say) falls back to its default and is listed by `getSettingsIssues()`. A key this build does not know is left alone.
- **Saving checks everything first.** `saveSettings(values)` parses every value with its key's parser, then writes all of them or none, in one transaction. What it refuses comes back by key, fit to show beside the field.
- **Text takes its settings as arguments**, so the text modules stay pure:
  - `formatCopyrightText` takes the CCLI number and the credit roles and phrases;
  - `buildScheduleCopyText` takes the header label and the separator;
  - the hymnal notes take the separator, the tune and the category's name;
  - `buildPlanEmail` takes the subject template.

  `planTextSettings` resolves what a plan's text reads for its service type (the header label, the separator, the CCLI number, and the credit roles and phrases), `getPlanDetail` passes it on as `scheduleSettings`, and an item's page passes on the CCLI number too. The email's two settings are read when the email is built.
- **Header labels.** A service type with no label of its own keeps the header it always had: "Sunday AM" for a type named exactly "Sunday Morning", "Sunday PM" for "Sunday Evening", and none for any other. A stored "" means no header. *Known limit:* the form reads a blank label as "no label of its own", so it removes the entry and the type gets its default. A type that has a default can therefore not be set to no header from the page.

**The Settings page**, top to bottom:

1. A warning, only when there is something to warn of: the settings could not be read, or stored values no longer parse, each named with the card that replaces it.
2. **Copyright**: the CCLI license number, with a preview of the copyright block's last line.
3. **Credits**: the credit roles, as rows in the order they are written and printed, each with the phrase the copyright text prints before its names (with Move up, Move down and Remove, and Add a role), the phrase for the first two roles when the same people hold both, and a live preview of a credit line. Saving reads every song's author again (see below).
4. **Schedule text**: a header label for each service type Planning Center lists, with what a blank one gives, and the number separator, with previews. It waits for the service types, under a Suspense boundary. When Planning Center cannot be read, the separator can still be saved, and every label already saved is kept.
5. **Hymnal notes**: the category's name and whether a note names the tune, with a preview. Under the form, whether each service type has the category: found, missing (with how to create it) or more than one (with which to rename or delete). That part streams in under its own boundary.
6. **Email**: whether the server can send email (`SMTP_URL` and `EMAIL_FROM` set and usable, or which are not and what to do about it, and never a value), then the recipients and the subject, each with a live preview.
7. **Recent writes**: the last 20 rows of the write log, newest first: what the app wrote to Planning Center, and the emails it sent. Each row has when (in the viewer's time zone), what was done (`describeWrite`, `lib/writeLogText.ts`), to which plan and item (a link that does not prefetch), and whether it was made, or why not.
8. **Planning Center sync**: the song sync's last run, with Sync now.
9. **Database**: whether it opens, its file, its migrations and the last backup.

The page reads the database, which is quick and never throws, and starts Planning Center's read of the service types and their categories before it renders, under a deadline (see [Why the boundaries sit where they do](#why-the-boundaries-sit-where-they-do)).

**The forms are not form actions.** Each form calls its action (`saveCopyrightAction`, `saveCreditsAction`, `saveScheduleTextAction`, `saveHymnalNotesAction`, `saveEmailAction`) from `onSubmit`, keeps its state and pending flag in `useState` (`useSettingsForm`), and has its own `SaveButton`, not `useActionState` and `SubmitButton`. The reason: a save revalidates Settings, the plans' pages and the dashboard, a revalidated page renders again in the action's response, and Settings waits on Planning Center (convention 15). The fields are controlled, so they show what was typed or saved. "Saved." is the text of a status region that is always there, as Sync now's is: it stays while the fields show what the save stored, and is cleared while a save is under way, so the same "Saved." twice is still announced. Each action checks the session, reads its form with `lib/settingsForms.ts` and saves with `saveSettings`.

**The Credits and Email forms.** The credit roles are rows, but the form's fields stay a flat map like every Settings form's (`creditRole-0`, `creditPhrase-0`, `creditRole-1`, …, and `creditPairPhrase`): `lib/creditRows.ts` adds, removes and moves rows in it, renumbering them, so the form saves, says "Saved." and marks errors as the others do. `useSettingsForm`'s `replaceValues` replaces the fields as a whole, says whether it did (it does nothing while a save is under way), and clears a refusal on screen, whose marks name fields that no longer mean what they did once rows move. A row that is added, removed or moved hands focus to the control that stands for it now and says what was done in a status line; a button that cannot act (Move up on the first row, Remove at two roles) is `aria-disabled` and keeps focus. `readCreditsForm` checks every field with the registry's own parsers and marks each one that is wrong (a role with a separator in it, the later row of a role listed twice), and checks the list (at least two roles, at most 12) only when every field is fine, marking `creditRoles`, which no field has: the form shows it under the list. A blank phrase is no phrase of its own: the text prints "<role> by", so it is not saved, and the form shows that text. What is saved replaces every phrase, since only a role's and the pair's are edited here. `readEmailForm` splits the recipients at line breaks, commas and semicolons, checks every entry as an address and names the ones that are not, all at once, before it checks the list (no address twice, at most 25).

**Saving the roles re-derives the credits.** `saveCreditsAction` saves the roles and phrases, **then reads every mirrored song's author again with the new roles** (`rederiveAllCredits`: the database alone, in one transaction, removed and ignored songs too), so that the credits follow at once and not at the next song sync, and says how many songs that was and how they read: "Saved. Read the credits of 397 songs again: 3 follow the roles, 390 have no labels and 4 have labels that no role matches." Renaming or removing a role turns the songs whose author uses its old label into `unparsed` ones: their copyright text does not change, and each is flagged on its page for someone to fix. When the re-read fails, the roles are saved and the form says so, and the next song sync derives the credits with them. The action revalidates Settings, the plans' pages (their copyright text) and the catalog's (the songs' credits), not the dashboard. `saveEmailAction` revalidates Settings alone, since the email dialog reads the settings each time it opens.

### The dashboard

`/` (`app/(app)/(home)/page.tsx`) is the app's home: each service type's next plan, then what needs doing.

- `getDashboard()` (`lib/queries/dashboard.ts`) reads it.
- `lib/dashboard.ts` (pure) decides what each part says and where it links.
- `app/components/Dashboard/` renders it, all in server components, since the page only reads and links.

**Reads.** First the service types that are not archived (one request). Then, for each one in parallel, its next plan (`getNextPlan`), and that plan's items with their notes and the type's item note categories: seven requests for two service types. From the database it asks at most eleven queries, however many plans: every plan's catalog links at once (`planCatalogLinks`), which notes the app wrote, the settings, the song sync's latest run and the catalog's size.

**A card per service type.** A plan's card is headed by the plan's label (`planLabel`), which links to the plan. Its song items follow in order, each with:

- its numbers as the schedule text prints them;
- or "Not in the catalog", which links to the plan's Schedule tab;
- or why it has none (in no book, not hymnal material, no Planning Center song);
- and its hymnal note's badge, in the words the cards and the sync dialog use: "Note in sync", "Note needs sync" or "Note missing".

Under them comes a line on the notes (how many need syncing, all in sync, a missing or doubled category, or why they cannot be compared, the settings included) and a link to the Schedule tab. Cards sit side by side from `lg`.

**To-dos**, each with the link that fixes it:

- the catalog is empty: Import;
- the song sync failed, has not succeeded for three hours (`PCO_SONGS_SYNC_STALE_MS`) or never ran: Sync now on Settings;
- a service type with a next plan has no hymnal note category: Settings;
- songs of a next plan are not in the catalog: the plan's Schedule tab. Each Planning Center song is listed once, and the to-do names the first three;
- hymnal notes need syncing: the plan page, where Sync hymn notes is.

**What could not be read is said where it is missing, beside what still works.**

- A service type whose next plan fails keeps its card, with the quiet amber warning the plans list gives.
- Service types that cannot be read are a warning in place of the cards.
- A database that cannot be read is a warning at the top. The plans are still shown, with their songs but without numbers or notes, and the to-dos that need the database are left out.
- An empty to-do list says "Nothing to do.", hedged when something could not be checked.
- `getDashboard()` never throws; a render error falls to `app/(app)/error.tsx`.

**Prefetch.** Every link on the dashboard has `prefetch={false}` (convention 13): most lead to a plan's pages. Its `loading.tsx` sits in the `(home)` route group, so it covers `/` alone. So the nav's link to `/`, prefetched on every page, fetches only down to the loading state, with no request to Planning Center.

**The way home.** The link to `/` is the app's name from `md`, and a house icon below it (see [Shared UI](#shared-ui)). Sign-in falls back to `/` (`signInTarget`), and so do the 404 page's and the auth error page's links.

## Database

The app's own data lives in one SQLite file per server, through Node's built-in `node:sqlite` (unflagged from Node 22.13; no install step and no native binary, so the deploy is unchanged). SQL is hand-written; there is no ORM. It holds `settings` and `sync_runs` (migration `0001_init`), the song catalog (`0002_catalog`: books, hymns, tunes and their aliases, songs, entries and import runs; see [The song catalog](#the-song-catalog)) the mirror of the Planning Center song library (`0003_pco_songs`; see [Planning Center links](#planning-center-links)), the Schedule tab's saved choices and the log of writes to Planning Center (`0004_selections`: `schedule_selections`, `write_log`; see [State](#state) and [Writes to Planning Center](#writes-to-planning-center)), and the credits derived from each song's author and the mirror of Planning Center's song tags (`0005_credits_tags`: `pco_song_credits`, `pco_tag_groups`, `pco_tags`, `pco_song_tags`; see [Credits](#credits) and [Tags](#tags)).

```text
lib/db/
  index.ts          getDb(); re-exports withTransaction, databasePath and backupDirectory
  config.ts         databasePath(), backupDirectory(): DATABASE_PATH, DATABASE_BACKUP_DIR and their defaults
  connection.ts     loadSqlite(); openDatabase(location): the connection settings, no migrations
  transaction.ts    withTransaction(db, fn)
  migrate.ts        migrate(db), appliedMigrations(db)
  migrations/       index.ts (MIGRATIONS, the Migration type), 0001_init.ts, …
  syncRuns.ts       start, finish and read sync_runs rows
  catalog.ts        the catalog's reads; importRuns.ts and catalogImport.ts store and apply its imports;
                    catalogWrites.ts adds a song from the new-song form
  pcoSongs.ts       the Planning Center song mirror; links.ts links and unlinks catalog songs to it
  credits.ts        pco_song_credits: replace, derive and read a song's credits
  tags.ts           the song tag mirror (pco_tag_groups, pco_tags, pco_song_tags): replace and read it
  selections.ts     schedule_selections: upsert and list a plan's saved choices
  settings.ts       settings: list and write the stored values (lib/settings.ts says what they mean)
  writeLog.ts       write_log: recordWrite, recentWrites, findCreatedItemNoteIds
  backup.ts         backupDatabase(), listBackups(), isBackupDue(), pruneBackups()
  errors.ts         errorMessage(error)
  testing.ts        openTestDb() and the seed builders (seedBook, seedHymn, seedTune, seedSong, seedEntry,
                    seedImportRun, seedPcoSong, seedPcoSongCredits, seedPcoTagGroup, seedPcoTag,
                    seedPcoSongTag, seedScheduleSelection, seedWriteLog, seedSetting), for tests
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

To add one, create the next file, such as `lib/db/migrations/0006_marks.ts`, on the model of `0005_credits_tags.ts`, append it to `MIGRATIONS`, and test the new tables through the `lib/db/<area>.ts` functions that use them.

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
- **Jobs** (`lib/jobs.ts`). `JOBS` lists the background jobs, checked in order: the backup, the song sync, the tags sync. A `Job` is `{ kind, everyMs, atBoot?, isDue?, run }`. `startJobs()` checks each job every `everyMs` (and, with `atBoot`, a minute after boot) and runs it when `isDue(db, now)` says so, or every time without `isDue`. It schedules once per process (a globalThis flag), and its timers are `unref()`ed.
- **Runs.** `runJob(job)` records a `sync_runs` row (started, then finished with `ok`, `message` and `counts` from what `run` returns, or with the error) and never throws or rejects. It resolves to the run it started or joined, as recorded (`{ run }`, with `run.ok` false when the job failed), never an older one; or to `{ run: null, error }` when no run could be recorded, because the database could not be opened or written. A call while a run of the same kind is in progress joins that run. The runs in progress live on globalThis, so an on-demand server action and the scheduler see each other.
- **The backup job** is checked hourly and a minute after boot, and runs when the newest backup file is a day old, so restarts (every deploy is one) never stretch the gap much past a day. It also runs when the last backup run did not succeed, whether it failed or a restart interrupted it, even if that run had already written its file. Settings shows its last run.
- **The song sync** (`pcoSongsJob`) runs every hour and a minute after boot; see [Planning Center links](#planning-center-links). Settings shows its last run.
- **The tags sync** (`tagsJob`) runs every hour and a minute after boot, just after the song sync, which it waits for (`runJob` joins it) or runs first; see [Tags](#tags). Its runs are recorded in `sync_runs` (kind `tags`).
- **Add a job** with one entry in `JOBS`, as `pcoSongsJob` is: `{ kind: "pco-songs", everyMs: HOUR_MS, atBoot: true, run: async (db) => { … } }`; a new kind joins `SYNC_RUN_KINDS` (no migration). A "Sync now" button is a server action that checks the session and calls `runJob(job)` (`syncPcoSongsAction` → `syncPcoSongsNow()`), called from the button's click with its pending state in `useState`: a job can take a while, and a transition held open across it would stall every navigation. It says how the run went and revalidates the pages that show it; with no run (`run: null`) nothing changed, so it says so and revalidates nothing.

## Writes to Planning Center

Only `lib/pco/writes.ts` writes to PCO (convention 18): `createItemNote`, `updateItemNote` and `deleteItemNote`, the hymnal notes' writes (see [Hymnal notes](#hymnal-notes)); `createSong` and `updateSong`, a song's creation, credits and CCLI number; `createSongItem`, a song added to a plan; and `assignSongTags` (see [Creating songs and adding them to plans](#creating-songs-and-adding-them-to-plans) and [Tags](#tags)).

- Each one checks every id with `assertPcoId` before it sends anything, makes one write through `pcoMutate` with a body from `jsonApi`, unpaced (someone is waiting), and returns what changed. A 422 throws `PcoValidationError`.
- The barrel exports these functions and `PcoValidationError`, but not `pcoMutate`, `jsonApi`, `toOne` or `toMany`; `lib/pco/index.test.ts` checks that they stay out.
- The caller is a `lib/queries` function. It reads afresh before it writes (refresh-before-write), with a getter's uncached twin such as `fetchPlanItems`, writes only what the person previewed and confirmed, and records a row in the write log for each write, made or refused. [Add a PCO write](#add-a-pco-write) is the recipe.

**The write log** (`write_log`, migration `0004_selections`, `lib/db/writeLog.ts`) has a row per write the app sends:

- `at`;
- `kind`: `item-note` (the hymnal notes), `song` (a song's credits, its creation, its CCLI number, and the typed details written back over CCLI's), `item` (a song added to a plan), `tags` and `email` (an email sent: not a write to Planning Center, but logged the same way), checked in TypeScript (`WRITE_LOG_KINDS`);
- `target`: what was written, such as `plan 123 item 456`, `song 26000001`, or `catalog song 42` for a song Planning Center refused to create;
- `ok`: whether Planning Center made the change (for an email, whether it was sent);
- `payload`: what was asked for, as JSON (an email's is its recipients and subject, never its text);
- `result`: what changed, or Planning Center's error with its status and a 422's details, as JSON.

`recordWrite` adds a row; a failure to record one is logged and never stops the writes. `recentWrites` gives Settings' "Recent writes" card its rows, and `describeWrite` (`lib/writeLogText.ts`) words each one by its kind and the `action` of its payload: a hymnal note created, changed or deleted; a song's credits saved; a song created in Planning Center (and its CCLI number set, and typed details written back over CCLI's); a song added to a plan (with a link to the plan and the item); a song's tags set (the tags it had and has); an email sent (to whom, with what subject, and who the mail server refused). A row whose payload lacks a field its words need still says its kind ("Song write"), its target and how it went. The log is also how the app knows its own notes: `findCreatedItemNoteIds` gives the notes it created, the only ones it deletes (see [Hymnal notes](#hymnal-notes)).

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

- **Server data stays in props.** It is never copied into `useState`, because `router.refresh()` (and an action's revalidation) re-runs the layout and the fresh `detail` must flow straight through.
- **The exception: the Schedule tab's choices.** They start from the plan's saved choices (`detail.selections`, which `getPlanDetail` reads from `schedule_selections`) once, and from then on the provider owns them. A fresh `detail`, from a revalidation or `router.refresh()`, does not replace them: the server knows only what was saved, and the screen may hold a newer choice whose save is still on its way. A selection is `{ option: "numbers" | "blank" | "custom"; customText? }`, keyed by item ID and changed by `scheduleSelectionsReducer` (`lib/scheduleSelections.ts`).
- **The choices live in a store that outlives the provider.** The store (`createPlanSelectionsStore` in `lib/scheduleSelectionsStore.ts`, pure and tested) is read with `useSyncExternalStore`.
  - A save still on its way when the plan's pages go still lands, such as custom text saved as its box unmounts.
  - A registry (`createPlanSelectionsRegistry`) keeps the stores of the last 20 plans, each with the very `detail` object it was shown with. Back shows Next's cached page, rendered with that object and with the saved choices as they were then. Finding the store by that object gives back the changes made since. Any other `detail` was just read from the server, so it gets a new store.
- **Saves.** Each change applies at once, and is saved through the plan's `saveScheduleSelection` action when it changes what the database keeps:
  - a radio choice, at once;
  - custom text 500 ms after typing pauses, or at once on blur, or when its box unmounts (`CustomTextInput` in `ScheduleChoices.tsx`, with `createDebouncedSave`).

  For each item the last save wins. Saves go one at a time: a change made while one is on its way waits, a newer change replaces a waiting one, and the result of a save that a newer one follows is ignored. A failed save keeps the choice on screen, and the card says "Not saved." with the reason and a Retry, until a later save of the item succeeds. The action revalidates nothing: the tab already shows the choice, and a revalidation would read Planning Center on every click.
- **Defaults are derived, not stored.** The merged `scheduleItems` are derived on render from `items`, the choices and `catalog` (`mergeScheduleSelections`). A song item with no choice shows Numbers when its song is linked to a catalog song with entries, and Leave blank otherwise, so a song linked from the tab turns to its numbers when the revalidated layout renders. A saved choice that no longer makes sense is never deleted: Numbers for a song that lost its link shows as Leave blank, and a choice for an item no longer in the plan is not shown.
- **Banners.** When the saved choices cannot be read (`selectionsError`), every song starts on its default, and each choice made is still saved: `getDb()` tries again after a failure, so the database may answer by then, and a save that fails says "Not saved" on its card, with Retry. When the settings cannot be read (`settingsError`), the text follows the defaults and the hymnal notes are not compared. Each is a quiet banner on the tabs it affects (`PlanNotice`), as `catalogError` is.
- `usePlan()` returns `{ plan, serviceType, items, catalog, suggestions, catalogError, selectionsError, scheduleSettings, settingsError, hymnNoteStatus, scheduleItems, saves, chooseOption, setCustomText, retrySave }` and throws outside a provider, so only components under `[planId]/` may call it. `chooseOption`, `setCustomText` and `retrySave` are stable callbacks.
- The layout keys the provider by `serviceTypeId/planId`, so each plan has its own store.

**URL state** (`app/hooks/useUrlState.ts`, `lib/urlState.ts`). Shareable view state (a filter, sort or page number) lives in the query string.

- Read it with `useSearchParams()`, which `useUrlState()` returns as `searchParams`. The server's `searchParams` prop is fixed for the render that produced it and misses shallow updates.
- Write it with `setSearchParams({ key: value or null }, { history: "replace" | "push" })`. That calls `history.replaceState` or `pushState` with a `null` state, which Next patches into the router, so there is no server round trip. Use `replace` for filters and sorting and `push` for pagination, so Back steps through pages. A call that would not change the query string does nothing.
- Call it only from event handlers. A mount-time effect can run before Next installs its history patch.
- A text field whose value lives in the URL, such as a search, shows what is typed from local state and follows the URL only when it changes without typing: `SearchBox` (see [Shared UI](#shared-ui)). Fed straight from `useSearchParams()`, it would drop keystrokes.
- `parsePage(value, totalPages)` and `parseEnum(value, allowed, fallback)` turn what is read into safe values, so a bad `?page=` or `?book=` falls back instead of breaking.
- A parameter that changes what the server fetches does not belong here: navigate with `<Link>` or `router.push`, and read it from `searchParams` on the server.

## Conventions

1 to 14 are the conventions the routing migration set; 15 and 16 are lessons learned during it; 17 onward come with the song catalog.

1. **Routes.** A route is a folder under `app/(app)/`. `page.tsx` and `layout.tsx` are server components, and client components are for interaction only. Type route props with the generated `PageProps<"/plans/[serviceTypeId]/[planId]">` and `LayoutProps<…>` (available after `next typegen`; route groups are not part of the key; `params` is a Promise).
2. **Hrefs.** Internal hrefs come only from the builders in `lib/routes.ts`. Each returns a template literal `as const` (`` `/plans/${st}/${id}` as const ``). Annotating the return type as `Route` fails to compile for dynamic paths. `typedRoutes: true` checks every `<Link href>` against the real routes. `NAV_ITEMS`, `PLAN_TABS` and `CATALOG_SECTIONS` live there too, and links out to PCO's web app come from `pcoWebUrls`. A builder that takes a query string takes it as options and encodes it with `URLSearchParams` (`catalogFiltered({ linked: "no" })`, `catalogSongNew({ pcoSongId, returnTo })`).
3. **Data access.** Server pages and layouts get data from `lib/queries/*` and use `parsePcoId` and `orNotFound` from `@/lib/pco`. Nothing fetches `/api/*` from the server: the request passes through the middleware without cookies and is redirected to sign-in. Client components receive data as props or from a provider and never call PCO.
4. **Types.** Domain types live only in `lib/domain.ts`, and raw PCO shapes only in `lib/pco/resources.ts`. UI state such as `ScheduleSelection` is its own type, never a field of a domain type.
5. **URL state.** Shareable view state lives in the URL, through `useUrlState` (see State). A component that reads `useSearchParams()` sits under `<Suspense>`.
6. **Page chrome.** Every page renders `<PageHeader title description breadcrumbs actions>` (the page's one `<h1>`) and exports `metadata` or `generateMetadata`.
7. **Boundaries.** A segment that fetches gets `loading.tsx`, `error.tsx` and `not-found.tsx`, built from the shared `LoadingState`, `ErrorState` and `EmptyState`. When a *layout* fetches, those files go one segment up. Keep an error boundary below any stateful provider. A page that reads the database and needs Planning Center only for a part of it streams that part under its own Suspense boundary, with a deadline (`withDeadline`), instead of waiting in a `loading.tsx` (Settings).
8. **Validation.** Every dynamic param passes through the parser for its kind (convention 19), as `parsePcoId(x) ?? notFound()`, and every PCO fetch in a page or layout through `orNotFound(…)`. A catalog read that finds no row returns null, so it ends in `?? notFound()` too.
9. **Pure logic.** Logic lives in `lib/` with tests. Components stay thin and prop-driven, and a small route-level connector (`CopyrightTab`, `ScheduleTab`) reads the provider and passes props down. Define components at module scope, never inside another component: an inline definition is a new component type on every render, so React remounts it (that is how the custom-text box used to lose focus).
10. **Dates.** A calendar date from PCO is formatted from its `YYYY-MM-DD` part with UTC math (`lib/format.ts`), so the text is the same on the server and in every time zone; the date part of `sort_date` is the org-local date. A true instant such as `computedAt` renders through `<LocalTime iso>`, in the viewer's time zone. It uses `useSyncExternalStore` because React 19 keeps the server's text after a suppressed hydration mismatch.
11. **No prerendering.** Keep `force-dynamic` on the `(app)` layout, and never call `connection()` inside `lib/pco`.
12. **Metadata never throws.** `generateMetadata` re-runs on every navigation, refresh and production prefetch, and a throw breaks the page. Keep it cheap and total: use `getPlanLabels()` (cached for 5 minutes, never throws, falls back to "Plan") and look up only keys that passed `parsePcoId`. Catalog pages use `getCatalogSongLabel`, `getCatalogTuneLabel`, `getCatalogBookLabel` and `getCatalogImportRunLabel`, which take the raw param, parse it themselves, and fall back to a generic word when it is invalid, unknown or the read fails.
13. **Prefetch.** Rows that link to data-heavy routes use `prefetch={false}`. In production `<Link>` prefetches the rows on screen, so 25 rows would each trigger a metadata lookup and PCO calls. All users share one PCO budget, advertised as 100 requests per 20 seconds and lowered by PCO at times. `PlanItemsTable` rows are the exception and prefetch on purpose: an item page reads the plan the `[planId]` layout already fetched, and its metadata only reads labels `getPlanLabels()` has cached. Links to catalog pages may keep the default, since those pages read only the local database and a prefetch costs no PCO request: the songs and tunes lists and a song's cards do, each with a comment saying why. A page whose rows run to the hundreds turns it off anyway (a book's entries), and so do the books and import lists, and Reconcile's links to the new-song form, which loads every hymn and tune.
14. **Error retry.** `ErrorState` owns the retry: pass it the boundary's `reset` and it runs `startTransition(() => { router.refresh(); reset(); })`. `reset()` alone re-renders with what the client already has, so a failed server render would not run again. Use `onRetry` for a failure outside a boundary. Client code never calls `notFound()`; it renders an inline `EmptyState`.
15. **Server actions.**
    - An action is a public POST endpoint. Call `auth()` first and throw without a session; the middleware alone is not enough. Parse every id it is given, in a form field or an argument, with the parser for its kind (convention 19), and answer one that is not with a message, not a throw.
    - **A module-level cache or connection that an action touches must live on `globalThis`.** A client-imported action is compiled in Next's separate "action-browser" layer, so plain module state gets two instances: an action would change one while the page kept reading the other. `getDb()` (`lib/db/index.ts`), the pacer and the jobs' runs in progress live there, and their tests load two copies of the module.
    - A form's action returns a `FormState` (`lib/forms.ts`), to `useActionState` with `ui/SubmitButton` as its button, or to a form that calls it from `onSubmit` (below): see [Add a server-action form](#add-a-server-action-form). It writes in one `withTransaction`, revalidates every page that shows what it changed (a link: the `/catalog` layout, and the `/plans` layout or, for the Schedule tab's Link, its plan's), then redirects (after creating something) or returns. Call `redirect()` outside any `try`: it works by throwing.
    - **Pending state, and what a navigation waits for.** React runs a form's action (`<form action>`, `useActionState`) inside a transition, as it does anything passed to `startTransition`, and a navigation (a link, Back) waits until that transition ends: with an action slowed to about 3 s, a click in the catalog's section nav took 3.3 s instead of 60 ms.
        - **What counts is the action's total time**, and that includes rendering again every page it revalidates that is on screen. `revalidatePath` makes the action's response render the calling page again, and the transition, with `SubmitButton`'s pending state, lasts until that render is done. On Settings, whose cards read Planning Center, a save to the local database showed "Saved." after 8.4 s when Planning Center was slow.
        - **`<form action>` and `useActionState` are fine only when neither the action nor any page it revalidates that is on screen waits on Planning Center**, or on anything else slow. Then `SubmitButton` shows that it is pending. These qualify:
            - the Import pages' Preview, Apply and Discard;
            - the new-song form;
            - Reconcile's Link, Ignore, Undo and Unignore, and the song page's Unlink.

          They would read Planning Center only for a song the mirror lacks, and their pages read only the database and show only songs the mirror has (the new-song form's page mirrors its song first).
        - **Anything else is called from an event handler**, with its pending state in `useState`, never `useTransition`, so a navigation never waits for it:
            - Sync now (Settings and Reconcile), the model;
            - the plan page's Link, each Schedule-tab save, Sync hymn notes' preview and confirm, and Email this plan's preview and Send;
            - the song page's Save credits, Save tags, Create in Planning Center, the upcoming plans that Add to a plan reads, and its Add;
            - Settings' forms, which call their actions from `onSubmit` with their own `SaveButton` (`useSettingsForm`).

          The action's promise resolves when the action returns. A revalidated page's Planning Center parts update when their reads are back.
        - **A navigation drops an action still running.** In Next 15.5.9 a navigation that starts while a server action is pending marks the action discarded, so its result is never applied, and refreshes the whole destination page once it is done (`next/dist/client/components/app-router-instance.js`, lines 131-141). The action still runs on the server; what is lost is its own revalidation, replaced by a full render. So an action that runs as someone leaves a page costs the next page a full render: `CustomTextInput` saves on blur, which a link's mousedown triggers, so typing custom text and then clicking a link costs one more full Planning Center read of the page the link opens.
    - A failed refresh keeps the previous data: `TtlCache.refresh` replaces the stored value only when the load succeeds.
16. **Non-ASCII in source.** Write non-ASCII characters in regex character classes and matching or normalization keys as `\u` escapes (`/[\u2018\u2019]/`), in tests too. Literal curly quotes were turned into straight quotes, and `normalizeTitle` silently stopped handling them while the test meant to cover it used straight quotes as well. Literal typographic characters in UI strings (·, ©, …) are fine.
17. **Database.** Only `getDb()` opens the database (tests use `openTestDb()`), and pages reach it only through `lib/queries/*`. SQL lives in `lib/db/<area>.ts`, in named functions that take `db` first, tested on `:memory:`. A write of more than one statement runs in `withTransaction` with a synchronous function. Migrations are append-only: never edit, reorder or remove a committed one; change the schema with a new migration. Use only the `node:sqlite` API of Node 22.13. See [Database](#database).
18. **Writes to Planning Center.** Only `lib/pco/writes.ts` sends a POST, PATCH or DELETE, and only through `pcoMutate` with a body from `jsonApi`. The barrel exports its functions but not that plumbing, so app code writes through a `lib/queries` function. That function reads afresh before it writes (refresh-before-write), writes only what the person previewed and confirmed, and records a `write_log` row for each write, made or refused. Sync jobs pass `paced: true` on every PCO call; page loads and actions someone is waiting on never do, and every write so far is one. Sending an email (`lib/email.ts`) is the app's one other outbound write, and is logged the same way (`kind: "email"`, never the email's text). Never hard-code PCO's rate limits: the pacer learns them from every response. See [Writes to Planning Center](#writes-to-planning-center) and [Add a PCO write](#add-a-pco-write).
19. **A parser per ID kind.** Every ID or code that comes from a URL or a form (a route param, a query parameter, a form field) passes through the parser for its kind before it reaches a route builder, a query or an action:
    - `parsePcoId` (`@/lib/pco`) for Planning Center IDs;
    - `parseCatalogId` (`lib/catalog/ids.ts`) for catalog IDs: songs, tunes, hymns, books (by id, in a form) and import runs;
    - `parseBookCode` (`lib/catalog/ids.ts`) for book codes.

    Each returns the checked value or null, so a page writes `parseCatalogId(params.songId) ?? notFound()` and an action answers null with a message. Never pass an unparsed value to a builder or a query: builders interpolate without encoding, and queries trust the keys they are given. A new kind of ID gets its own parser, with tests, beside these.
20. **Links in running text are underlined.** A link inside a sentence or a line of text is underlined as well as coloured: blue against the grey or black around it is under the 3:1 contrast a link needs to be told apart by colour alone (axe's `link-in-text-block`). A link that stands alone, such as a card's heading, a nav item or a to-do's action, needs no underline. Settings, checked with axe at 1280 and 320 px in light and dark mode, has no violations.

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

### Add a catalog page

Example: a Hymns section, with a list at `/catalog/hymns` and a page per hymn at `/catalog/hymns/{hymnId}`. Catalog pages read the local database through synchronous queries, so they differ from a top-level page in three ways: the catalog's ID parsers, the `(list)` group, and no `loading.tsx` on a detail page. The catalog layout gives every page the section nav and the font, and leaves the width to the page: wrap the header and content in `w-full max-w-4xl mx-auto`, the width of the section nav, and go wider only for content that needs it, as the import report's `max-w-5xl` does under a header as wide as the nav.

1. **Read.** Put the SQL in `lib/db/catalog.ts`: functions that take `db` first and label any entry they return, tested on `openTestDb()` with the seed builders (`seedBook`, `seedHymn`, `seedSong`, …). Add the types to `lib/domain.ts` under "Catalog". Expose the reads in `lib/queries/catalog.ts`: `getCatalogHymns()`, `getCatalogHymn(id)`, which returns null when there is no such hymn, and a label for `generateMetadata` built on `labelOr`, which parses the param itself and never throws:

   ```ts
   export function getCatalogHymnLabel(hymnId: string): string {
       return labelOr(hymnId, parseCatalogId, (id) => findHymnLabel(getDb(), id), "Hymn");
   }
   ```

2. **Routes.** Add `catalogHymns: () => "/catalog/hymns" as const` and ``catalogHymn: (hymnId: number) => `/catalog/hymns/${hymnId}` as const`` to `routes`, and, for a section the section nav shows, an entry to `CATALOG_SECTIONS`: `{ segments: ["hymns"], label: "Hymns", href: routes.catalogHymns() }`, where `segments` is what `catalogLayoutSegment` returns on the section's pages. Extend `lib/routes.test.ts`. `CatalogSectionNav` reads the sections, so there is nothing to edit there.
3. **List page.** Create `app/(app)/catalog/hymns/(list)/page.tsx` and `loading.tsx`; the `(list)` group keeps the loading state off the hymn pages (see [Why the boundaries sit where they do](#why-the-boundaries-sit-where-they-do)). The page reads the rows, trims them to what the list shows (`toCatalogTuneRow` is the model), and renders `PageHeader` (breadcrumbs Catalog › Hymns) above either an `EmptyState` linking to `routes.catalogImport()` or the client view under `<Suspense>`. The view keeps its search, filters and page in the URL through `useUrlState` (replace for filters, push for pages), with `SearchBox` for the search field and the narrowing in a pure module in `lib/catalog/` with tests (`filter.ts`, `tuneFilter.ts`).
4. **Detail page.** Create `app/(app)/catalog/hymns/[hymnId]/page.tsx`, with a `not-found.tsx` beside it (an `EmptyState` linking back to the list) and no `loading.tsx`: the read is local, so a link keeps the previous page on screen until this one is ready.

   ```tsx
   type CatalogHymnPageProps = PageProps<"/catalog/hymns/[hymnId]">;

   export async function generateMetadata({
       params,
   }: Pick<CatalogHymnPageProps, "params">): Promise<Metadata> {
       const { hymnId } = await params;
       return { title: getCatalogHymnLabel(hymnId) }; // never throws
   }

   export default async function CatalogHymnPage({ params }: CatalogHymnPageProps) {
       const hymnId = parseCatalogId((await params).hymnId) ?? notFound();
       const hymn = getCatalogHymn(hymnId) ?? notFound();
       return (
           <div className="w-full max-w-4xl mx-auto">
               <PageHeader
                   title={hymn.title}
                   breadcrumbs={[
                       { label: "Catalog", href: routes.catalog() },
                       { label: "Hymns", href: routes.catalogHymns() },
                       { label: hymn.title },
                   ]}
               />
               <HymnDetailView hymn={hymn} />
           </div>
       );
   }
   ```

   A book's page takes its code through `parseBookCode` instead (convention 19).
5. **Components** go in `app/components/Catalog/Hymns/`. Display stays in server components (cards built on `CatalogCard`, labels shown with `EntryLabels`), and client components are only for interaction. List rows are stretched links (see [Why the boundaries sit where they do](#why-the-boundaries-sit-where-they-do)). Links to catalog pages may keep the default prefetch, with a comment saying why (convention 13).
6. **Check** the tests and the four gates (every new route is ƒ), then, in the browser, the list's URL state through Back and forward, the 404s for `/catalog/hymns/abc` and `/catalog/hymns/999999`, dark mode and 320 px.

### Add a server-action form

Example: the new-song form at `/catalog/songs/new` (`SongForm`, `createSongAction`), the model for the catalog's forms. The action is a server action the form passes to `useActionState`, and every decision lives in `lib/` with tests.

Use `useActionState` only when neither the action nor any page it revalidates that is on screen waits on Planning Center (convention 15). Otherwise keep steps 1 to 4, and have the form call its action from `onSubmit`, with its state and pending flag in `useState` and a button that takes `pending` as a prop and its classes from `ui/buttonClasses`, as Settings' forms do (`useSettingsForm`, `SaveButton`). Keep the fields controlled, since nothing resets them then.

1. **Fields and validation** (pure), beside the area's other modules, as `lib/catalog/validation.ts` is: the field names (`NEW_SONG_FIELDS`), the parts that show one error each (`NewSongPart`), the typed input the form describes, and a validator that reads the `FormData` with the readers of `lib/forms.ts` and returns `{ ok: true, input }` or `{ ok: false, fieldErrors }`, with every part's problem at once. It checks only what needs no database. Test it with a `FormData` built in the test.

   ```ts
   const title = cleanText(readString(formData, "hymnTitle")); // trimmed text, "" when missing
   const number = readOptionalPositiveInteger(formData, "number", { max: ENTRY_NUMBER_MAX });
   // { ok: true, value: null } when blank, { ok: false } when it is not a whole number
   const hymnId = readId(formData, "hymnId", parseCatalogId); // an id, through its parser
   ```

2. **The write** (`lib/db/<area>.ts`, tested on `openTestDb()`): one function that takes `db` and the typed input and does everything in one `withTransaction`. It collects the problems the database's rules raise before it writes (a name or a number taken), each with the part of the form it is about and the row it clashes with, and returns them as a value. A refusal found after writing (a link refused) is thrown inside the transaction, so it rolls back, and caught outside it (`createCatalogSong`).
3. **The query** (`lib/queries/<area>.ts`): what the page shows, with the form's first values (`getNewSongFormData`), and the write, after any Planning Center read it needs (`createSong` mirrors the song to link first). Test it with only `getDb` mocked.
4. **The action** (`app/(app)/…/actions.ts`, `"use server"`):

   ```ts
   export async function createSongAction(
       _state: NewSongFormState, // FormState<NewSongPart | "link">
       formData: FormData
   ): Promise<NewSongFormState> {
       await requireSession(); // auth(), and throw without a session
       const values = readValues(formData, NEW_SONG_FIELDS);
       const checked = validateNewSong(formData, getNewSongBooks());
       if (!checked.ok) {
           return formError(FIX_FIELDS_MESSAGE, { fieldErrors: checked.fieldErrors, values });
       }
       let result: CreateSongResult;
       try {
           result = await createSong({ ...checked.input, pcoSongId });
       } catch (error) {
           console.error("Failed to add a catalog song:", error);
           return formError(FORM_FAILURE_MESSAGE, { values });
       }
       if (!result.ok) {
           return formError(FIX_FIELDS_MESSAGE, { fieldErrors: problemErrors(result), values });
       }
       revalidatePath(routes.catalog(), "layout");
       redirect(routes.catalogSong(result.songId)); // outside the try: redirect() throws
   }
   ```

   A field error may link to what it clashes with, an href built by `lib/routes.ts` (`{ message, link: { href: routes.catalogSong(id), label } }`). A hidden id from the page goes through its parser like any other, and a path to go back to through `safeCallbackUrl` (`returnTo`). An action that creates nothing returns `formSuccess(message)` instead of redirecting.
5. **The form** (`app/components/<Area>/`, a client component):

   ```tsx
   const [state, formAction] = useActionState(createSongAction, IDLE_FORM);
   return (
       <form action={formAction}>
           {state.status === "error" && (
               <p key={formStateKey(state)} role="alert">{state.message}</p>
           )}
           {/* the fields; under each part: */}
           <FieldErrorText id="hymn-error" error={fieldErrorOf(state, "hymn")} />
           <SubmitButton pendingLabel="Adding the song…">Add song</SubmitButton>
       </form>
   );
   ```

   Key the alert with `formStateKey(state)`, which is new for every response: screen readers announce an alert when it appears or its text changes, so a refusal repeated word for word on the next attempt would otherwise be silent. A part's error describes whichever of its controls is active, so it is heard wherever focus lands (a fieldset's own `aria-describedby` is not enough): a text or search field (with `aria-invalid`), the Change button of an option chosen from a list, and the part's mode buttons (`Segmented`'s `describedBy`). **React resets a form after every action**, refused or not: each field goes back to its default value. Keep text fields controlled (React keeps a controlled field's default in step with its value), or give uncontrolled ones `defaultValue` from `state.values`. React does not do that for radio buttons or a `<select>`, so choose modes and books with buttons (`ui/Segmented`) and post them, and chosen ids, in hidden inputs, which a reset leaves alone. A part that shows and hides keeps what was typed in the form's state, not in the fields.
6. **Rows that act, then leave** (Reconcile): a small form per button with the row's hidden ids, sharing the row's `useActionState`, each with its own `SubmitButton` (`variant="secondary"` for the quieter one). A row that leaves the list on success hands focus on and says what was done (`useRowNotice`); a client component that outlives its content's swap does the same (`PcoLinkCard`).
7. **Tests** of the action mock `@/auth`, `next/cache`, `next/navigation` (with a `redirect` that throws, as the real one does) and the query module: no session throws before anything is read; ids that are not ids, field errors and refusals come back as states with what was posted; a failure is logged and gives `FORM_FAILURE_MESSAGE`; success revalidates and redirects. See `app/(app)/catalog/songs/new/actions.test.ts`.
8. **Check** in the browser that a refusal shows above the form and on its part, keeps what was typed, leaves focus on the button and is announced again when repeated, that success lands where it should, and the form in dark mode and at 320 px.

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

### Add a PCO write

Example: the hymnal notes (`createItemNote` and its siblings, `syncHymnNotes`, Sync hymn notes), the model for every write. A write changes the church's real data, so it is previewed, confirmed, made from fresh data, and logged.

1. **The write** goes in `lib/pco/writes.ts`, the only module that writes (convention 18). Write one function per write. It takes its ids as primitives and passes each through `assertPcoId` before it builds the path. It sends one request through `pcoMutate` with a body from `jsonApi`, unpaced, since someone is waiting. It returns what changed: the resource as a domain type, through a mapper, or the id it deleted, since PCO answers a DELETE with 204 and no body.

   ```ts
   export async function updateItemNote(
       serviceTypeId: string,
       planId: string,
       itemId: string,
       noteId: string,
       content: string
   ): Promise<ItemNote> {
       const path = `${itemNotesPath(serviceTypeId, planId, itemId)}/${assertPcoId(noteId)}`;
       const response = await pcoMutate<PcoSingleResponse<PcoItemNoteResource>>(
           "PATCH",
           path,
           jsonApi("ItemNote", { content })
       );
       return noteFrom(response, path); // throws when PCO sent no note back
   }
   ```

   Export it from the barrel, never `pcoMutate`. Test it in `lib/pco/writes.test.ts` with routes keyed by method (`` [`PATCH ${url}`] ``): the body (`calledRequests`), `no-store`, the auth header, a 422's `PcoValidationError` with its `details`, and no request at all for an invalid id.
2. **What to write** is pure logic in `lib/<area>.ts`, with tests: a diff from what Planning Center has now to what it should have (`diffHymnNotes`), shared by the preview and the write. Decide what the app may touch and stay inside it. The hymnal notes never touch another category, and delete only notes the write log shows the app created.
3. **The orchestration** goes in `lib/queries/<area>.ts`. A preview reads and diffs, and writes nothing (`previewHymnNotes`). The write (`syncHymnNotes`):
   - **reads afresh first** (refresh-before-write), with the getter's uncached twin (`fetchPlanItems`, not the `cache()`d `getPlanItems`, whose result a page rendered earlier in the request may hold), and computes the diff again;
   - **writes only what the person confirmed**: it takes the preview's items back and writes a part only when its fresh diff matches what was previewed (`matchesPreview`), reporting any other part `changed`, with nothing written, so a change made in Planning Center since the preview is never overwritten unseen;
   - refuses with a message, writing nothing, when it cannot go ahead: a missing or doubled category, or settings it cannot read (it never writes with the defaults);
   - **runs one at a time for the same target**: a second call while one runs is refused (`busy`), not joined, through a map of the writes in progress kept on globalThis (convention 15);
   - makes the writes one at a time, unpaced, and **records a `write_log` row for each**, made or refused: `recordWrite(db, { kind, target, ok, payload, result })`, with what was asked for and what changed, or Planning Center's error (with `PcoValidationError`'s `details` for a 422). A new kind joins `WRITE_LOG_KINDS` and needs no migration. A row that cannot be recorded is logged, and never stops the writes;
   - goes on after a failed write where that is safe (the next item), but **stops at a 429** the client did not retry, reporting the rest `not-attempted`, since the same limit would refuse them; and returns each part's outcome.

   Test it with a stubbed fetch and only `getDb` mocked: the fresh read through the uncached getter, the writes in order, a log row for each (a 422 too), a refusal that writes nothing, a changed part, a 429, and a second call while one runs (load a second copy of the module to show the two see each other).
4. **The actions** go in the page's `actions.ts`, one for the preview and one for the write. Each checks the session, parses every id (convention 19), and calls its query in a `try`; a failure is logged and comes back as a message. The write's action also parses the preview it is sent back, which comes from a browser, with caps on its size (`lib/previewedHymnNotes.ts`). After writing, the action revalidates the pages that show what changed (`revalidatePath(routes.plan(st, plan), "layout")`) and returns what happened. Test them as the plan's `actions.test.ts` does.
5. **The UI** says plainly what the write does, previews first, confirms in a `ui/Dialog` that cannot be dismissed while the writes run, then shows the results, failures first (`SyncHymnNotesAction`). The browser can still close the dialog (see `Dialog` in [Shared UI](#shared-ui)), so keep `open` in step in `onClose` and open the dialog again when the results come. Both actions wait on Planning Center, so they are **called from event handlers, with their state in `useState`**: never `<form action>`, `useActionState` or `useTransition` (convention 15).
6. **Check** in the browser against a fake Planning Center that answers the writes (see Testing), never against the real one, and see the rows on Settings' Recent writes card.

A write to one target that the person typed or picked and confirms themselves (a Save, or a dialog that names the song or the plan) needs no preview computed on the server. The song page's writes (`saveSongCredits`, `saveSongTags`, `createSongInPlanningCenter` and `addSongToPlan` in `lib/queries/pcoSongs.ts`) read afresh, write, update the mirror, log, and return a refusal as a value, and their buttons call the actions from clicks. Two more rules come with them. **A write that cannot be undone is never retried**: once a song exists, a later failure is a warning, since creating it again would make a second one. And **an action whose answer may be lost** (the network) **says that it is not known whether the write happened, and where to look**, instead of inviting a retry (`createInPlanningCenterAction`, `addSongToPlanAction`, `sendPlanEmailAction`).

### Add a setting

Example: the CCLI license number (`ccliLicenseNumber`), which ends every copyright block.

1. **The registry** (`lib/settings.ts`) gets the setting in four places, and TypeScript requires each of them:
   - its key and type, in `AppSettings`;
   - its default, in `DEFAULT_SETTINGS`. **The default reproduces today's output**, so nothing changes until someone saves;
   - its parser, `(value: unknown) => SettingParse<T>`, which takes what a form posts and what is stored (JSON), and says why it refuses, in words fit to show beside the field;
   - its entry in `SETTINGS`.

   ```ts
   function parseCcliLicenseNumber(value: unknown): SettingParse<string> {
       if (typeof value !== "string") {
           return refuse("The CCLI license number must be text.");
       }
       const text = value.trim();
       if (text === "") {
           return refuse("Enter the CCLI license number.");
       }
       if (!/^[0-9]+$/.test(text) || text.length > CCLI_MAX_DIGITS) {
           return refuse(`A CCLI license number is digits only, at most ${CCLI_MAX_DIGITS} of them, such as 1564484.`);
       }
       return { ok: true, value: text };
   }
   // in SETTINGS:
   ccliLicenseNumber: { defaultValue: DEFAULT_SETTINGS.ccliLicenseNumber, parse: parseCcliLicenseNumber },
   ```

   Test the parser and the default in `lib/settings.test.ts`.
2. **Reading** it needs nothing more. `getSettings()` returns it, stored where valid and else the default, and **never throws**: without a database it gives the defaults and the reason. A stored value that no longer parses falls back to the default and shows on Settings as an issue.
3. **Following** it: code that uses a setting takes it as an argument, never reads it itself, so pure modules stay pure. A pick type beside the registry says what each reads (`CopyrightSettings`, `HymnNoteSettings`), and a page's query passes it on (`getPlanDetail`'s `scheduleSettings`). Thread it through in one commit whose tests show that the default leaves the output as it was (the existing assertions hold), with new tests for other values.
4. **Editing** it:
   - add a field to the form of the card it belongs to, named for its key, in `lib/settingsForms.ts`. The form's reader parses it with the registry's parser and collects every field's problem at once;
   - add its words and preview to `lib/settingsText.ts`, where `SETTING_DESCRIPTIONS` names it and its card for the issues;
   - the card's action saves through `saveSettings`, which parses again and writes all or none, and revalidates every page the setting changes (`revalidateSettingsPages`, or the narrower sets of the credit and email cards);
   - the form calls the action from `onSubmit` (convention 15);
   - a setting that is a list is still edited through the form's flat fields: the email recipients are one text area, a line each (`splitRecipients`), and the credit roles are rows whose fields are numbered (`lib/creditRows.ts`);
   - when a setting changes data that is derived from it, the card's action does the follow-up after it saves and says what it did (`saveCreditsAction`, then `rederiveAllCredits`).
5. **Check** that the four gates pass with the default in place, then save a value and see each page that follows the setting change.

## Testing

- **No jsdom: keep logic in `lib/`.** `npm test` runs `vitest run` over `**/*.test.ts` in a `node` environment (`.claude/**` is excluded: agent worktrees hold full repo copies). There are no component tests and no E2E harness, so anything worth testing is a pure function in `lib/`, and components stay thin and are checked in the browser.
- **Characterization tests.** Before moving or changing logic, pin what it does today, quirks included (a copyright that already starts with © gets a second ©). Move the logic with the tests green, then change behavior in its own commit, which flips exactly the assertions it changes. See `lib/copyright.test.ts`, `lib/serviceSchedule.test.ts` and `lib/scheduleSelections.test.ts`.
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
- **Signed-in pages without Google.** Run the app with its own `.env.local`: a throwaway `AUTH_SECRET`, an allowed address, and `DATABASE_PATH` and `DATABASE_BACKUP_DIR` in a scratch folder. Mint a session cookie with `encode` from `@auth/core/jwt` (`salt` is the cookie's name, `authjs.session-token` over http) and give it to the browser. Fake Planning Center with a script loaded through `NODE_OPTIONS=--require` (or `--import`, for an ES module) that replaces `fetch` for `https://api.planningcenteronline.com/` and leaves every other URL alone, so the pages and the song sync read canned data. Seed the catalog through `/catalog/import`. Check anything that writes to Planning Center against the fake, which answers or refuses each write, never against the real one. The real API is for read-only checks, with its credentials read into the server's environment from `.env.local` and never printed. Check email the same way: point `SMTP_URL` (`smtp://127.0.0.1:<port>`) and `EMAIL_FROM` at a small SMTP server of your own on 127.0.0.1 that takes every message and writes it to a file (and can refuse a recipient, answer slowly or reject the message, so that each outcome shows), and give the settings made-up recipients: never a real mail server or real addresses. The unit tests give `sendEmail` a stand-in transport instead.
