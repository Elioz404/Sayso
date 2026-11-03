<!-- Generated file — do not edit; regenerated with the SDK. -->

# Service — operations

Accessor: `client.service` · Source: `sayso_shops_api/apis/service.py` · 1 operation

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.service.health

- **Route**: `GET /api/health`
- **Signature**: `def health(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `Health`
- **Returns (raw)**: `ApiResult[Health, HealthErrorBody]`
- **Error**: `HealthErrorBody` — **Case A (typed)**
- **Error arms**: `Health` [503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `Health` | `sayso_shops_api/models/health.py` |
| `HealthErrorBody` | `sayso_shops_api/errors/health_error.py` |

