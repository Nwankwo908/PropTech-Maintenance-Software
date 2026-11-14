# ULO-SEC01-STRICT-20261113-137e1cf4 QA handoff

Do not merge this branch. It only carries the reviewed fixture and cleanup SQL for the
strict-guard rollout so the rollout session can read them.

- `ULO-SEC01-STRICT-20261113-137e1cf4-fixtures.sql`: run once before the strict-guard checks.
- `ULO-SEC01-STRICT-20261113-137e1cf4-cleanup.sql`: run once after the checks and after signing out both QA users.

Both are unchanged from the versions the owner reviewed. They reference only synthetic QA
ids and `@ulohome.invalid` emails: no passwords, tokens or customer data.
