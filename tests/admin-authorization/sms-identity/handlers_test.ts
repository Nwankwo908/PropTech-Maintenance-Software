import { handlers } from "./server_stub.ts";
import { reset, state } from "./sdk_stub.ts";
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
await import("../../../supabase/functions/sync-sms-identity/index.ts");
const RESIDENT_A = "11111111-1111-4111-8111-111111111111",
  RESIDENT_B = "22222222-2222-4222-8222-222222222222";
const UNIT_A = "33333333-3333-4333-8333-333333333333",
  UNIT_B = "44444444-4444-4444-8444-444444444444";
const VENDOR_A = "77777777-7777-4777-8777-777777777777",
  VENDOR_B = "88888888-8888-4888-8888-888888888888";
async function run(
  options: {
    headers?: Record<string, string>;
    auth?: AuthOptions;
    body?: Record<string, unknown>;
    rawBody?: string;
    method?: string;
    errorTable?: string;
    ambiguous?: boolean;
  } = {},
) {
  reset();
  state.rows.users = [{ id: RESIDENT_A, landlord_id: ACCOUNT_A }, {
    id: RESIDENT_B,
    landlord_id: ACCOUNT_B,
  }];
  state.rows.units = [{
    id: UNIT_A,
    landlord_id: ACCOUNT_A,
    unit_label: "1",
    building: "QA House",
  }, {
    id: UNIT_B,
    landlord_id: ACCOUNT_B,
    unit_label: "2",
    building: "Foreign House",
  }];
  if (options.ambiguous) {
    state.rows.units.push({
      id: "55555555-5555-4555-8555-555555555555",
      landlord_id: ACCOUNT_A,
      unit_label: "1",
      building: "Other House",
    });
  }
  state.errorTable = options.errorTable ?? "";
  const savedFetch = globalThis.fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_REASSIGN_SECRET",
  ];
  const saved = keys.map((key) => Deno.env.get(key));
  keys.forEach((key) => Deno.env.set(key, env(key)!));
  const auth = authRuntime(options.auth);
  globalThis.fetch = auth.runtime.fetch;
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
                phone: "+12025550123",
                identityType: "resident",
                residentId: RESIDENT_A,
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
      authCalls: auth.calls,
    };
  } finally {
    globalThis.fetch = savedFetch;
    keys.forEach((key, i) =>
      saved[i] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, saved[i]!)
    );
  }
}
const noMutation = () => {
  equal(state.business.length, 0);
  equal(state.writes, 0);
};
const denials: Array<
  {
    name: string;
    headers?: Record<string, string>;
    auth?: AuthOptions;
    status: number;
  }
> = [
  { name: "no session", headers: {}, status: 401 },
  {
    name: "secret only",
    headers: { "x-admin-reassign-secret": "unit-public-browser-secret" },
    status: 401,
  },
  {
    name: "anon and secret",
    headers: {
      Authorization: "Bearer unit-anon-key",
      "x-admin-reassign-secret": "unit-public-browser-secret",
    },
    status: 401,
  },
  {
    name: "service key",
    headers: { Authorization: "Bearer unit-service-key" },
    status: 401,
  },
  { name: "expired token", auth: { authStatus: 401 }, status: 401 },
  { name: "foreign account", auth: { access: false }, status: 403 },
  {
    name: "banned user",
    auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
    status: 403,
  },
  { name: "membership outage", auth: { rpcStatus: 500 }, status: 503 },
];
for (const c of denials) {
  Deno.test(`sync: ${c.name} stops before resource lookup`, async () => {
    equal((await run(c)).status, c.status);
    equal(state.clients, 0);
    equal(state.reads.length, 0);
    noMutation();
  });
}
for (
  const body of [
    { residentId: RESIDENT_B },
    { residentId: "99999999-9999-4999-8999-999999999999" },
    { identityType: "vendor", residentId: null, vendorId: VENDOR_B },
    { unitId: UNIT_B },
    { unitLabel: "2", building: "Foreign House" },
  ]
) {
  Deno.test(`sync: nested foreign/missing resource ${JSON.stringify(body)}`, async () => {
    const r = await run({ body });
    equal(r.status, 404);
    noMutation();
    for (const read of state.reads) {
      equal(
        read.filters.some(([k, v]) => k === "landlord_id" && v === ACCOUNT_A),
        true,
      );
    }
  });
}
for (const errorTable of ["users", "vendors", "units"]) {
  Deno.test(`sync: ${errorTable} lookup outage`, async () => {
    const body = errorTable === "vendors"
      ? { identityType: "vendor", residentId: null, vendorId: VENDOR_A }
      : { unitId: UNIT_A };
    equal((await run({ body, errorTable })).status, 503);
    noMutation();
  });
}
for (
  const body of [
    { residentId: "bad" },
    { unitId: "bad" },
    { residentId: 42 },
    { identityType: {} },
    { landlordId: "" },
    { landlordId: undefined },
    { vendorId: VENDOR_A },
    { identityType: "vendor", vendorId: VENDOR_A },
    { unitLabel: 42 },
    { unitId: UNIT_A, unitLabel: "2", building: "Foreign House" },
    { building: "QA House" },
  ]
) {
  Deno.test(`sync: rejects invalid/conflicting input ${JSON.stringify(body)}`, async () => {
    equal((await run({ body })).status, 400);
    noMutation();
  });
}
for (const rawBody of ["null", "[]", "oops"]) {
  Deno.test(`sync: invalid JSON object ${rawBody}`, async () => {
    equal((await run({ rawBody })).status, 400);
    equal(state.clients, 0);
    noMutation();
  });
}
Deno.test("sync: ambiguous same-account label is rejected", async () => {
  equal((await run({ body: { unitLabel: "1" }, ambiguous: true })).status, 404);
  noMutation();
});
for (
  const body of [
    {},
    { unitId: UNIT_A },
    { unitLabel: "1", building: "QA House" },
    { unitId: UNIT_A, unitLabel: "1", building: "QA House" },
    { identityType: "vendor", residentId: null, vendorId: VENDOR_A },
  ]
) {
  Deno.test(`sync: own-account positive ${JSON.stringify(body)}`, async () => {
    equal((await run({ body })).status, 200);
    equal(state.business.length, 1);
    const p = state.business[0].params as Record<string, unknown>;
    equal(p.landlordId, ACCOUNT_A);
    if (body.unitId || body.unitLabel) equal(p.unitId, UNIT_A);
  });
}
Deno.test("sync: preflight allows session without looking up accounts", async () => {
  const r = await run({ method: "OPTIONS", headers: {} });
  equal(r.status, 200);
  equal(
    r.headers.get("access-control-allow-headers")?.includes("authorization"),
    true,
  );
  equal(state.clients, 0);
  equal(r.authCalls.length, 0);
  noMutation();
});
Deno.test("sync: unsupported method has no effects", async () => {
  equal((await run({ method: "GET" })).status, 405);
  equal(state.clients, 0);
  noMutation();
});
