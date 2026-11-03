<!-- Generated file — do not edit; regenerated with the SDK. -->

# Service — operations

Accessor: `client.service` · Source: `src/resources/service.ts` · 1 operation · Request and error types: namespace `Service`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `sayso-shops-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### health

- **Signature**: `health(options?: RequestOptions): ApiPromise<Health, Service.HealthApiError>`
- **Wire**: `GET /api/health`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Health`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `Service.HealthApiError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"health"` [503] `Health` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `Health` | `healthSchema` | `src/models/health.ts` |

