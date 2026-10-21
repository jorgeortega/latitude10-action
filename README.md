# Latitude 10 readiness gate

A GitHub Action that checks an OpenAPI spec before AI agents use it:

- **Scores** the spec for agents (operation ids, summaries, descriptions,
  parameter descriptions, examples, idempotency, auth and more) with
  [openapi-agent-check](https://github.com/jorgeortega/openapi-agent-check),
  on your runner.
- **Annotates** each finding on the exact line of your spec, with a job
  summary.
- **Catches breaking changes** against the base branch, or against the last
  version in the [Latitude 10](https://latitude10.tech) registry.
- **Fails the job** when the score, the number of operations or breaking
  changes cross the limits you set.
- With a project key: **keeps every version** in the registry, and on paid
  plans **opens one pull request** with rules-only fixes.

Without a key, nothing leaves the runner: no account, no request to
Latitude 10.

## Usage

```yaml
name: API readiness
on:
  pull_request:
  push:
    branches: [main]

jobs:
  readiness:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: jorgeortega/latitude10-action@v1
        with:
          spec: openapi.yaml
          min-score: 70          # fail below this; default: report only
          max-tools: 40          # fail above this many operations; default 40
          fail-on-breaking: true # default false
          push: ${{ github.ref == 'refs/heads/main' }}
        env:
          LATITUDE10_KEY: ${{ secrets.LATITUDE10_KEY }}   # optional
```

## Inputs

| Input | Default | What it does |
|---|---|---|
| `spec` | (required) | Path to the OpenAPI 3.x document, YAML or JSON. Local `$ref`s are bundled; remote ones are refused. |
| `min-score` | empty | Fail when the readiness score (0–100) is below this. Empty reports only. |
| `max-tools` | `40` | Fail when the spec has more operations than this. Each operation becomes an agent tool. |
| `fail-on-breaking` | `false` | Fail when there are breaking changes against the base. |
| `push` | `false` | With `LATITUDE10_KEY`, upload this version to the registry (after the gate passes). |
| `suggest-fixes` | `false` | With `LATITUDE10_KEY` on a paid plan, open or update one pull request, `latitude10/readiness-fixes`. |
| `label` | `info.version` | The version's label in the registry. |
| `github-token` | `${{ github.token }}` | Used only by `suggest-fixes`. |
| `api-url` | `https://latitude10.tech` | The Latitude 10 API. |

Outputs: `score`, `operations`, `breaking`, and with `push`, `version-url`.

## The base for breaking changes

- With `LATITUDE10_KEY`, the base is the registry's latest version of the
  project.
- Otherwise, on pull requests, it's the same file on the base branch
  (`git show origin/<base>:<spec>`; the action fetches it). A spec split over
  several files is only diffed against the registry.

## Suggested fixes

`suggest-fixes: true` needs a key on a paid plan and these permissions:

```yaml
    permissions:
      contents: write
      pull-requests: write
```

The fixes are rules-only (no model) and come as JSON Patch, applied to your
file with its comments, key order and formatting kept. One branch and one
pull request are reused on every run. On Free, the summary says how many
operations have a fix. Pull requests from forks never get the key, a push or
a fixes pull request.

## Privacy

Without `LATITUDE10_KEY` the action makes no network request to Latitude 10.
With a key, it sends the spec to `api-url` to diff, push or fetch fixes, and
nothing else from your repository.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build   # commit dist/
```

`src/shared/diff.ts`, `src/shared/json-patch.ts` and `test/fixtures/` are
copied from the Latitude 10 site with `node scripts/sync-from-site.mjs
<site checkout>`; `src/shared/SOURCE` names the site commit. Change a diff
rule in the site first, then resync here and release a new `v1.x`.

## License

MIT © October Moon LLC
