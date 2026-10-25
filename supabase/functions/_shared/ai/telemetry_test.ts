import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AiAttemptEvent, observeAiJson } from "./telemetry.ts";

const context = {
  traceId: "trace-test",
  operation: "maintenance.classify" as const,
  model: "test",
  attempt: 2,
};

Deno.test("AI telemetry records usage and correlation without response content", async () => {
  const events: AiAttemptEvent[] = [];
  const { data } = await observeAiJson(
    context,
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            secret: "private resident message",
            usage: {
              prompt_tokens: 12,
              completion_tokens: 4,
              total_tokens: 16,
            },
          }),
          { headers: { "x-request-id": "req_123" } },
        ),
      ),
    () => true,
    (e) => events.push(e),
  );
  assertEquals(Boolean(data), true);
  assertEquals(events.length, 1);
  assertEquals(events[0].outcome, "success");
  assertEquals(events[0].inputTokens, 12);
  assertEquals(events[0].outputTokens, 4);
  assertEquals(events[0].providerRequestId, "req_123");
  assertEquals(events[0].attempt, 2);
  assertEquals(JSON.stringify(events).includes("private resident"), false);
  assertEquals(events[0].durationMs >= 0, true);
});

Deno.test("AI telemetry distinguishes HTTP failures and invalid responses", async () => {
  const events: AiAttemptEvent[] = [];
  const sink = (e: AiAttemptEvent) => events.push(e);
  await observeAiJson(
    context,
    () =>
      Promise.resolve(new Response("private provider error", { status: 429 })),
    () => true,
    sink,
  );
  await observeAiJson(
    context,
    () => Promise.resolve(new Response("{}")),
    () => false,
    sink,
  );
  await assertRejects(() =>
    observeAiJson(
      context,
      () => Promise.resolve(new Response("invalid json")),
      () => true,
      sink,
    )
  );
  assertEquals(events.map((e) => e.outcome), [
    "http_error",
    "invalid_response",
    "invalid_response",
  ]);
  assertEquals(events[0].status, 429);
  assertEquals(JSON.stringify(events).includes("private provider"), false);
});

Deno.test("AI telemetry records timeout and transport failure, never error content", async () => {
  const events: AiAttemptEvent[] = [];
  for (const name of ["TimeoutError", "Error"]) {
    await assertRejects(() =>
      observeAiJson(context, () => {
        const error = new Error("private token");
        error.name = name;
        return Promise.reject(error);
      }, () =>
        true, (e) =>
        events.push(e))
    );
  }
  assertEquals(events.map((e) => e.outcome), ["timeout", "transport_error"]);
  assertEquals(JSON.stringify(events).includes("private token"), false);
});

Deno.test("AI telemetry sink failure does not fail a successful call", async () => {
  const result = await observeAiJson(
    context,
    () => Promise.resolve(new Response('{"ok":true}')),
    () => true,
    () => {
      throw new Error("sink unavailable");
    },
  );
  assertEquals(result.data, { ok: true });
});
