# Service Integrator

Next.js 15 (App Router) app that reads Planning Center Services data and generates song copyright and service-schedule text.

## Before you add or change a feature

- Read `docs/architecture.md` first: the route map, the data layer, the conventions and the recipes for adding a page, a plan tab or a Planning Center resource.
- Follow its conventions and recipes rather than inventing new structure. The ones that bite most:
  - Hrefs come only from `lib/routes.ts`. Server pages get data from `lib/queries/*` and never fetch `/api/*`.
  - Validate every ID taken from a URL with `parsePcoId`, and import PCO code only from `@/lib/pco`.
  - Keep logic in `lib/` with tests: there is no jsdom or component-test harness.
  - Use `prefetch={false}` on list rows, never throw from `generateMetadata`, and write non-ASCII characters in source as `\u` escapes.

## Before you commit

- Run all four gates and get them green: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` (every `(app)` route must show as dynamic, `ƒ`). The Testing section of `docs/architecture.md` has the details.
- Use conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`, `build:`, `chore:`), one logical change per commit. A behavior change gets its own commit and flips the test assertion it changes.
- Pushing to `main` deploys to production (`.github/workflows/deploy.yml`).
