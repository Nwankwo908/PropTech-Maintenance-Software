import { handlers } from "../inspection-activation/server_stub.ts";
import { reset, state } from "../routing/sdk_stub.ts";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  type AuthOptions,
  authRuntime,
  env,
  equal,
  token,
  user,
} from "../routing/runtime.ts";
await import("../../../supabase/functions/release-sms-number/index.ts");
const NUMBER_A = "11111111-1111-4111-8111-111111111111",
  NUMBER_B = "22222222-2222-4222-8222-222222222222",
  POOL = "33333333-3333-4333-8333-333333333333";
async function run(
  options: {
    headers?: Record<string, string>;
    auth?: AuthOptions;
    body?: Record<string, unknown>;
    rawBody?: string;
    method?: string;
    error?: boolean;
  } = {},
) {
  reset();
  state.rows.sms_numbers = [
    { id: NUMBER_A, landlord_id: ACCOUNT_A, purpose: "landlord_main" },
    { id: NUMBER_B, landlord_id: ACCOUNT_B, purpose: "landlord_main" },
    { id: POOL, landlord_id: ACCOUNT_A, purpose: "pool" },
  ];
  if (options.error) state.errorTable = "sms_numbers";
  const original = globalThis.fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const saved = keys.map((k) => Deno.env.get(k));
  keys.forEach((k) => Deno.env.set(k, env(k)!));
  globalThis.fetch = authRuntime(options.auth).runtime.fetch;
  try {
    const method = options.method ?? "POST";
    const response = await handlers[0](
      new Request("https://handler.invalid", {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? { Authorization: "Bearer " + token() }),
        },
        ...(method === "POST"
          ? {
            body: options.rawBody ??
              JSON.stringify({
                landlordId: ACCOUNT_A,
                smsNumberId: NUMBER_A,
                ...options.body,
              }),
          }
          : {}),
      }),
    );
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      headers: response.headers,
    };
  } finally {
    globalThis.fetch = original;
    keys.forEach((k, i) =>
      saved[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, saved[i]!)
    );
  }
}
function noEffects() {
  equal(state.writes, 0);
  equal(state.business.length, 0);
}
const denials: Array<
  {
    name: string;
    headers?: Record<string, string>;
    auth?: AuthOptions;
    status: number;
  }
> = [
  { name: "anonymous", headers: {}, status: 401 },
  {
    name: "shared secret only",
    headers: { "x-admin-reassign-secret": "synthetic-legacy" },
    status: 401,
  },
  {
    name: "anon API key",
    headers: { Authorization: "Bearer unit-anon-key" },
    status: 401,
  },
  {
    name: "service API key",
    headers: { Authorization: "Bearer unit-service-key" },
    status: 401,
  },
  { name: "expired session", auth: { authStatus: 401 }, status: 401 },
  { name: "foreign account", auth: { access: false }, status: 403 },
  {
    name: "banned account",
    auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
    status: 403,
  },
  { name: "authority outage", auth: { rpcStatus: 500 }, status: 503 },
];
for (const c of denials) {
  Deno.test(`release: ${c.name} cannot reach number lookup or release`, async () => {
    equal((await run(c)).status, c.status);
    equal(state.clients, 0);
    equal(state.reads.length, 0);
    noEffects();
  });
}
for (
  const smsNumberId of [NUMBER_B, POOL, "99999999-9999-4999-8999-999999999999"]
) {
  Deno.test(`release: foreign, pool or missing number ${smsNumberId}`, async () => {
    const r = await run({ body: { smsNumberId } });
    equal(r.status, 404);
    equal(r.body, { error: "SMS number not found" });
    noEffects();
  });
}
Deno.test("release: own number reaches only account-scoped business operation", async () => {
  equal((await run()).status, 200);
  equal(state.business.length, 1);
  const p = state.business[0].params as Record<string, unknown>;
  equal(p.landlordId, ACCOUNT_A);
  equal(p.smsNumberId, NUMBER_A);
  equal(state.reads[0].filters, [["id", NUMBER_A], ["landlord_id", ACCOUNT_A], [
    "purpose",
    "landlord_main",
  ]]);
});
Deno.test("release: authorized account-only selection preserves existing helper path", async () => {
  equal((await run({ body: { smsNumberId: null } })).status, 200);
  equal(
    (state.business[0].params as Record<string, unknown>).landlordId,
    ACCOUNT_A,
  );
});
Deno.test("release: completion requires an owned number too", async () => {
  equal(
    (await run({ body: { smsNumberId: NUMBER_B, completeRelease: true } }))
      .status,
    404,
  );
  noEffects();
  equal((await run({ body: { completeRelease: true } })).status, 200);
  equal(
    (state.business[0].params as Record<string, unknown>).completeRelease,
    true,
  );
});
Deno.test("release: lookup outage fails closed", async () => {
  equal((await run({ error: true })).status, 503);
  noEffects();
});
for (
  const body of [
    { landlordId: null },
    { landlordId: "" },
    { landlordId: 3 },
    { smsNumberId: 3 },
    { smsNumberId: "invalid" },
    { completeRelease: "true" },
    { finalAutoReply: {} },
  ]
) {
  Deno.test(`release: invalid input ${JSON.stringify(body)}`, async () => {
    equal((await run({ body })).status, 400);
    noEffects();
  });
}
for (const rawBody of ["null", "[]", "invalid"]) {
  Deno.test(`release: invalid object ${rawBody}`, async () => {
    equal((await run({ rawBody })).status, 400);
    equal(state.clients, 0);
    noEffects();
  });
}
Deno.test("release: OPTIONS allows Authorization without side effects", async () => {
  const r = await run({ method: "OPTIONS", headers: {} });
  equal(r.status, 200);
  equal(
    r.headers.get("access-control-allow-headers")?.includes("authorization"),
    true,
  );
  equal(state.clients, 0);
  noEffects();
});
Deno.test("release: unsupported method has no effects", async () => {
  equal((await run({ method: "GET" })).status, 405);
  equal(state.clients, 0);
  noEffects();
});
