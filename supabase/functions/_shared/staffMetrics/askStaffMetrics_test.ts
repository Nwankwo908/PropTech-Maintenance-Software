import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AiAttemptEvent } from "../ai/telemetry.ts";
import {
  answerStaffMetricsQuestion,
  answerUsesOnlyKnownNumbers,
  parseStaffMetricsRequest,
} from "./askStaffMetrics.ts";

const METRICS = {
  generated_at: "2026-11-14T00:00:00Z",
  window_days: 30,
  maintenance: { open_now: 9, overdue_now: 3, created: 41, by_trade: [], weekly: [] },
  vendors: { acceptance_rate: 0.6667, median_minutes_to_respond: 30 },
};

type Call = { url: string; init?: RequestInit };

function runtime(options: {
  rpcStatus?: number;
  apiKey?: string;
  aiText?: string | null;
  events?: AiAttemptEvent[];
  calls?: Call[];
}) {
  const calls = options.calls ?? [];
  return {
    env: (name: string) =>
      ({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        OPENAI_API_KEY: options.apiKey,
      } as Record<string, string | undefined>)[name],
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/rest/v1/rpc/get_staff_metrics")) {
        const status = options.rpcStatus ?? 200;
        return Promise.resolve(
          new Response(status === 200 ? JSON.stringify(METRICS) : '{"code":"42501"}', { status }),
        );
      }
      if (options.aiText === null) return Promise.resolve(new Response("{}", { status: 500 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: options.aiText ?? "" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
    telemetry: (event: AiAttemptEvent) => options.events?.push(event),
  };
}

function request(token: string | null = "user-token"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("x-ulo-access-token", token);
  return new Request("https://example.test/functions/v1/ask-ulo-staff-metrics", { method: "POST", headers });
}

Deno.test("parseStaffMetricsRequest rejects empty or oversized questions and clamps windows", () => {
  assertEquals(parseStaffMetricsRequest({ question: "  " }), null);
  assertEquals(parseStaffMetricsRequest({ question: "x".repeat(501) }), null);
  assertEquals(parseStaffMetricsRequest(["question"]), null);
  assertEquals(parseStaffMetricsRequest({ question: "Overdue?", days: 45 }), {
    question: "Overdue?",
    days: 30,
    includeDemo: false,
  });
  assertEquals(parseStaffMetricsRequest({ question: "Overdue?", days: 7, includeDemo: true })?.days, 7);
});

Deno.test("requires a signed-in caller", async () => {
  const result = await answerStaffMetricsQuestion(request(null), { question: "Overdue?" }, runtime({}));
  assertEquals(result.status, 401);
});

Deno.test("loads metrics with the caller's own token, never a service key", async () => {
  const calls: Call[] = [];
  await answerStaffMetricsQuestion(request("caller-jwt"), { question: "How many overdue?" }, runtime({ calls }));
  const rpc = calls.find((call) => call.url.includes("get_staff_metrics"));
  assert(rpc);
  assertEquals(new Headers(rpc.init?.headers).get("Authorization"), "Bearer caller-jwt");
  assertEquals(JSON.parse(String(rpc.init?.body)), { p_days: 30, p_include_demo: false });
});

Deno.test("returns 403 when the database refuses a non-staff caller", async () => {
  const result = await answerStaffMetricsQuestion(
    request(),
    { question: "How many overdue?" },
    runtime({ rpcStatus: 403 }),
  );
  assertEquals(result.status, 403);
});

Deno.test("answers from rules when no AI key is configured", async () => {
  const calls: Call[] = [];
  const result = await answerStaffMetricsQuestion(
    request(),
    { question: "How many work orders are overdue?" },
    runtime({ calls }),
  );
  assertEquals(result.status, 200);
  if (result.status !== 200) return;
  assertEquals(result.body.source, "rules");
  assert(result.body.answer.includes("**Overdue now** (right now): 3."));
  assertEquals(calls.some((call) => call.url.includes("openai")), false);
});

Deno.test("uses the AI answer when every number comes from the metrics", async () => {
  const events: AiAttemptEvent[] = [];
  const result = await answerStaffMetricsQuestion(
    request(),
    { question: "How many work orders are overdue?" },
    runtime({ apiKey: "sk-test", aiText: "**Overdue now** (right now): 3 of 9 open work orders.", events }),
  );
  assertEquals(result.status, 200);
  if (result.status !== 200) return;
  assertEquals(result.body.source, "ai");
  assertEquals(events[0]?.operation, "ask_ulo.staff_metrics");
  assertEquals(events[0]?.outcome, "success");
});

Deno.test("falls back to rules when the AI invents a number", async () => {
  const result = await answerStaffMetricsQuestion(
    request(),
    { question: "How many work orders are overdue?" },
    runtime({ apiKey: "sk-test", aiText: "**Overdue now**: 12 work orders." }),
  );
  assertEquals(result.status, 200);
  if (result.status !== 200) return;
  assertEquals(result.body.source, "rules");
});

Deno.test("falls back to rules when the AI call fails", async () => {
  const result = await answerStaffMetricsQuestion(
    request(),
    { question: "vendor acceptance rate" },
    runtime({ apiKey: "sk-test", aiText: null }),
  );
  assertEquals(result.status, 200);
  if (result.status !== 200) return;
  assertEquals(result.body.source, "rules");
  assert(result.body.answer.includes("67%"));
});

Deno.test("answerUsesOnlyKnownNumbers normalizes commas and decimals", () => {
  assert(answerUsesOnlyKnownNumbers("Spend was $1,250 over 30 days", ["= $1,250", "30"]));
  assert(!answerUsesOnlyKnownNumbers("Spend was $1,300", ["= $1,250"]));
  assert(answerUsesOnlyKnownNumbers("No numbers here.", []));
});
