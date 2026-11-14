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
await import("../../../supabase/functions/get-broadcast-stats/index.ts");
async function run(
  options: {
    method?: string;
    headers?: Record<string, string>;
    auth?: AuthOptions;
    body?: unknown;
    account?: string;
    error?: boolean;
    empty?: boolean;
  } = {},
) {
  reset();
  if (options.empty) state.rows.broadcast_notification_log = [];
  if (options.error) state.errorTable = "broadcast_notification_log";
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
      new Request(
        "https://handler.invalid?landlordId=" + (options.account ?? ACCOUNT_A),
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(options.headers ?? { Authorization: "Bearer " + token() }),
          },
          ...(method === "POST"
            ? {
              body: JSON.stringify(
                options.body === undefined
                  ? { landlordId: options.account ?? ACCOUNT_A }
                  : options.body,
              ),
            }
            : {}),
        },
      ),
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
const untouched = () => {
  equal(state.clients, 0);
  equal(state.reads.length, 0);
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
  { name: "anonymous", headers: {}, status: 401 },
  {
    name: "anon API key",
    headers: { Authorization: "Bearer unit-anon-key" },
    status: 401,
  },
  {
    name: "shared secret only",
    headers: { "x-admin-reassign-secret": "synthetic-legacy-value" },
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
    name: "banned session",
    auth: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
    status: 403,
  },
  { name: "authority outage", auth: { rpcStatus: 500 }, status: 503 },
];
for (const method of ["GET", "POST"]) {
  for (const c of denials) {
    Deno.test(`stats ${method}: ${c.name} never reads privileged metrics`, async () => {
      equal((await run({ ...c, method })).status, c.status);
      untouched();
    });
  }
  Deno.test(`stats ${method}: authorized A excludes foreign B counts`, async () => {
    const r = await run({ method });
    equal(r.status, 200);
    equal(r.body, { activeNotifications: 1, successRate: 50 });
    equal(state.reads.length, 2);
    equal(state.writes, 0);
    for (const read of state.reads) {
      equal(
        read.filters.some(([k, v]) => k === "landlord_id" && v === ACCOUNT_A),
        true,
      );
    }
  });
  Deno.test(`stats ${method}: authorized B uses its own account`, async () => {
    const r = await run({ method, account: ACCOUNT_B });
    equal(r.body, { activeNotifications: 3, successRate: 75 });
    equal(state.writes, 0);
  });
  Deno.test(`stats ${method}: database failure is not successful zero metrics`, async () => {
    const r = await run({ method, error: true });
    equal(r.status, 503);
    equal(r.body, { error: "Statistics temporarily unavailable" });
    equal(state.writes, 0);
  });
  Deno.test(`stats ${method}: empty authorized account returns zero`, async () => {
    equal((await run({ method, empty: true })).body, {
      activeNotifications: 0,
      successRate: 0,
    });
    equal(state.writes, 0);
  });
}
for (const body of [null, [], {}, { landlordId: 3 }, { landlordId: "bad" }]) {
  Deno.test(`stats invalid body ${JSON.stringify(body)}`, async () => {
    equal((await run({ body })).status, 400);
    untouched();
  });
}
Deno.test("stats: OPTIONS allows Authorization and performs no queries", async () => {
  const r = await run({ method: "OPTIONS", headers: {} });
  equal(r.status, 200);
  equal(
    r.headers.get("access-control-allow-headers")?.includes("authorization"),
    true,
  );
  untouched();
});
Deno.test("stats: unsupported method does not access database", async () => {
  equal((await run({ method: "DELETE" })).status, 405);
  untouched();
});
