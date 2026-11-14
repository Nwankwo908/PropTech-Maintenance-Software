import { handlers } from "../inspection-activation/server_stub.ts";
await import("../../../supabase/functions/release-sms-number/index.ts");
for (const method of ["POST", "GET", "DELETE", "PUT", "PATCH"]) {
  for (const authorized of [false, true]) {
    Deno.test(`retired release: ${method}, authorization=${authorized} returns 410 without external effects`, async () => {
      const original = globalThis.fetch;
      globalThis.fetch = () => {
        throw Error("Retired endpoint must not use network");
      };
      try {
        const response = await handlers[0](
          new Request("https://retired.invalid", {
            method,
            headers: authorized
              ? { Authorization: "Bearer synthetic-session" }
              : {},
            ...(method === "POST" ? { body: "not-json" } : {}),
          }),
        );
        if (response.status !== 410) throw Error("Endpoint is not retired");
        const body = await response.json();
        if (body.code !== "SMS_NUMBER_RELEASE_RETIRED") {
          throw Error("Missing retirement code");
        }
      } finally {
        globalThis.fetch = original;
      }
    });
  }
}
Deno.test("retired release: OPTIONS remains a no-action preflight", async () => {
  const response = await handlers[0](
    new Request("https://retired.invalid", { method: "OPTIONS" }),
  );
  if (
    response.status !== 200 ||
    !response.headers.get("access-control-allow-headers")?.includes(
      "authorization",
    )
  ) throw Error("Preflight failed");
});
