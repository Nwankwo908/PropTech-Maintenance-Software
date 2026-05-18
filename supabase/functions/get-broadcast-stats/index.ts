import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // 🔔 Active notifications (last 24h success)
  const { count: active } = await supabase
    .from("broadcast_notification_log")
    .select("*", { count: "exact", head: true })
    .eq("success", true)
    .gte(
      "created_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    )

  // 📈 Last 7 days success/failure
  const { data } = await supabase
    .from("broadcast_notification_log")
    .select("success, created_at")
    .gte(
      "created_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    )

  const success = data?.filter((d) => d.success).length ?? 0
  const failed = data?.filter((d) => !d.success).length ?? 0

  const successRate =
    success + failed === 0
      ? 0
      : Math.round((success / (success + failed)) * 100)

  return jsonResponse({
    activeNotifications: active ?? 0,
    successRate,
  })
})