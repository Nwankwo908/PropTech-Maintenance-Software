# AI observability

The edge functions emit one structured JSON `ai.attempt` event per model attempt in maintenance classification and Ask Ulo answer synthesis. These events use the existing Supabase function log pipeline; no new external service, migration, account configuration, payment setting, or deployment is required to build the code. Deploy the affected functions to collect new events in hosted logs.

## Fields and interpretation

- `schemaVersion`: currently 1.
- `traceId`: random per classification/synthesis invocation. Classification retries share this ID. This is not yet an end-to-end SMS/work-order trace.
- `operation`, `provider`, `model`, `attempt`: bounded operation name and execution context; attempt starts at 1.
- `durationMs`: monotonic elapsed time through HTTP response parsing/validation, excluding telemetry emission. This is not handset latency or full workflow response time.
- `outcome`: `success`, `http_error`, `invalid_response`, `timeout`, or `transport_error`. Success means the existing response shape/content guard accepted the result, not that the answer is factually correct.
- `status`, `providerRequestId`: HTTP status and safe opaque provider request ID when available.
- `inputTokens`, `outputTokens`, `totalTokens`: provider-reported counts; null means unavailable, not zero. No price/cost estimates are inferred.

Filter function logs for `event = ai.attempt`; group by operation/model for request counts, error ratio, token totals, and latency percentiles. Count distinct trace IDs for invocation counts. Group by trace ID and order by attempt to investigate retries. Exclude null token counts rather than interpreting them as free calls. Retain failure counts by outcome and HTTP status (especially 429/5xx). Export structured JSON through your existing log drain for durable dashboards/alerts if needed; this change does not configure a drain, retention, or alert destinations.

## Privacy and behavior

Events contain no prompts, model replies, documents, phone numbers, resident names, account IDs, API keys, or provider error bodies. The helper never serializes caught errors. Classification and synthesis provider-error-body logging was removed at the instrumented call sites. Telemetry failures are swallowed to preserve workflow behavior. Events are unsampled; apply retention/access policies in the log platform. Other application logs are outside this content-free guarantee.

No additional retry, timeout, model, routing, or fallback policy is introduced. Existing classification failure still falls back to rules. Missing API keys produce no provider attempt event. The fetch response body is parsed once on successful HTTP responses; non-2xx bodies are not read or logged by these callers.

## Verification and remaining work

Fresh mocked tests cover success/usage, HTTP errors, invalid JSON/shape, timeout/transport failures, privacy, and telemetry sink failure, alongside classification retry/fallback regression tests. Type checks and scoped Deno lint pass. No real provider traffic, phone evidence, deployment, or live latency measurement was used.

Coverage currently excludes other AI transports (vision, extraction, interpretation, tool planning), streaming/time-to-first-token, full workflow correlation, quality evaluations, dashboards, automated alerts, and durable telemetry storage. Instrument those through the shared helper with bounded operation names as follow-up work; never pass user text as operation/model/trace metadata.
