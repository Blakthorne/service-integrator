# service-integrator

A simple web app that integrates with Planning Center's public Services API to aggregate data and generate song copyright data in the format I want.

- **Plans** (`/plans`): every plan, grouped by date. A plan shows its items, a Copyright Information tab and a Service Schedule tab (each with a "Copy All" button), and each item has its own page with the song's details. The Service Schedule tab takes each song's hymnal numbers from its catalog song, and links a song that has none in one click.
- **Catalog** (`/catalog`): the hymnals' songs (Rejoice Hymns and Great Hymns of the Faith), searchable, filterable by book, by Planning Center link and to the songs never scheduled, and exportable as CSV; pages for each song, tune and book; Reconcile (`/catalog/reconcile`), which links each Planning Center song to its catalog song; and a form to add a song.
- **Settings** (`/settings`): the app's database and its backups, and the hourly Planning Center song sync, with Sync now.

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

## Documentation

[docs/architecture.md](docs/architecture.md) explains how the app is organized (routes, data layer, database, state), the conventions to follow, and step-by-step recipes for adding a page, a catalog page, a server-action form, a plan tab or a Planning Center resource.
