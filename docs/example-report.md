> Example output: the Markdown export of a real UpgradePilot scan of [vercel/ms](https://github.com/vercel/ms) at commit `4ff48ce`, run on 24 Nov 2026 with `wrangler dev --local` and AI analysis turned off. Every finding below comes from the deterministic rules and the cited sources. Versions reflect the npm registry on that day.

# Upgrade report: vercel/ms

Branch: main | Commit: 4ff48ce | Generated: 2026-11-24T16:47:29.756Z | AI analysis is off (AI_PROVIDER=none).

## Summary

UpgradePilot checked 11 dependencies in vercel/ms (main @ 4ff48ce). 9 are outdated: 2 patch, 4 minor, 3 major. 3 upgrades are high risk.

| Dependencies | Outdated | Patch | Minor | Major | Up to date | High risk | Deprecated | Unresolved | Security fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | 9 | 2 | 4 | 3 | 2 | 3 | 0 | 0 | 0 |

## Upgrade plan

1. **@arethetypeswrong/cli** 0.18.2 → 0.18.5 (safe) - Low risk patch upgrade
2. **ts-jest** 29.4.0 → 29.4.15 (safe) - Low risk patch upgrade
3. **@biomejs/biome** 2.1.3 → 2.6.9 (safe) - Low risk minor upgrade
4. **@jest/globals** 30.0.5 → 30.5.2 (safe) - Low risk minor upgrade
5. **jest** 30.0.5 → 30.5.2 (safe) - Low risk minor upgrade
6. **tsdown** 0.13.0 → 0.23.7 (review) - Minor upgrade from 0.13.0 to 0.23.7; 0.x minor releases can break
7. **@types/node** 24.1.0 → 26.6.6 (high risk) - Major version upgrade from 24.1.0 to 26.6.6
8. **lint-staged** 16.1.2 → 17.6.2 (high risk) - Major version upgrade from 16.1.2 to 17.6.2
9. **typescript** 5.8.3 → 7.0.2 (high risk) - Major version upgrade from 5.8.3 to 7.0.2

## High-risk migrations

### @types/node 24.1.0 → 26.6.6 (major, risk high, investigate)

Declared in: package.json (devDependencies, ^24.1.0)

_AI analysis is off (AI_PROVIDER=none)._

**Why update**

- 2 major versions behind
- A newer release is available (24.1.0 → 26.6.6)

**What could break**

- Major version upgrade from 24.1.0 to 26.6.6

**Evidence**

- [https://www.npmjs.com/package/@types/node/v/26.6.6](https://www.npmjs.com/package/@types/node/v/26.6.6) (npm_metadata, ok)
- [https://github.com/DefinitelyTyped/DefinitelyTyped/releases](https://github.com/DefinitelyTyped/DefinitelyTyped/releases) (github_release, not_found)
- [https://github.com/DefinitelyTyped/DefinitelyTyped/blob/HEAD/CHANGELOG.md](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/HEAD/CHANGELOG.md) (changelog, not_found)
- [https://github.com/DefinitelyTyped/DefinitelyTyped/blob/HEAD/UPGRADING.md](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/HEAD/UPGRADING.md) (migration_guide, not_found)

### lint-staged 16.1.2 → 17.6.2 (major, risk high, investigate)

Declared in: package.json (devDependencies, 16.1.2)

_AI analysis is off (AI_PROVIDER=none)._

**Why update**

- 1 major version behind
- A newer release is available (16.1.2 → 17.6.2)

**What could break**

- Major version upgrade from 16.1.2 to 17.6.2
- Node engine requirement raised from \>=20.17 to \>=22.22.1
- Breaking change noted in migration guide ([source](https://github.com/lint-staged/lint-staged/blob/HEAD/MIGRATION.md))

**Evidence**

- [https://www.npmjs.com/package/lint-staged/v/17.6.2](https://www.npmjs.com/package/lint-staged/v/17.6.2) (npm_metadata, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.6.2](https://github.com/lint-staged/lint-staged/releases/tag/v17.6.2) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.6.1](https://github.com/lint-staged/lint-staged/releases/tag/v17.6.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.6.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.6.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.5.1](https://github.com/lint-staged/lint-staged/releases/tag/v17.5.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.5.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.5.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.4.1](https://github.com/lint-staged/lint-staged/releases/tag/v17.4.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.3.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.3.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.2.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.2.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.1.1](https://github.com/lint-staged/lint-staged/releases/tag/v17.1.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.1.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.1.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.8](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.8) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.7](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.7) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.6](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.6) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.5](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.5) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.4](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.4) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.3](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.3) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.2](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.2) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.1](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v17.0.0](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.4.0](https://github.com/lint-staged/lint-staged/releases/tag/v16.4.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.3.4](https://github.com/lint-staged/lint-staged/releases/tag/v16.3.4) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.3.3](https://github.com/lint-staged/lint-staged/releases/tag/v16.3.3) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.3.2](https://github.com/lint-staged/lint-staged/releases/tag/v16.3.2) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.3.1](https://github.com/lint-staged/lint-staged/releases/tag/v16.3.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.3.0](https://github.com/lint-staged/lint-staged/releases/tag/v16.3.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.7](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.7) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.6](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.6) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.5](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.5) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.4](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.4) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.3](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.3) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.2](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.2) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.1](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.1) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.2.0](https://github.com/lint-staged/lint-staged/releases/tag/v16.2.0) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.1.6](https://github.com/lint-staged/lint-staged/releases/tag/v16.1.6) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.1.5](https://github.com/lint-staged/lint-staged/releases/tag/v16.1.5) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.1.4](https://github.com/lint-staged/lint-staged/releases/tag/v16.1.4) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/releases/tag/v16.1.3](https://github.com/lint-staged/lint-staged/releases/tag/v16.1.3) (github_release, ok)
- [https://github.com/lint-staged/lint-staged/blob/HEAD/CHANGELOG.md](https://github.com/lint-staged/lint-staged/blob/HEAD/CHANGELOG.md) (changelog, ok)
- [https://github.com/lint-staged/lint-staged/blob/HEAD/MIGRATION.md](https://github.com/lint-staged/lint-staged/blob/HEAD/MIGRATION.md) (migration_guide, ok)

### typescript 5.8.3 → 7.0.2 (major, risk high, investigate)

Declared in: package.json (devDependencies, 5.8.3)

_AI analysis is off (AI_PROVIDER=none)._

**Why update**

- 2 major versions behind
- A newer release is available (5.8.3 → 7.0.2)

**What could break**

- Major version upgrade from 5.8.3 to 7.0.2
- Node engine requirement raised from \>=14.17 to \>=16.20.0

**Evidence**

- [https://www.npmjs.com/package/typescript/v/7.0.2](https://www.npmjs.com/package/typescript/v/7.0.2) (npm_metadata, ok)
- [https://github.com/microsoft/TypeScript/releases/tag/v7.0.2](https://github.com/microsoft/TypeScript/releases/tag/v7.0.2) (github_release, ok)
- [https://github.com/microsoft/TypeScript/releases/tag/v6.0.3](https://github.com/microsoft/TypeScript/releases/tag/v6.0.3) (github_release, ok)
- [https://github.com/microsoft/TypeScript/releases/tag/v6.0.2](https://github.com/microsoft/TypeScript/releases/tag/v6.0.2) (github_release, ok)
- [https://github.com/microsoft/TypeScript/releases/tag/v5.9.3](https://github.com/microsoft/TypeScript/releases/tag/v5.9.3) (github_release, ok)
- [https://github.com/microsoft/TypeScript/releases/tag/v5.9.2](https://github.com/microsoft/TypeScript/releases/tag/v5.9.2) (github_release, ok)
- [https://github.com/microsoft/TypeScript/blob/HEAD/CHANGELOG.md](https://github.com/microsoft/TypeScript/blob/HEAD/CHANGELOG.md) (changelog, not_found)
- [https://github.com/microsoft/TypeScript/blob/HEAD/UPGRADING.md](https://github.com/microsoft/TypeScript/blob/HEAD/UPGRADING.md) (migration_guide, not_found)

## Review before upgrading

### tsdown 0.13.0 → 0.23.7 (minor, risk medium, investigate)

Declared in: package.json (devDependencies, ^0.13.0)

_AI analysis is off (AI_PROVIDER=none)._

**Why update**

- A newer release is available (0.13.0 → 0.23.7)

**What could break**

- Minor upgrade from 0.13.0 to 0.23.7; 0.x minor releases can break
- Node engine requirement raised from \>=20.19.0 to ^22.18.0 \|\| ^24.11.0 \|\| \>=26.0.0
- New peer dependency tsx *
- New peer dependency unrun *
- New peer dependency @tsdown/css 0.23.7
- New peer dependency @tsdown/exe 0.23.7
- New peer dependency @vitejs/devtools *
- Breaking change noted in github release for 0.23.0 ([source](https://github.com/rolldown/tsdown/releases/tag/v0.23.0))
- Breaking change noted in github release for 0.22.12 ([source](https://github.com/rolldown/tsdown/releases/tag/v0.22.12))

**Evidence**

- [https://www.npmjs.com/package/tsdown/v/0.23.7](https://www.npmjs.com/package/tsdown/v/0.23.7) (npm_metadata, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.7](https://github.com/rolldown/tsdown/releases/tag/v0.23.7) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.5](https://github.com/rolldown/tsdown/releases/tag/v0.23.5) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.4](https://github.com/rolldown/tsdown/releases/tag/v0.23.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.3](https://github.com/rolldown/tsdown/releases/tag/v0.23.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.2](https://github.com/rolldown/tsdown/releases/tag/v0.23.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.1](https://github.com/rolldown/tsdown/releases/tag/v0.23.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.23.0](https://github.com/rolldown/tsdown/releases/tag/v0.23.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.14](https://github.com/rolldown/tsdown/releases/tag/v0.22.14) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.13](https://github.com/rolldown/tsdown/releases/tag/v0.22.13) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.12](https://github.com/rolldown/tsdown/releases/tag/v0.22.12) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.11](https://github.com/rolldown/tsdown/releases/tag/v0.22.11) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.10](https://github.com/rolldown/tsdown/releases/tag/v0.22.10) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.9](https://github.com/rolldown/tsdown/releases/tag/v0.22.9) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.8](https://github.com/rolldown/tsdown/releases/tag/v0.22.8) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.7](https://github.com/rolldown/tsdown/releases/tag/v0.22.7) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.6](https://github.com/rolldown/tsdown/releases/tag/v0.22.6) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.5](https://github.com/rolldown/tsdown/releases/tag/v0.22.5) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.4](https://github.com/rolldown/tsdown/releases/tag/v0.22.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.3](https://github.com/rolldown/tsdown/releases/tag/v0.22.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.2](https://github.com/rolldown/tsdown/releases/tag/v0.22.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.1](https://github.com/rolldown/tsdown/releases/tag/v0.22.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.22.0](https://github.com/rolldown/tsdown/releases/tag/v0.22.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.10](https://github.com/rolldown/tsdown/releases/tag/v0.21.10) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.9](https://github.com/rolldown/tsdown/releases/tag/v0.21.9) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.8](https://github.com/rolldown/tsdown/releases/tag/v0.21.8) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.7](https://github.com/rolldown/tsdown/releases/tag/v0.21.7) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.6](https://github.com/rolldown/tsdown/releases/tag/v0.21.6) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.5](https://github.com/rolldown/tsdown/releases/tag/v0.21.5) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.4](https://github.com/rolldown/tsdown/releases/tag/v0.21.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.3](https://github.com/rolldown/tsdown/releases/tag/v0.21.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.2](https://github.com/rolldown/tsdown/releases/tag/v0.21.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.1](https://github.com/rolldown/tsdown/releases/tag/v0.21.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.21.0](https://github.com/rolldown/tsdown/releases/tag/v0.21.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.20.3](https://github.com/rolldown/tsdown/releases/tag/v0.20.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.20.2](https://github.com/rolldown/tsdown/releases/tag/v0.20.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.20.1](https://github.com/rolldown/tsdown/releases/tag/v0.20.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.20.0](https://github.com/rolldown/tsdown/releases/tag/v0.20.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.19.0](https://github.com/rolldown/tsdown/releases/tag/v0.19.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.18.4](https://github.com/rolldown/tsdown/releases/tag/v0.18.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.18.3](https://github.com/rolldown/tsdown/releases/tag/v0.18.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.18.2](https://github.com/rolldown/tsdown/releases/tag/v0.18.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.18.1](https://github.com/rolldown/tsdown/releases/tag/v0.18.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.18.0](https://github.com/rolldown/tsdown/releases/tag/v0.18.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.17.4](https://github.com/rolldown/tsdown/releases/tag/v0.17.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.17.3](https://github.com/rolldown/tsdown/releases/tag/v0.17.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.17.2](https://github.com/rolldown/tsdown/releases/tag/v0.17.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.17.1](https://github.com/rolldown/tsdown/releases/tag/v0.17.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.17.0](https://github.com/rolldown/tsdown/releases/tag/v0.17.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.8](https://github.com/rolldown/tsdown/releases/tag/v0.16.8) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.7](https://github.com/rolldown/tsdown/releases/tag/v0.16.7) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.6](https://github.com/rolldown/tsdown/releases/tag/v0.16.6) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.5](https://github.com/rolldown/tsdown/releases/tag/v0.16.5) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.4](https://github.com/rolldown/tsdown/releases/tag/v0.16.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.3](https://github.com/rolldown/tsdown/releases/tag/v0.16.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.2](https://github.com/rolldown/tsdown/releases/tag/v0.16.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.1](https://github.com/rolldown/tsdown/releases/tag/v0.16.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.16.0](https://github.com/rolldown/tsdown/releases/tag/v0.16.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.12](https://github.com/rolldown/tsdown/releases/tag/v0.15.12) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.11](https://github.com/rolldown/tsdown/releases/tag/v0.15.11) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.10](https://github.com/rolldown/tsdown/releases/tag/v0.15.10) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.9](https://github.com/rolldown/tsdown/releases/tag/v0.15.9) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.8](https://github.com/rolldown/tsdown/releases/tag/v0.15.8) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.7](https://github.com/rolldown/tsdown/releases/tag/v0.15.7) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.6](https://github.com/rolldown/tsdown/releases/tag/v0.15.6) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.5](https://github.com/rolldown/tsdown/releases/tag/v0.15.5) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.4](https://github.com/rolldown/tsdown/releases/tag/v0.15.4) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.3](https://github.com/rolldown/tsdown/releases/tag/v0.15.3) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.2](https://github.com/rolldown/tsdown/releases/tag/v0.15.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.1](https://github.com/rolldown/tsdown/releases/tag/v0.15.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.15.0](https://github.com/rolldown/tsdown/releases/tag/v0.15.0) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.14.2](https://github.com/rolldown/tsdown/releases/tag/v0.14.2) (github_release, ok)
- [https://github.com/rolldown/tsdown/releases/tag/v0.14.1](https://github.com/rolldown/tsdown/releases/tag/v0.14.1) (github_release, ok)
- [https://github.com/rolldown/tsdown/blob/HEAD/CHANGELOG.md](https://github.com/rolldown/tsdown/blob/HEAD/CHANGELOG.md) (changelog, not_found)

## Safe candidates

| Package | From | To | Type | Manifests |
| --- | --- | --- | --- | --- |
| @arethetypeswrong/cli | 0.18.2 | 0.18.5 | patch | package.json |
| ts-jest | 29.4.0 | 29.4.15 | patch | package.json |
| @biomejs/biome | 2.1.3 | 2.6.9 | minor | package.json |
| @jest/globals | 30.0.5 | 30.5.2 | minor | package.json |
| jest | 30.0.5 | 30.5.2 | minor | package.json |

## Migration checklist

- [ ] **@arethetypeswrong/cli**: Update @arethetypeswrong/cli 0.18.2 → 0.18.5
- [ ] **ts-jest**: Update ts-jest 29.4.0 → 29.4.15
- [ ] **@biomejs/biome**: Update @biomejs/biome 2.1.3 → 2.6.9
- [ ] **@jest/globals**: Update @jest/globals 30.0.5 → 30.5.2
- [ ] **jest**: Update jest 30.0.5 → 30.5.2
- [ ] **tsdown**: Update tsdown from 0.13.0 to 0.23.7 in package.json
- [ ] **tsdown**: Run the test suite and build
- [ ] **@types/node**: Update @types/node from 24.1.0 to 26.6.6 in package.json
- [ ] **@types/node**: Run the test suite and build
- [ ] **lint-staged**: Update lint-staged from 16.1.2 to 17.6.2 in package.json
- [ ] **lint-staged**: Run the test suite and build
- [ ] **typescript**: Update typescript from 5.8.3 to 7.0.2 in package.json
- [ ] **typescript**: Run the test suite and build

## Warnings

- AI analysis: AI analysis is off (AI_PROVIDER=none).
