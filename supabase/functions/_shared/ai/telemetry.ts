/** Content-free, best-effort AI attempt telemetry for structured edge logs. */
export type AiAttemptEvent = {
  event: "ai.attempt";
  schemaVersion: 1;
  traceId: string;
  operation: "maintenance.classify" | "ask_ulo.synthesize";
  provider: "openai";
  model: string;
  attempt: number;
  durationMs: number;
  outcome:
    | "success"
    | "http_error"
    | "invalid_response"
    | "timeout"
    | "transport_error";
  status: number | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiTelemetrySink = (event: AiAttemptEvent) => void;

function token(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Never reads/logs request content, credentials, response text, or error messages. */
export async function observeAiJson<T>(
  context: Pick<AiAttemptEvent, "traceId" | "operation" | "model" | "attempt">,
  request: () => Promise<Response>,
  validate: (data: T) => boolean,
  sink: AiTelemetrySink = (event) => console.info(JSON.stringify(event)),
): Promise<{ response: Response; data: T | null }> {
  const started = performance.now();
  const event: AiAttemptEvent = {
    ...context,
    event: "ai.attempt",
    schemaVersion: 1,
    provider: "openai",
    durationMs: 0,
    outcome: "transport_error",
    status: null,
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
  try {
    const response = await request();
    event.status = response.status;
    // Provider IDs are opaque correlation tokens, never arbitrary header content.
    const requestId = response.headers.get("x-request-id");
    event.providerRequestId =
      requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? requestId : null;
    if (!response.ok) {
      event.outcome = "http_error";
      return { response, data: null };
    }
    event.outcome = "invalid_response";
    const data = await response.json() as T;
    const usage = (data as { usage?: Record<string, unknown> } | null)?.usage;
    event.inputTokens = token(usage?.prompt_tokens ?? usage?.input_tokens);
    event.outputTokens = token(
      usage?.completion_tokens ?? usage?.output_tokens,
    );
    event.totalTokens = token(usage?.total_tokens);
    if (validate(data)) event.outcome = "success";
    return { response, data };
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    ) {
      event.outcome = "timeout";
    }
    throw error;
  } finally {
    event.durationMs = Math.max(0, Math.round(performance.now() - started));
    try {
      sink(event);
    } catch { /* Telemetry must never change workflow behavior. */ }
  }
}
