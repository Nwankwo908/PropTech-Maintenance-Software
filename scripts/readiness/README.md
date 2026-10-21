# Application readiness checks

Independent gates. A green Vite build is **not** application readiness.

| npm script | Question | Command |
| --- | --- | --- |
| `check:packaging` | Can production be packaged? | Vite `build` only |
| `check:frontend-types` | Browser/shared/node TS valid? | `tsc --noEmit` on app, node, vitest configs |
| `check:backend-types` | Edge code valid under Deno? | `deno check --config supabase/functions/deno.json` on every `functions/*/index.ts` |
| `check:lint` | Lint rules satisfied? | ESLint (src/shared/vite/scripts) + `deno lint` (functions); errors/warnings counted separately |
| `check:behavior-frontend` | Frontend/shared behavior? | Vitest (default include) |
| `check:behavior-backend` | Edge behavior? | `deno test` on `*_test.ts` (excludes `*_live_test.ts`); uses `--no-check` for runtime only |
| `check:connected-workflows` | Components together? | Disposable onboarding PG suite + requester TZ matrix; optional Home Check SQL/browser/live |
| `check:readiness` | Overall? | Runs all of the above; packaging never masks other failures |

Statuses: `passed` | `failed` | `blocked` | `not_run`. Artifacts land in `.readiness/` (gitignored): commit SHA, commands, runtimes, logs.

## Shared ownership

See `shared-ownership.json`. `shared/` production modules are typechecked by **both** frontend `tsc` and Deno edge entrypoint checks. Deno-only `shared/**/*_test.ts` files are excluded from browser `tsc` (naming convention) and covered by the Deno type/behavior gates.

## Connected / live prerequisites

| Subcheck | Requirement |
| --- | --- |
| `onboarding_inventory_pg` | PostgreSQL 16+ (`PG_BIN` or PATH) |
| `requester_timezone_matrix` | Deno |
| `home_check_sql` | `READINESS_HOME_CHECK_DATABASE_URL` (isolated, migrated) |
| `home_check_browser` | `READINESS_RUN_HOME_CHECK_BROWSER=1` + `HOME_CHECK_BROWSER_DRIVER` + local fixture app |
| `live_deno_sandbox` | `READINESS_RUN_LIVE_DENO_TESTS=1` + sandbox Supabase URL/service role (never production outbound) |

Missing prerequisites → `blocked` / `not_run`, never a fabricated pass.

## Deno endpoint configuration

Canonical check/lint config: `supabase/functions/deno.json`. Per-function `deno.json` lockfiles remain for deploy; readiness uses `--no-lock` so a newer local Deno does not rewrite bundler-incompatible lockfile v5.
