# service-integrator

A web app that integrates with Planning Center's Services API to aggregate data and generate song copyright and service-schedule text in the format I want, to keep each song's hymnal numbers, credits and tags in Planning Center, and to email a plan's songs to the staff.

- **Dashboard** (`/`): each service type's next plan, with its songs' hymnal numbers and the state of their hymnal notes in Planning Center, and what needs doing; then the song history's figures: the songs sung this year and how much of each hymnal was sung in the last five years and ever.
- **Plans** (`/plans`): every plan, grouped by date: the upcoming plans first, then the past ones, with Jump to month. A plan shows its items, a Copyright Information tab and a Service Schedule tab (each with a "Copy All" button), and each item has its own page with the song's details. The Service Schedule tab takes each song's hymnal numbers from its catalog song, links a song that has none in one click, and saves its choices per plan, and flags a song that was sung in the last few weeks ("Sung Sep 20 (2 weeks ago)", with a link to that plan). **Reorder items** puts a plan's items in another order in Planning Center, after a preview. **Sync hymn notes** writes each song's numbers to an item note in Planning Center for the musicians, after a preview, and **Email this plan** previews and sends the plan's schedule and its songs' copyright text to the staff.
- **Catalog** (`/catalog`): the hymnals' songs (Rejoice Hymns and Great Hymns of the Faith), searchable, filterable by book, by Planning Center link, by Planning Center tag, to the songs never scheduled and to the songs not sung since a date, with each song's last sung date, and exportable as CSV; pages for each song, tune and book, where anything can be edited; Books (`/catalog/books`), where a book is added, put in order or taken out of use; Import (`/catalog/import`), which adds a book's songs from a CSV file and, while the catalog has no books, can seed it from `hymns.json`; Reconcile (`/catalog/reconcile`), which links each Planning Center song to its catalog song; and a form to add a song. A song's page lists every plan it was sung in (its history), edits the credits (who wrote its words and music, kept in a labelled form in Planning Center's author field) and the tags of the Planning Center song it is linked to, and adds that song to an upcoming plan; a song with no Planning Center song can be created there, with its credits and an optional CCLI number.
- **Reports** (`/reports`): what the church sang, from a copy of every plan's songs that the app reads from Planning Center once a day: the most sung songs of the last 12 months, this year or all time; every song with when it was last sung; and the songs not sung since a date. Each report has the songs' hymnal numbers, links to the songs and Export CSV, and **Sync history now** brings the copy up to date.
- **Settings** (`/settings`): the CCLI license number, the credit roles and the phrases the copyright text prints for them, the schedule text's header labels and number separator, the hymnal notes' category, how many weeks back a song counts as sung lately for the repeat warnings (0 turns them off), and the plan email's recipients and subject; what the app has written to Planning Center and the emails it has sent; the hourly Planning Center song sync, with Sync now, and the daily plan history sync, with Sync history now; the database and its backups; and Export catalog (JSON), the catalog as a file to keep in git.

Sign-in is with Google and limited to a short list of allowed email addresses.

## Books and imports

### Add a book

Catalog › Books › Add a book. Give the book a **code** (a letter, then up to 7 letters, digits, `-` or `_`, such as `CB`; it is the book's address and never changes), a **name** and, if you like, a **short name**, and say whether the book numbers its songs (that never changes either). The **label** is how an entry is named in the schedule text: for a numbered book it has `{n}` where the number goes (`CB-{n}`; left blank, the code and `-{n}`), and a book without numbers, such as a chorus book, labels every entry alike (left blank, with its short name). The form shows a preview of the label. The order on the Books page is the order a song's labels are listed in: use Move up and Move down. A book that is not in use stays browsable, but is left out of the schedule text, the hymnal notes and the songs list's book filter.

### Import a book from CSV

Catalog › Import › Import a book from CSV. Choose the book (add it first if it is not listed) and a CSV file of at most 1 MB, saved as CSV UTF-8, with a header row:

```csv
number,title,tune,variant
12,Amazing Grace,NEW BRITAIN,
13,"Holy, Holy, Holy",NICAEA,
```

A book without numbers has `position` in place of `number`. `tune` and `variant` are optional. A hymn or a tune the catalog has is used as it is, and a new one is added. The preview adds nothing: it lists what the file would add, the problems that block it (a number on two rows, a number the book already has, a row with no title, and so on) and the warnings, row by row. Fix the file and preview it again; Apply is refused while a problem blocks the file, and it adds the rows in one go, with no undo.

### Seed an empty catalog

A new database has no books. Catalog › Import › Preview seed from `hymns.json` plans the church's two hymnals from the hymn data that ships with the app: review its report, then Apply. The button is hidden once the catalog has any books, because Apply refuses then. The seed stays until production has applied it, and can be removed after that.

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

[docs/architecture.md](docs/architecture.md) explains how the app is organized (routes, data layer, database, state), the conventions to follow, and step-by-step recipes for adding a page, a catalog page, a server-action form, a plan tab, a Planning Center resource, a Planning Center write, a setting, a book or a book's CSV import.
