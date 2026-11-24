# UpgradePilot

UpgradePilot analyses the npm dependencies of a public GitHub repository and produces an upgrade report. It finds what is outdated, how big each jump is, what could break, and what to do about it. Detection and version comparison are deterministic. AI interprets release notes and migration guides on top of that and is optional.

It runs entirely on the Cloudflare Workers Free plan: Workers, D1, Queues, KV, Workers AI and static assets.

> Status: Phase 2 of 5. Scans run end to end: discovery, npm version resolution, upgrade classification and release-note collection, as queued, resumable steps. AI analysis, risk rules, reports and the dashboard are not built yet. See the [implementation plan](docs/ARCHITECTURE.md#implementation-plan).

## Docs

- [Architecture](docs/ARCHITECTURE.md): modules, data flow, scan state machine, API, data model, Free-plan limits
- [Decisions](docs/DECISIONS.md): why each design choice was made, and the implementation log

## Layout

```
apps/api           Cloudflare Worker (Hono): API, scan pipeline, D1 migrations
apps/web           Next.js dashboard, static export (Phase 4)
packages/shared    Zod schemas shared by the API and the UI
docs/              Architecture and decision records
```

## Local setup

Requirements: Node.js 20 or newer. No Cloudflare account is needed to run locally.

```bash
npm install
```

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Optional: put a GitHub token in `apps/api/.dev.vars` as `GITHUB_TOKEN`. A fine-grained token with public-repository read access raises the GitHub limit from 60 to 5,000 requests per hour.

```bash
npm run db:migrate:local -w @upgradepilot/api
```

```bash
npm run dev
```

The API listens on `http://localhost:8787`.

```bash
curl -X POST http://localhost:8787/api/repositories/inspect -H 'content-type: application/json' -d '{"url":"https://github.com/TanStack/query"}'
```

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

## API (Phase 2)

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | App and D1 health |
| `POST /api/repositories/inspect` | Validate a GitHub URL, return repository metadata and branches |
| `POST /api/scans` | Start a scan (`{ "url", "branch" }`, optional `Idempotency-Key` header). Returns 201, or 200 with `reused: true` for a duplicate |
| `GET /api/scans/:scanId` | Status, progress, stage and discovery summary |
| `GET /api/scans/:scanId/dependencies` | Paginated list. Filters: `upgradeType`, `dependencyType`, `riskLevel`, `q`. `sort=name\|upgradeType`, `page`, `pageSize` (max 100) |

Try a scan locally:

```bash
curl -X POST http://localhost:8787/api/scans -H 'content-type: application/json' -d '{"url":"https://github.com/expressjs/express","branch":"master"}'
```

Then poll `GET /api/scans/<scanId>`. `wrangler dev` runs the queue consumer locally. To trigger the recovery sweep by hand, start the dev server with `--test-scheduled` and open `http://localhost:8787/__scheduled`.

Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`.

## Deploying to Cloudflare

Full instructions arrive in Phase 5. The steps so far:

```bash
npx wrangler login
```

```bash
npx wrangler d1 create upgradepilot
```

Copy the printed `database_id` into `apps/api/wrangler.jsonc`, then:

```bash
npx wrangler queues create upgradepilot-scans
```

```bash
npm run db:migrate:remote -w @upgradepilot/api
```

```bash
npx wrangler secret put GITHUB_TOKEN --cwd apps/api
```

```bash
npm run deploy -w @upgradepilot/api
```
