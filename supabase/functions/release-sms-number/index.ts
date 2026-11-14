/** Retired: landlords share the platform Ulo line; account-level release is unavailable. */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: adminEdgeCorsHeaders })
  }
  return new Response(JSON.stringify({
    error: "SMS number release is no longer available. Landlords use the shared Ulo number.",
    code: "SMS_NUMBER_RELEASE_RETIRED",
  }), {
    status: 410,
    headers: {
      ...adminEdgeCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  })
})
