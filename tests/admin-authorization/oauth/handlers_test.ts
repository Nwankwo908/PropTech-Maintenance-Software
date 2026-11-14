import { handlers } from "../inspection-activation/server_stub.ts";
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
import { db } from "./sdk_stub.ts";
import { business } from "./business_stub.ts";
await import("../../../supabase/functions/thumbtack-oauth/index.ts");
const stateId = "12345678-1234-4234-8234-123456789012";
async function run(
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    auth?: AuthOptions;
    expired?: boolean;
    badDate?: boolean;
    callback?: boolean;
    missing?: boolean;
    race?: boolean;
    providerFailure?: boolean;
  } = {},
) {
  db.rows = options.missing ? [] : [{
    state: stateId,
    landlord_id: ACCOUNT_A,
    expires_at: options.badDate
      ? "bad"
      : new Date(Date.now() + (options.expired ? -60000 : 60000))
        .toISOString(),
    return_path: "/admin",
  }];
  db.connections = [ACCOUNT_A];
  db.writes = 0;
  db.error = false;
  business.saved = [];
  business.events = 0;
  const original = globalThis.fetch;
  const settings = {
    SUPABASE_URL: env("SUPABASE_URL")!,
    SUPABASE_ANON_KEY: env("SUPABASE_ANON_KEY")!,
    SUPABASE_SERVICE_ROLE_KEY: env("SUPABASE_SERVICE_ROLE_KEY")!,
    THUMBTACK_MESSAGING_CLIENT_ID: ACCOUNT_B,
    THUMBTACK_MESSAGING_CLIENT_SECRET: "synthetic-client-secret",
  };
  const saved = Object.keys(settings).map((k) => Deno.env.get(k));
  for (const [k, v] of Object.entries(settings)) Deno.env.set(k, v);
  const runtime = authRuntime(options.auth);
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("f08-unit.invalid")) {
      return runtime.runtime.fetch(input, init);
    }
    if (init?.method === "POST") {
      providerCalls++;
      return Response.json(
        options.providerFailure ? {} : {
          refresh_token: "synthetic-refresh",
          access_token: "synthetic-access",
        },
        { status: options.providerFailure ? 500 : 200 },
      );
    }
    return new Response("", {
      status: 302,
      headers: { location: "https://www.thumbtack.com/oauth/authorize" },
    });
  };
  try {
    const method = options.callback ? "GET" : options.method ?? "POST";
    const url = options.callback
      ? `https://handler.invalid?code=fake&state=${stateId}`
      : method === "GET"
      ? `https://handler.invalid?landlordId=${ACCOUNT_A}`
      : "https://handler.invalid";
    const request = () =>
      new Request(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? { Authorization: "Bearer " + token() }),
        },
        ...(method === "POST"
          ? {
            body: JSON.stringify(
              options.body ??
                { action: "exchange", state: stateId, code: "synthetic" },
            ),
          }
          : {}),
      });
    const replies = options.race
      ? await Promise.all([handlers[0](request()), handlers[0](request())])
      : [await handlers[0](request())];
    return {
      statuses: replies.map((r) => r.status),
      providerCalls,
      bodies: await Promise.all(replies.map((r) => r.json().catch(() => null))),
    };
  } finally {
    globalThis.fetch = original;
    Object.keys(settings).forEach((k, i) =>
      saved[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, saved[i]!)
    );
  }
}
for (const method of ["GET", "POST"]) {
  for (
    const c of [
      { name: "missing", headers: {}, auth: {}, status: 401 },
      {
        name: "legacy",
        headers: { "x-admin-reassign-secret": "unit-public-browser-secret" },
        auth: {},
        status: 401,
      },
      {
        name: "anon",
        headers: { Authorization: "Bearer unit-anon-key" },
        auth: {},
        status: 401,
      },
      { name: "foreign", auth: { access: false }, status: 403 },
      { name: "expired", auth: { authStatus: 401 }, status: 401 },
      {
        name: "banned",
        auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
        status: 403,
      },
    ] as Array<
      {
        name: string;
        headers?: Record<string, string>;
        auth: AuthOptions;
        status: number;
      }
    >
  ) {
    Deno.test(`OAuth ${method} ${c.name} denied before writes/provider`, async () => {
      const r = await run({
        ...c,
        method,
        body: { action: "start", landlordId: ACCOUNT_A },
      });
      equal(r.statuses, [c.status]);
      equal(db.writes, 0);
      equal(r.providerCalls, 0);
      equal(business.saved, []);
    });
  }
}
Deno.test("own status uses only exact account connection", async () => {
  equal((await run({ method: "GET" })).bodies, [{
    connected: true,
    messagingClientReady: true,
  }]);
  equal(db.writes, 0);
});
Deno.test("foreign exchange preserves capability and makes no provider call", async () => {
  const r = await run({ auth: { access: false } });
  equal(r.statuses, [403]);
  equal(r.providerCalls, 0);
  equal(db.rows.length, 1);
});
Deno.test("exchange requires signed-in session", async () => {
  equal((await run({ headers: {} })).statuses, [401]);
  equal(db.writes, 0);
});
for (const option of ["expired", "badDate", "missing"] as const) {
  Deno.test(`callback refuses ${option} state without provider`, async () => {
    const r = await run({ callback: true, [option]: true, headers: {} });
    equal(r.statuses, [302]);
    equal(r.providerCalls, 0);
    equal(business.saved, []);
  });
}
Deno.test("two concurrent callbacks consume state exactly once", async () => {
  const r = await run({ callback: true, race: true, headers: {} });
  equal(r.providerCalls, 1);
  equal(business.saved.length, 1);
  equal(db.rows.length, 0);
  equal((business.saved[0] as { id: string }).id, ACCOUNT_A);
  equal(
    (business.saved[0] as { options: { exactAccount: boolean } }).options
      .exactAccount,
    true,
  );
});
Deno.test("provider failure consumes state and never stores credentials", async () => {
  const r = await run({ providerFailure: true });
  equal(r.statuses, [400]);
  equal(r.providerCalls, 1);
  equal(db.rows.length, 0);
  equal(business.saved, []);
});
Deno.test("OPTIONS permits Authorization without action", async () => {
  equal((await run({ method: "OPTIONS", headers: {} })).statuses, [200]);
  equal(db.writes, 0);
});
Deno.test('authorized start creates only a scoped state without exchanging tokens', async()=>{const r=await run({body:{action:'start',landlordId:ACCOUNT_A,returnPath:'//evil.invalid',returnOrigin:'https://evil.invalid'}});equal(r.statuses,[200]);equal(r.providerCalls,0);equal(db.rows.length,2);equal(db.rows[1].landlord_id,ACCOUNT_A);equal(db.rows[1].return_path,'/admin');equal(business.saved,[])})
for(const body of [{action:'start',landlordId:ACCOUNT_A,returnOrigin:5},{action:'exchange',state:4,code:'x'},{action:'start',landlordId:5},[]])Deno.test(`malformed OAuth payload ${JSON.stringify(body)} fails closed`,async()=>{const r=await run({body});equal(r.statuses,[400]);equal(db.writes,0);equal(r.providerCalls,0)})
