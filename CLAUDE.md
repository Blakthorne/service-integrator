# Service Integrator

Next.js 15 (App Router) app that reads Planning Center Services data, generates song copyright and service-schedule text, writes each song's hymnal numbers back to its plans as item notes, creates and edits songs, credits and tags in Planning Center, and emails a plan's songs to the staff.

## Before you add or change a feature

- Read `docs/architecture.md` first: the route map, the data layer, the conventions and the recipes for adding a page, a catalog page, a server-action form, a plan tab, a Planning Center resource, a Planning Center write or a setting.
- Follow its conventions and recipes rather than inventing new structure. The ones that bite most:
  - Hrefs come only from `lib/routes.ts`. Server pages get data from `lib/queries/*` and never fetch `/api/*`.
  - Validate every ID taken from a URL with the parser for its kind (`parsePcoId`, `parseCatalogId`, `parseBookCode`; convention 19), and import PCO code only from `@/lib/pco`.
  - Keep logic in `lib/` with tests: there is no jsdom or component-test harness.
  - Change the database schema only with a new migration in `lib/db/migrations/`: migrations are append-only, so never edit a committed one (convention 17).
  - A server action calls `auth()` first and parses every id it is given. A form's action returns a `FormState` (`lib/forms.ts`); it writes in one `withTransaction`, then revalidates every page that shows what it changed. Use `<form action>` or `useActionState` (with `ui/SubmitButton`) only when neither the action nor any page it revalidates that is on screen waits on Planning Center; otherwise call the action from an event handler, with its pending state in `useState`. Never `useTransition` (convention 15).
  - Write to Planning Center only through `lib/pco/writes.ts`, from a `lib/queries` function that reads afresh first, writes only what the person previewed and confirmed, never over what the page did not show (the page sends back what it showed; refuse as `changed`, or apply only the person's changes, when Planning Center has something else now), runs one write per target at a time, and records a `write_log` row for every write (convention 18). Check writes against a fake Planning Center, never the real one. Email goes only through `lib/email.ts`, and is logged the same way (kind `email`, never the email's text); check it against a local SMTP server on 127.0.0.1 with made-up recipients, never a real mail server or real addresses.
  - Underline a link inside running text, not just colour it (convention 20).
  - A new setting goes in the `lib/settings.ts` registry, with a default that reproduces today's output, so nothing changes until it is saved.
  - Use `prefetch={false}` on rows that link to data-heavy routes (the plans list does; the items table prefetches on purpose, since that only reads cached labels), never throw from `generateMetadata`, and write non-ASCII characters in regex character classes and matching or normalization keys as `\u` escapes (literal typographic characters in UI strings, such as ·, © and …, are fine).

## Before you commit

- Run all four gates and get them green: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` (every `(app)` route must show as dynamic, `ƒ`). The Testing section of `docs/architecture.md` has the details.
- Use conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`, `build:`, `chore:`), one logical change per commit. A behavior change gets its own commit and flips the test assertion it changes.
- Pushing to `main` deploys to production (`.github/workflows/deploy.yml`).
