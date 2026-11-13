import { handlers } from "./server_stub.ts";
import { reset, state } from "./sdk_stub.ts";
import { ACCOUNT_A, ACCOUNT_B, RUN_A, RUN_B, authRuntime, env, equal, token, user, type AuthOptions } from "../routing/runtime.ts";
import { adminReassignSecretAuthorized } from "../../../supabase/functions/_shared/admin_reassign_auth.ts";
await import("../../../supabase/functions/run-inspection-action/index.ts");
await import("../../../supabase/functions/activate-unit/index.ts");
for (const withLegacy of [true, false]) {
  Deno.test(`old guard bridge: session plus legacy header=${withLegacy}`, () => {
    const saved = Deno.env.get("ADMIN_REASSIGN_SECRET");
    Deno.env.set("ADMIN_REASSIGN_SECRET", "synthetic-unusable-legacy-value");
    try {
      const headers: Record<string, string> = { Authorization: "Bearer " + token() };
      if (withLegacy) headers["x-admin-reassign-secret"] = "synthetic-unusable-legacy-value";
      equal(adminReassignSecretAuthorized(new Request("https://unit.invalid", { headers })), withLegacy);
    } finally {
      if (saved === undefined) Deno.env.delete("ADMIN_REASSIGN_SECRET");
      else Deno.env.set("ADMIN_REASSIGN_SECRET", saved);
    }
  });
}
const UNIT_A = "11111111-1111-4111-8111-111111111111";
const UNIT_B = "22222222-2222-4222-8222-222222222222";
const RESIDENT_B = "33333333-3333-4333-8333-333333333333";
const bodies = [
  { landlordId: ACCOUNT_A, workflowRunId: RUN_A, action: "record_outcome" },
  { landlordId: ACCOUNT_A, unitId: UNIT_A, skipTenantRegistration: true },
];
async function run(index: number, options: {
  headers?: Record<string, string>; auth?: AuthOptions;
  body?: Record<string, unknown>; errorTable?: string;
  method?: string;
  rawBody?: string; wrongTemplate?: boolean;
} = {}) {
  reset();
  state.rows.units = [{ id: UNIT_A, landlord_id: ACCOUNT_A }, { id: UNIT_B, landlord_id: ACCOUNT_B }];
  state.rows.users = [{ id: RESIDENT_B, landlord_id: ACCOUNT_B }];
  state.rows.workflow_runs.forEach(row => { row.template_id = "inspection"; });
  if (options.wrongTemplate) state.rows.workflow_runs[0].template_id = "maintenance_request";
  state.errorTable = options.errorTable ?? "";
  const originalFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_REASSIGN_SECRET"];
  const saved = keys.map(k => Deno.env.get(k));
  keys.forEach(k => Deno.env.set(k, env(k)!));
  globalThis.fetch = authRuntime(options.auth).runtime.fetch;
  try {
    const method = options.method ?? "POST";
    const response = await handlers[index](new Request("https://unit.invalid", {
      method, headers: { "Content-Type": "application/json", ...(options.headers ?? { Authorization: "Bearer " + token() }) },
      ...(method === "POST" ? { body: options.rawBody ?? JSON.stringify({ ...bodies[index], ...options.body }) } : {}),
    }));
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((k, i) => saved[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, saved[i]!));
  }
}
for (const index of [0, 1]) {
  const denials: Array<{ name: string; headers?: Record<string, string>; auth?: AuthOptions; status: number }> = [
    { name: "shared browser secret alone", headers: { "x-admin-reassign-secret": "unit-public-browser-secret" }, status: 401 },
    { name: "anon plus shared secret", headers: { Authorization: "Bearer unit-anon-key", "x-admin-reassign-secret": "unit-public-browser-secret" }, status: 401 },
    { name: "expired session", auth: { authStatus: 401 }, status: 401 },
    { name: "foreign account", auth: { access: false }, status: 403 },
    { name: "banned account", auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } }, status: 403 },
    { name: "membership lookup outage", auth: { rpcStatus: 500 }, status: 503 },
  ];
  for (const c of denials) {
    Deno.test(`handler ${index}: ${c.name} cannot reach business code`, async () => {
      const r = await run(index, c); equal(r.status, c.status);
      equal(state.clients, 0); equal(state.reads.length, 0); equal(state.business.length, 0); equal(state.writes, 0);
    });
  }
  Deno.test(`handler ${index}: own session reaches only scoped business action`, async () => {
    equal((await run(index)).status, 200); equal(state.business.length, 1);
    equal((state.business[0].params as { landlordId: string }).landlordId, ACCOUNT_A);
  });
  Deno.test(`handler ${index}: OPTIONS permits Authorization without account access`, async () => {
    const r = await run(index, { method: "OPTIONS", headers: {} }); equal(r.status, 200);
    equal(r.headers.get("access-control-allow-headers")?.includes("authorization"), true);
    equal(state.clients, 0);
  });
  Deno.test(`handler ${index}: resource lookup outage fails closed`, async () => {
    equal((await run(index, { errorTable: index === 0 ? "workflow_runs" : "units" })).status, 503);
    equal(state.business.length, 0); equal(state.writes, 0);
  });
  for (const rawBody of ["null", "[]", "invalid-json"]) {
    Deno.test(`handler ${index}: malformed body ${rawBody} fails without resource access`, async () => {
      equal((await run(index, { rawBody })).status, 400); equal(state.clients, 0); equal(state.business.length, 0);
    });
  }
}
Deno.test("inspection action cannot run against an own maintenance workflow", async () => {
  equal((await run(0, { wrongTemplate: true })).status, 404); equal(state.business.length, 0);
});
for (const workflowRunId of [RUN_B, "99999999-9999-4999-8999-999999999999"]) {
  Deno.test(`inspection does not expose or execute inaccessible run ${workflowRunId}`, async () => {
    const r = await run(0, { body: { workflowRunId } }); equal(r.status, 404);
    equal(r.data, { error: "Workflow not found" }); equal(state.business.length, 0);
  });
}
for (const body of [{ unitId: UNIT_B }, { residentId: RESIDENT_B }]) {
  Deno.test(`activation denies foreign target ${JSON.stringify(body)}`, async () => {
    equal((await run(1, { body })).status, 404); equal(state.business.length, 0); equal(state.writes, 0);
  });
}
Deno.test("activation skip cannot default to an unrelated account", async () => {
  equal((await run(1, { body: { landlordId: "" } })).status, 400); equal(state.clients, 0);
});
