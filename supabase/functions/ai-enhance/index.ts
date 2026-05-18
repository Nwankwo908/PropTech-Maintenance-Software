import { serve } from "https://deno.land/std/http/server.ts";
// @ts-expect-error Deno runtime resolves npm specifiers for Edge Functions.
import OpenAI from "npm:openai";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!Deno.env.get("OPENAI_API_KEY")) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const message =
      body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message.trim()
        : "";
    if (!message) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Rewrite the message to sound like a professional property manager speaking to residents.

Rules:
- Expand slightly for clarity
- Add helpful context if obvious
- Keep tone friendly and direct
- Do NOT use generic filler language
- Do NOT ignore the original meaning

Examples:

Input: "light bill is due"
Output: "Reminder: Your electricity bill is due soon. Please make your payment on time to avoid any service interruption."

Input: "maintenance tomorrow"
Output: "Reminder: Maintenance is scheduled for tomorrow. Please ensure access is available if needed."

Always produce output similar in style to these examples.
    `,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const out = response.choices?.[0]?.message?.content?.trim() ?? "";
    if (!out) {
      return new Response(
        JSON.stringify({ error: "AI returned empty content" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        message: out,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const rawDetail = error instanceof Error ? error.message : String(error);
    const detail = /incorrect api key/i.test(rawDetail)
      ? "OPENAI_API_KEY is invalid for ai-enhance"
      : rawDetail;
    return new Response(
      JSON.stringify({ error: detail }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
