import { adminEdgeCorsHeaders } from "../../../supabase/functions/_shared/admin_edge_cors.ts";
import { equal } from "./runtime.ts";
Deno.test("shared admin CORS explicitly permits all current dashboard header names", () => {
  const allowed = adminEdgeCorsHeaders["Access-Control-Allow-Headers"].split(
    ",",
  ).map((value) => value.trim().toLowerCase());
  equal(allowed.includes("*"), false);
  for (
    const name of [
      "authorization",
      "apikey",
      "content-type",
      "x-client-info",
      "x-ulo-access-token",
      "x-admin-reassign-secret",
    ]
  ) equal(allowed.includes(name), true);
});
