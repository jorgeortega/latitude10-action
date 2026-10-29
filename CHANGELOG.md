# Changelog

## 1.1.0 (2026-10-29)

- `suggest-fixes` works on every Latitude 10 plan, Free included (30 fix runs
  a month on Free). When the registry refuses or the month's runs are used,
  the summary says how many operations have a fix and a notice says why.

## 1.0.0 (2026-10-21)

- Scores an OpenAPI spec for AI agents with openapi-agent-check 1.0.0
  (rules 1.0.3) on the runner, annotates findings on their lines, and writes
  a job summary.
- Breaking-change diff against the base branch, or the Latitude 10 registry
  with a project key (diff rules from the site at `src/shared/SOURCE`).
- Gate inputs: `min-score`, `max-tools`, `fail-on-breaking`.
- With `LATITUDE10_KEY`: `push` to the registry, and on paid plans
  `suggest-fixes` opens or updates one pull request.
