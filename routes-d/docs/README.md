# routes-d OpenAPI

Source of truth: `routes-d/docs/openapi.yaml`

Generation flow:
1. Runtime validators are defined under `routes-d/routes/validators.*.ts`.
2. `routes-d/docs/openapi.source.ts` maps validators to operations.
3. `routes-d/docs/generateOpenApi.ts` produces `openapi.yaml`.

Canonical HMAC signing string:
`METHOD\nPATH\nTIMESTAMP\nNONCE\nBASE64_SHA256(BODY_JSON)`

Lint command (CI-ready):
`node --loader ts-node/esm routes-d/docs/lintOpenApi.ts`
