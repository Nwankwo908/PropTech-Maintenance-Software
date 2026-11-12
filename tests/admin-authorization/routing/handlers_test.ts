import { handlers } from "./server_stub.ts";
import { reset, state, VENDOR_A, VENDOR_B } from "./sdk_stub.ts";
import {
  ACCOUNT_A,
  type AuthOptions,
  authRuntime,
  env,
  equal,
  RUN_A,
  RUN_B,
  TICKET_A,
  TICKET_B,
  token,
  user,
} from "./runtime.ts";
import { adminEdgeCorsHeaders } from "../../../supabase/functions/_shared/admin_edge_cors.ts";
await import("../../../supabase/functions/admin-reassign-vendor/index.ts");
await import("../../../supabase/functions/admin-move-workflow-stage/index.ts");

const definitions = [
  {
    name: "reassign",
    body: { landlordId: ACCOUNT_A, ticketId: TICKET_A, vendorId: VENDOR_A },
  },
  {
    name: "stage",
    body: {
      landlordId: ACCOUNT_A,
      runId: RUN_A,
      ticketId: TICKET_A,
      fromStage: "new_intake",
      toStage: "in_progress",
    },
  },
];
async function run(index: number, options: {
  headers?: Record<string, string>;
  auth?: AuthOptions;
  body?: Record<string, unknown>;
  method?: string;
} = {}) {
  reset();
  const original = fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_REASSIGN_SECRET",
  ];
  const saved = keys.map((key) => Deno.env.get(key));
  for (const key of keys) Deno.env.set(key, env(key)!);
  const auth = authRuntime(options.auth);
  globalThis.fetch = auth.runtime.fetch;
  const method = options.method ?? "POST";
  const before = JSON.stringify(state.rows);
  try {
    const request = new Request("https://unit.invalid", {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? { Authorization: "Bearer " + token() }),
      },
      ...(method === "POST"
        ? {
          body: JSON.stringify({ ...definitions[index].body, ...options.body }),
        }
        : {}),
    });
    const response = await handlers[index](request);
    return {
      status: response.status,
      headers: response.headers,
      data: await response.json().catch(() => null),
      before,
      after: JSON.stringify(state.rows),
      authCalls: auth.calls,
    };
  } finally {
    globalThis.fetch = original;
    keys.forEach((key, i) =>
      saved[i] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, saved[i]!)
    );
  }
}
for (let index = 0; index < definitions.length; index++) {
  const name = definitions[index].name;
  const cases: Array<
    {
      label: string;
      headers?: Record<string, string>;
      auth?: AuthOptions;
      status: number;
    }
  > = [
    {
      label: "legacy alone",
      headers: { "x-admin-reassign-secret": "unit-public-browser-secret" },
      status: 401,
    },
    {
      label: "anon plus legacy",
      headers: {
        Authorization: "Bearer unit-anon-key",
        "x-admin-reassign-secret": "unit-public-browser-secret",
      },
      status: 401,
    },
    {
      label: "service credential",
      headers: { Authorization: "Bearer unit-service-key" },
      status: 401,
    },
    { label: "invalid session", auth: { authStatus: 401 }, status: 401 },
    { label: "foreign account", auth: { access: false }, status: 403 },
    { label: "removed membership", auth: { access: false }, status: 403 },
    {
      label: "banned user",
      auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
      status: 403,
    },
    { label: "Auth outage", auth: { authStatus: 500 }, status: 503 },
    { label: "RPC outage", auth: { rpcStatus: 500 }, status: 503 },
    {
      label: "malformed authority",
      auth: { access: { allowed: true } },
      status: 503,
    },
  ];
  for (const testCase of cases) {
    Deno.test(`${name} rejects ${testCase.label} before business access`, async () => {
      const result = await run(index, testCase);
      equal(result.status, testCase.status);
      equal(state.clients, 0);
      equal(state.reads, []);
      equal(state.business, []);
      equal(result.before, result.after);
    });
  }
  for (const compatibility of [false, true]) {
    Deno.test(`${name} accepts own session in ${compatibility ? "compatibility" : "session-only"} mode`, async () => {
      const result = await run(index, {
        headers: {
          Authorization: "Bearer " + token(),
          ...(compatibility
            ? { "x-admin-reassign-secret": "unit-public-browser-secret" }
            : {}),
        },
      });
      equal(result.status, 200);
      equal(state.writes > 0, true);
    });
  }
  Deno.test(`${name} OPTIONS returns shared explicit CORS without business access`, async () => {
    const result = await run(index, { method: "OPTIONS", headers: {} });
    equal(result.status, 200);
    for (const [key, value] of Object.entries(adminEdgeCorsHeaders)) {
      equal(result.headers.get(key), value);
    }
    equal(state.clients, 0);
    equal(state.business, []);
    equal(result.authCalls, []);
  });
  Deno.test(`${name} rejects unsupported method`, async () => {
    equal((await run(index, { method: "DELETE", headers: {} })).status, 405);
    equal(state.clients, 0);
  });
}
Deno.test("reassignment cannot access a foreign ticket", async () => {
  const result = await run(0, { body: { ticketId: TICKET_B } });
  equal(result.status, 404);
  equal(state.business, []);
  equal(result.before, result.after);
});
Deno.test("reassignment cannot select another account vendor", async () => {
  const result = await run(0, { body: { vendorId: VENDOR_B } });
  equal(result.status, 404);
  equal(state.business, []);
  equal(result.before, result.after);
});
Deno.test("stage rejects a foreign resource under own account", async () => {
  const result = await run(1, { body: { ticketId: TICKET_B, runId: RUN_B } });
  equal(result.status, 404);
  equal(state.writes, 0);
  equal(result.before, result.after);
});
Deno.test("visit-time branch authorizes before scheduling", async () => {
  const result = await run(1, {
    body: {
      action: "set_visit_time",
      visitDate: "2026-12-01",
      windowText: "9-11am",
    },
    auth: { access: false },
  });
  equal(result.status, 403);
  equal(state.business, []);
});
Deno.test("visit-time own session retains supported action", async () => {
  const result = await run(1, {
    body: {
      action: "set_visit_time",
      visitDate: "2026-12-01",
      windowText: "9-11am",
    },
  });
  equal(result.status, 200);
  equal(state.business[0].name, "visit");
});
