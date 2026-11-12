export const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const TICKET_A = "11111111-1111-4111-8111-111111111111";
export const TICKET_B = "22222222-2222-4222-8222-222222222222";
export const INVOICE_A = "33333333-3333-4333-8333-333333333333";
export const INVOICE_B = "44444444-4444-4444-8444-444444444444";
export const RUN_A = "55555555-5555-4555-8555-555555555555";
export const RUN_B = "66666666-6666-4666-8666-666666666666";
export const EMAIL = "admin-a@example.invalid";
export function token(claims: Record<string, unknown> = {}) {
  return btoa(JSON.stringify({ alg: "stub" })) + "." +
    btoa(
      JSON.stringify({
        sub: USER,
        email: EMAIL,
        role: "authenticated",
        ...claims,
      }),
    ) + ".stub-signature";
}
export function user() {
  return {
    id: USER,
    email: EMAIL,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
  };
}
export type AuthOptions = {
  user?: Record<string, unknown> | null;
  claims?: Record<string, unknown>;
  account?: Record<string, unknown> | null;
  access?: unknown;
  authStatus?: number;
  accountStatus?: number;
  rpcStatus?: number;
  failAt?: string;
  malformedAt?: string;
};
export const env = (name: string): string | undefined =>
  ({
    SUPABASE_URL: "https://f08-unit.invalid",
    SUPABASE_ANON_KEY: "unit-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "unit-service-key",
    ADMIN_REASSIGN_SECRET: "unit-public-browser-secret",
  } as Record<string, string>)[name];
export function authRuntime(options: AuthOptions = {}) {
  const calls: Array<
    {
      path: string;
      authorization: string | null;
      apikey: string | null;
      body: unknown;
    }
  > = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    if (url.origin !== "https://f08-unit.invalid") {
      throw Error("Unexpected network destination");
    }
    const headers = new Headers(init?.headers);
    calls.push({
      path: url.pathname,
      authorization: headers.get("Authorization"),
      apikey: headers.get("apikey"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (options.failAt === url.pathname) {
      throw Error("Synthetic infrastructure failure");
    }
    if (options.malformedAt === url.pathname) return new Response("not-json");
    if (url.pathname === "/auth/v1/user") {
      return Response.json(options.user === undefined ? user() : options.user, {
        status: options.authStatus ?? 200,
      });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      return Response.json(
        options.account === undefined
          ? { ...user(), banned_until: null }
          : options.account,
        { status: options.accountStatus ?? 200 },
      );
    }
    if (url.pathname === "/rest/v1/rpc/can_access_landlord") {
      return Response.json(
        options.access === undefined ? true : options.access,
        { status: options.rpcStatus ?? 200 },
      );
    }
    throw Error("Unexpected API path");
  };
  return { calls, runtime: { env, fetch: fetcher } };
}
export function equal(
  actual: unknown,
  expected: unknown,
  message = "Values differ",
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error(message + ": " + JSON.stringify({ actual, expected }));
  }
}
export function truth(value: unknown, message = "Expected true") {
  if (!value) throw Error(message);
}
