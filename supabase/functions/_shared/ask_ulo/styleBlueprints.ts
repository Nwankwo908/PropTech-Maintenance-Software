/**
 * Dynamic few-shot style blueprints — injected only for intents that need them.
 * Contrast "AI slop" vs Ulo voice without baking examples into every system prompt.
 */

import type { AskUloIntent } from "./intent.ts"

export type StyleBlueprintTurn = {
  role: "user" | "assistant"
  content: string
}

/**
 * Returns 0–4 few-shot turns (user/assistant pairs) for the intent.
 * Empty for intents that already short-circuit via prefer-packets.
 */
export function styleBlueprintsForIntent(intent: AskUloIntent): StyleBlueprintTurn[] {
  if (intent === "legal") {
    return [
      {
        role: "user",
        content:
          "Can I evict a tenant for non-payment in 3 days?\n\n" +
          "Evidence: Local statute requires a written 5-day notice before filing.",
      },
      {
        role: "assistant",
        content:
          "No, not in this jurisdiction. Under the local rule on file, you have to give a written " +
          "**5-day** notice first — a 3-day eviction filing isn't enough on its own.\n\n" +
          "### How the timeline usually runs\n" +
          "- Serve the written notice and wait the full notice period\n" +
          "- If rent still isn't paid, then talk with counsel about the next filing step\n\n" +
          "## What I'd do\n" +
          "I'd confirm your notice form matches the statute, serve it correctly, and only then " +
          "decide on court with your attorney — I won't file anything for you.",
      },
      {
        role: "user",
        content:
          "(Style reminder — never answer like this)\n" +
          "Bad: Certainly! Let's delve into local regulations. It is important to note that…",
      },
      {
        role: "assistant",
        content:
          "Understood — I'll answer like a peer property manager: lead with yes/no, plain English, " +
          "no filler, no 'as an AI'.",
      },
    ]
  }

  if (intent === "general" || intent === "ops" || intent === "maintenance") {
    return [
      {
        role: "user",
        content: "Draft a short note to residents about a water shutoff tomorrow morning.",
      },
      {
        role: "assistant",
        content:
          "Here's a clean resident note you can send:\n\n" +
          "Hi everyone — this is the property management team.\n\n" +
          "We're shutting off water **tomorrow morning** for scheduled plumbing work. " +
          "Expect the outage for about **[time window]**.\n\n" +
          "Please store a little water tonight for cooking and washing. " +
          "We'll text again when service is back.\n\n" +
          "Thank you for your patience.",
      },
    ]
  }

  return []
}
