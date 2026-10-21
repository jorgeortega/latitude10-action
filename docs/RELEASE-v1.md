# v1.0.0

The first release of the Latitude 10 readiness gate.

- Score your OpenAPI spec for AI agents in CI, with annotations on the exact
  lines and a job summary. No key, no account, no request to Latitude 10.
- Catch breaking changes against your base branch, or against the last
  version in the Latitude 10 registry.
- Fail the job on a low score, too many operations, or breaking changes.
- With a project key: keep every version in the registry and, on paid plans,
  get one pull request with rules-only fixes.

```yaml
- uses: jorgeortega/latitude10-action@v1
  with:
    spec: openapi.yaml
    min-score: 70
```

Full inputs in the README.
