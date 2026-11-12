import { authorizeAdminAccount } from "../../../supabase/functions/_shared/adminAccountAuthorization.ts";
import {
  ACCOUNT_A,
  authRuntime,
  EMAIL,
  equal,
  token,
  USER,
  user,
} from "./runtime.ts";
const cors = { "Access-Control-Allow-Origin": "*" };
const cases: Array<
  {
    name: string;
    options?: Parameters<typeof authRuntime>[0];
    headers?: Record<string, string>;
    claims?: Record<string, unknown>;
    expected: number | null;
    envMissing?: string;
  }
> = [
  {
    name: "no session despite public browser credential",
    headers: { "x-admin-reassign-secret": "unit-public-browser-secret" },
    expected: 401,
  },
  {
    name: "anonymous API bearer is not a user",
    headers: { Authorization: "Bearer unit-anon-key" },
    expected: 401,
  },
  {
    name: "service credential is not an interactive user",
    headers: { Authorization: "Bearer unit-service-key" },
    expected: 401,
  },
  {
    name: "publishable key is not a user",
    headers: { Authorization: "Bearer sb_publishable_unit_only" },
    expected: 401,
  },
  {
    name: "rejected or expired session",
    options: { authStatus: 401 },
    expected: 401,
  },
  {
    name: "Auth failure fails closed",
    options: { authStatus: 500 },
    expected: 503,
  },
  {
    name: "Auth timeout fails closed",
    options: { failAt: "/auth/v1/user" },
    expected: 503,
  },
  {
    name: "malformed Auth payload",
    options: { malformedAt: "/auth/v1/user" },
    expected: 503,
  },
  { name: "null user", options: { user: null }, expected: 401 },
  {
    name: "anonymous user cannot administer",
    options: { user: { ...user(), is_anonymous: true } },
    expected: 401,
  },
  {
    name: "unverified email cannot administer",
    options: { user: { ...user(), email_confirmed_at: null } },
    expected: 401,
  },
  {
    name: "user_metadata email does not grant authority",
    options: {
      user: { ...user(), email: null, user_metadata: { email: EMAIL } },
    },
    expected: 401,
  },
  {
    name: "token subject must match server identity",
    claims: { sub: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    expected: 401,
  },
  {
    name: "stale email token must be refreshed",
    claims: { email: "old@example.invalid" },
    expected: 401,
  },
  {
    name: "non-user JWT role rejected",
    claims: { role: "service_role" },
    expected: 401,
  },
  {
    name: "banned account with valid old JWT rejected",
    options: { account: { ...user(), banned_until: "2099-01-01T00:00:00Z" } },
    expected: 403,
  },
  {
    name: "deleted account rejected",
    options: { accountStatus: 404 },
    expected: 403,
  },
  {
    name: "deleted account marker rejected",
    options: { account: { ...user(), deleted_at: "2026-11-12T00:00:00Z" } },
    expected: 403,
  },
  {
    name: "unreadable ban record fails closed",
    options: { account: { ...user(), banned_until: "not-a-date" } },
    expected: 403,
  },
  {
    name: "wrong admin identity rejected",
    options: { account: { ...user(), id: "other-user" } },
    expected: 403,
  },
  {
    name: "account status lookup failure",
    options: { accountStatus: 500 },
    expected: 503,
  },
  {
    name: "ban status timeout",
    options: { failAt: "/auth/v1/admin/users/" + USER },
    expected: 503,
  },
  {
    name: "foreign account or removed membership",
    options: { access: false },
    expected: 403,
  },
  { name: "permission RPC error", options: { rpcStatus: 500 }, expected: 503 },
  {
    name: "permission RPC timeout",
    options: { failAt: "/rest/v1/rpc/can_access_landlord" },
    expected: 503,
  },
  {
    name: "truthy RPC object is not permission",
    options: { access: { allowed: true } },
    expected: 503,
  },
  {
    name: "malformed RPC payload",
    options: { malformedAt: "/rest/v1/rpc/can_access_landlord" },
    expected: 503,
  },
  {
    name: "missing required service configuration",
    envMissing: "SUPABASE_SERVICE_ROLE_KEY",
    expected: 503,
  },
  { name: "own authorized account", expected: null },
  {
    name: "elapsed ban no longer blocks authorized user",
    options: { account: { ...user(), banned_until: "2020-01-01T00:00:00Z" } },
    expected: null,
  },
];
for (const c of cases) {
  Deno.test("auth: " + c.name, async () => {
    const { runtime, calls } = authRuntime(c.options);
    if (c.envMissing) {
      const original = runtime.env;
      runtime.env = (n) => n === c.envMissing ? undefined : original(n);
    }
    const accessToken = token(c.claims);
    const headers = c.headers ?? { Authorization: "Bearer " + accessToken };
    const result = await authorizeAdminAccount(
      new Request("https://handler.invalid", { headers }),
      ACCOUNT_A,
      cors,
      runtime,
    );
    equal(result?.status ?? null, c.expected);
    if (result) {
      equal(result.headers.get("Access-Control-Allow-Origin"), "*");
      await result.text();
    }
    const rpc = calls.find((x) =>
      x.path === "/rest/v1/rpc/can_access_landlord"
    );
    if (rpc) {
      equal(rpc.authorization, "Bearer " + accessToken);
      equal(rpc.apikey, "unit-anon-key");
      equal(rpc.body, { p_landlord_id: ACCOUNT_A });
    }
    if (c.expected === null) equal(calls.length, 3);
  });
}
Deno.test("auth: explicit session header works alongside anon gateway bearer", async () => {
  const { runtime } = authRuntime();
  const result = await authorizeAdminAccount(
    new Request("https://handler.invalid", {
      headers: {
        Authorization: "Bearer unit-anon-key",
        "x-ulo-access-token": token(),
      },
    }),
    ACCOUNT_A,
    cors,
    runtime,
  );
  equal(result, null);
});
Deno.test("auth: invalid explicit session does not fall through to another identity", async () => {
  const { runtime, calls } = authRuntime();
  const result = await authorizeAdminAccount(
    new Request("https://handler.invalid", {
      headers: { Authorization: "Bearer " + token(), "x-ulo-access-token": "" },
    }),
    ACCOUNT_A,
    cors,
    runtime,
  );
  equal(result?.status, 401);
  await result?.text();
  equal(calls.length, 0);
});
