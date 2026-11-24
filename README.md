# UpgradePilot

UpgradePilot analyses the npm dependencies of a public GitHub repository and produces an upgrade report. It finds what is outdated, how big each jump is, what could break, and what to do about it. Detection and version comparison are deterministic. AI interprets release notes and migration guides on top of that and is optional.

It runs entirely on the Cloudflare Workers Free plan: Workers, D1, Queues, KV, Workers AI and static assets.

> Status: Phase 3 of 5. Scans run end to end: discovery, npm version resolution, release notes, security advisories, deterministic risk rules, optional AI analysis, and a report with Markdown and JSON export. The dashboard (Phase 4) and deployment guide (Phase 5) are not built yet. See the [implementation plan](docs/ARCHITECTURE.md#implementation-plan).

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

The API listens on `http://localhost:8787`. `npm run dev` runs Wrangler in local mode, which has no Workers AI, so AI analysis is skipped and reports use the deterministic rules only.

### AI analysis (optional)

Set these in `apps/api/.dev.vars` locally, or as Cloudflare vars and secrets when deployed:

| Setting | Values |
| --- | --- |
| `AI_PROVIDER` | `workers-ai` (default when deployed), `anthropic`, `openai`, or `none` |
| `ANTHROPIC_API_KEY` | Needed for `anthropic`. Default model `claude-opus-5-5` |
| `OPENAI_API_KEY`, `AI_MODEL` | Both needed for `openai` |
| `AI_MODEL` | Overrides the provider's default model |
| `AI_MAX_ANALYSES_PER_SCAN` | Default 10. The Workers AI free tier covers about 27 analyses a day |

To try Workers AI locally, log in and use the remote-AI dev script. It spends your free neurons:

```bash
npx wrangler login
```

```bash
npm run dev:remote-ai -w @upgradepilot/api
```

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

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | App and D1 health |
| `POST /api/repositories/inspect` | Validate a GitHub URL, return repository metadata and branches |
| `POST /api/scans` | Start a scan (`{ "url", "branch" }`, optional `Idempotency-Key` header). Returns 201, or 200 with `reused: true` for a duplicate |
| `GET /api/scans/:scanId` | Status, progress, stage and discovery summary |
| `GET /api/scans/:scanId/dependencies` | Paginated list. Filters: `upgradeType`, `dependencyType`, `riskLevel`, `recommendation`, `q`. `sort=name\|upgradeType\|riskLevel`, `page`, `pageSize` (max 100) |
| `GET /api/scans/:scanId/report` | The upgrade report as JSON, or `?format=markdown` for a `.md` download. 409 until the scan completes |
| `POST /api/scans/:scanId/reanalyze` | `{ "dependencyIds": [...], "force": false }`. Re-runs risk and AI for those upgrades. 202 |

Try a scan locally:

```bash
curl -X POST http://localhost:8787/api/scans -H 'content-type: application/json' -d '{"url":"https://github.com/expressjs/express","branch":"master"}'
```

Then poll `GET /api/scans/<scanId>` until `status` is `COMPLETED`, and fetch the report:

```bash
curl -o report.md "http://localhost:8787/api/scans/<scanId>/report?format=markdown"
```

 `wrangler dev` runs the queue consumer locally. To trigger the recovery sweep by hand, start the dev server with `--test-scheduled` and open `http://localhost:8787/__scheduled`.

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

Only if you use Anthropic instead of Workers AI (and set `AI_PROVIDER` to `anthropic` in `wrangler.jsonc`):

```bash
npx wrangler secret put ANTHROPIC_API_KEY --cwd apps/api
```

```bash
npm run deploy -w @upgradepilot/api
```
