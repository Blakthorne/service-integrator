# service-integrator

A web app that integrates with Planning Center's Services API to aggregate data and generate song copyright and service-schedule text in the format I want, to keep each song's hymnal numbers, credits and tags in Planning Center, and to email a plan's songs to the staff.

- **Dashboard** (`/`): each service type's next plan, with its songs' hymnal numbers and the state of their hymnal notes in Planning Center, and what needs doing.
- **Plans** (`/plans`): every plan, grouped by date. A plan shows its items, a Copyright Information tab and a Service Schedule tab (each with a "Copy All" button), and each item has its own page with the song's details. The Service Schedule tab takes each song's hymnal numbers from its catalog song, links a song that has none in one click, and saves its choices per plan. **Sync hymn notes** writes each song's numbers to an item note in Planning Center for the musicians, after a preview, and **Email this plan** previews and sends the plan's schedule and its songs' copyright text to the staff.
- **Catalog** (`/catalog`): the hymnals' songs (Rejoice Hymns and Great Hymns of the Faith), searchable, filterable by book, by Planning Center link, by Planning Center tag and to the songs never scheduled, and exportable as CSV; pages for each song, tune and book; Reconcile (`/catalog/reconcile`), which links each Planning Center song to its catalog song; and a form to add a song. A song's page edits the credits (who wrote its words and music, kept in a labelled form in Planning Center's author field) and the tags of the Planning Center song it is linked to, and adds that song to an upcoming plan; a song with no Planning Center song can be created there, with its credits and an optional CCLI number.
- **Settings** (`/settings`): the CCLI license number, the credit roles and the phrases the copyright text prints for them, the schedule text's header labels and number separator, the hymnal notes' category, and the plan email's recipients and subject; what the app has written to Planning Center and the emails it has sent; the hourly Planning Center song sync, with Sync now; and the database and its backups.

Sign-in is with Google and limited to a short list of allowed email addresses.

## Getting started

Requires Node 22.13 or later and npm. Create `.env.local` with the variables below, then:

```sh
npm ci
npm run dev
```

The app is at http://localhost:3000.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Build for production |
| `npm start` | Serve the production build |
| `npm test` | Run the unit tests (Vitest); `npm run test:watch` re-runs them on change |
| `npm run lint` | Lint with ESLint (`next lint`) |
| `npm run typecheck` | Clear stale route types, run `next typegen`, then `tsc --noEmit` |

## Environment variables

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Auth.js session secret |
| `AUTH_URL` | The app's public URL |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth client used for sign-in |
| `ALLOWED_EMAIL_1`, `ALLOWED_EMAIL_2`, `ALLOWED_EMAIL_3` | Google accounts allowed to sign in (up to three) |
| `PLANNING_CENTER_ID`, `PLANNING_CENTER_TOKEN` | Planning Center API credentials |
| `DATABASE_PATH`, `DATABASE_BACKUP_DIR` | The SQLite database file and its backup folder (default `./data/service-integrator.sqlite` and `./data/backups`) |
| `SMTP_URL`, `EMAIL_FROM` | Optional, for Email this plan: the SMTP server and its login as a URL (`smtps://user:password@host`, with `@` and `:` in the login percent-encoded), and who the email is from. Settings says which are missing |

## Documentation

[docs/architecture.md](docs/architecture.md) explains how the app is organized (routes, data layer, database, state), the conventions to follow, and step-by-step recipes for adding a page, a catalog page, a server-action form, a plan tab, a Planning Center resource, a Planning Center write or a setting.
