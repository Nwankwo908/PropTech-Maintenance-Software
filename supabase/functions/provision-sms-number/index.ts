/** Retired: onboarding reuses the platform Ulo line; account allocation is unavailable. */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
serve(req => req.method === "OPTIONS" ? new Response("ok", { headers: adminEdgeCorsHeaders }) : new Response(JSON.stringify({
  error: "Dedicated SMS number provisioning is retired. Landlords use the shared Ulo number.", code: "SMS_NUMBER_PROVISIONING_RETIRED",
}), { status: 410, headers: { ...adminEdgeCorsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } }))
