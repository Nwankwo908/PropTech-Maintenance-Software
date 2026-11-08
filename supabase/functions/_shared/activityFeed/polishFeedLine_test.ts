import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  needsFeedLineRecovery,
  polishActivityFeedLine,
} from "./polishFeedLine.ts"

Deno.test("needsFeedLineRecovery catches robotic drafts", () => {
  assertEquals(
    needsFeedLineRecovery(
      "Asked you to pick a vendor: No preferred vendor matched · leaking faucet",
    ),
    true,
  )
  assertEquals(
    needsFeedLineRecovery(
      "Told you No preferred vendor matched this request · The leaking kitchen faucet",
    ),
    true,
  )
  assertEquals(needsFeedLineRecovery("Noted Ecosafe accepted WO-074B"), true)
  assertEquals(
    needsFeedLineRecovery(
      "Handyman Services By Michael never accepted — needs reassignment",
    ),
    true,
  )
  assertEquals(
    needsFeedLineRecovery(
      "No acceptance from Handyman Services By Michael. Choose a new vendor.",
    ),
    true,
  )
  assertEquals(
    needsFeedLineRecovery(
      "Asked you to pick a vendor for the leaking kitchen faucet at 14 Maple Ave (WO-A1B2) — no preferred match",
    ),
    false,
  )
  assertEquals(needsFeedLineRecovery("Ecosafe accepted WO-074B at 14 Maple Ave"), false)
})

Deno.test("polishActivityFeedLine keeps draft when skipLlm", async () => {
  const result = await polishActivityFeedLine({
    draft: "Noted Ecosafe accepted WO-074B at 14 Maple Ave",
    skipLlm: true,
  })
  assertEquals(result.method, "deterministic")
  assertEquals(result.line, "Noted Ecosafe accepted WO-074B at 14 Maple Ave")
})

Deno.test("polishActivityFeedLine accepts Luna rewrite that keeps protected tokens", async () => {
  const result = await polishActivityFeedLine({
    draft: "Noted Ecosafe accepted WO-074B at 14 Maple Ave",
    mustKeep: ["WO-074B", "14 Maple Ave"],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Ecosafe accepted WO-074B at 14 Maple Ave",
              },
            },
          ],
        }),
        { status: 200 },
      ),
  })
  assertEquals(result.method, "llm_polish")
  assertEquals(result.line, "Ecosafe accepted WO-074B at 14 Maple Ave")
})

Deno.test("polishActivityFeedLine rejects rewrite that drops a work-order ref", async () => {
  const result = await polishActivityFeedLine({
    draft: "Noted Ecosafe accepted WO-074B at 14 Maple Ave",
    mustKeep: ["WO-074B", "14 Maple Ave"],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ecosafe accepted the job" } }],
        }),
        { status: 200 },
      ),
  })
  assertEquals(result.method, "deterministic")
  assertEquals(result.line.includes("WO-074B"), true)
})
