# Deploying UpgradePilot to Cloudflare

UpgradePilot deploys as one Cloudflare Worker that serves both the API and the dashboard, plus a D1 database and a queue. Everything fits the Workers Free plan. A deploy takes about ten minutes the first time.

Run every command from the repository root unless a step says otherwise.

## What you need

- A Cloudflare account (the free plan is enough).
- Node.js 20 or newer, and the repository installed with `npm install`.
- Recommended: a GitHub fine-grained personal access token with no extra permissions. It can read public repositories and raises the GitHub limit from 60 to 5,000 requests an hour. Without it, larger scans pause to wait out the limit.

## 1. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser to authorise Wrangler.

## 2. Create the database and the queue

```bash
npx wrangler d1 create upgradepilot --cwd apps/api
```

Copy the `database_id` it prints into `apps/api/wrangler.jsonc`, replacing the placeholder `00000000-0000-0000-0000-000000000000`.

```bash
npx wrangler queues create upgradepilot-scans --cwd apps/api
```

## 3. Create the tables

```bash
npm run db:migrate:remote -w @upgradepilot/api
```

This applies every file in `apps/api/migrations` in order. Run it again after pulling changes that add a migration.

## 4. Add secrets

```bash
npx wrangler secret put GITHUB_TOKEN --cwd apps/api
```

Paste the token when asked. Secrets are stored encrypted by Cloudflare and are never part of the code or the dashboard bundle.

AI analysis uses Workers AI by default, which needs no key. To use Claude instead, set `"AI_PROVIDER": "anthropic"` in `apps/api/wrangler.jsonc` and add the key:

```bash
npx wrangler secret put ANTHROPIC_API_KEY --cwd apps/api
```

For OpenAI, set `"AI_PROVIDER": "openai"`, add `"AI_MODEL"` with the model name, and add the key:

```bash
npx wrangler secret put OPENAI_API_KEY --cwd apps/api
```

## 5. Deploy

```bash
npm run deploy
```

This builds the dashboard (`apps/web/out`) and deploys the Worker with it. Wrangler prints the URL, for example `https://upgradepilot.<your-subdomain>.workers.dev`.

## 6. Check it works

```bash
curl https://upgradepilot.<your-subdomain>.workers.dev/api/health
```

Expect `{"status":"ok",...}`. Then open the URL, check a repository such as `https://github.com/vercel/ms`, and start a scan. A small repository finishes in about a minute.

To watch logs while a scan runs:

```bash
npx wrangler tail --cwd apps/api
```

## Settings

All are `vars` in `apps/api/wrangler.jsonc`. Change them and run `npm run deploy` again.

| Setting | Default | What it does |
| --- | --- | --- |
| `AI_PROVIDER` | `workers-ai` | `workers-ai`, `anthropic`, `openai`, or `none` |
| `AI_MODEL` | provider default | Overrides the model. Required for OpenAI |
| `AI_MAX_ANALYSES_PER_SCAN` | 10 | Upgrades analysed by AI in one scan, riskiest first |
| `AI_MAX_ANALYSES_PER_DAY` | 25 | Model calls per UTC day across all scans. The Workers AI free tier covers about 27 |
| `RATE_LIMIT_SCANS_PER_HOUR` | 20 | New scans per hour, for everyone combined |
| `RATE_LIMIT_INSPECT_PER_HOUR` | 60 | Repository checks per hour |
| `RATE_LIMIT_REANALYZE_PER_HOUR` | 20 | Re-analysis requests per hour |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

The hourly limits apply to everyone combined, and each client (identified by a hash of its IP) gets a quarter of each. The AI per-scan limit also covers re-analysis. They exist so a public demo cannot use up the free GitHub, npm, D1 or AI allowances. Raise them for private use.

## Free plan limits that matter

| Limit | Value | How UpgradePilot stays within it |
| --- | --- | --- |
| CPU per invocation | 10 ms | Scans run as small queued steps; large npm metadata is avoided |
| Subrequests per invocation | 50 | 4 packages or 3 upgrades per step |
| D1 queries per invocation | 50 | Batched writes |
| Queue operations | 10,000 a day | About 100 per scan |
| Workers AI | 10,000 neurons a day | Per-scan and daily caps |
| KV | not used | |

Static file requests for the dashboard are free and unlimited.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Scans stay at "Queued" | The queue was not created, or the consumer is not attached | Run step 2 again and redeploy. The cron sweep re-queues stuck scans every 5 minutes |
| `429 RATE_LIMITED` | An hourly cap was reached | Wait for the `Retry-After` time, or raise the cap |
| Scans pause for a long time | GitHub rate limit without a token | Add `GITHUB_TOKEN` (step 4) |
| AI shows "skipped" | Daily cap reached, Workers AI allowance used, or a key missing | Check the note on the upgrade; caps reset at 00:00 UTC |
| `D1_ERROR: no such table` | Migrations not applied remotely | Run step 3 |
| Deploy fails on `database_id` | Placeholder still in `wrangler.jsonc` | Paste the ID from step 2 |

## Updating

```bash
npm run db:migrate:remote -w @upgradepilot/api
```

```bash
npm run deploy
```

## Removing it

```bash
npx wrangler delete --cwd apps/api
```

```bash
npx wrangler d1 delete upgradepilot --cwd apps/api
```

```bash
npx wrangler queues delete upgradepilot-scans --cwd apps/api
```

Deleting the database removes all scan history permanently.
