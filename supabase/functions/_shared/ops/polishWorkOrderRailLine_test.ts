import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  needsWorkOrderRailLineRecovery,
  polishWorkOrderRailLine,
} from "./polishWorkOrderRailLine.ts"

Deno.test("needsWorkOrderRailLineRecovery catches stiff and awkward drafts", () => {
  assertEquals(
    needsWorkOrderRailLineRecovery(
      "Handyman Services By Michael never accepted. Vendor unresponsive — needs a new vendor choice.",
    ),
    true,
  )
  assertEquals(
    needsWorkOrderRailLineRecovery(
      "No acceptance from Handyman Services By Michael. Vendor unresponsive — needs a new vendor choice.",
    ),
    true,
  )
  assertEquals(
    needsWorkOrderRailLineRecovery(
      "Ecosafe proposed Wed 2–4pm. Waiting on confirmation.",
    ),
    true,
  )
  assertEquals(
    needsWorkOrderRailLineRecovery(
      "Waiting on Alex to confirm Flex Plumbing for Mon 2–4pm (asked 2h ago).",
    ),
    false,
  )
})

Deno.test("polishWorkOrderRailLine keeps draft when skipLlm", async () => {
  const result = await polishWorkOrderRailLine({
    draft:
      "Handyman Services By Michael never accepted. Vendor unresponsive — needs a new vendor choice.",
    skipLlm: true,
  })
  assertEquals(result.method, "deterministic")
  assertEquals(result.line.includes("Handyman Services By Michael"), true)
})

Deno.test("polishWorkOrderRailLine accepts Luna rewrite that keeps vendor name", async () => {
  const result = await polishWorkOrderRailLine({
    draft:
      "Handyman Services By Michael never accepted. Vendor unresponsive — needs a new vendor choice.",
    mustKeep: ["Handyman Services By Michael"],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Handyman Services By Michael still hasn't accepted — you'll need to pick another vendor.",
              },
            },
          ],
        }),
        { status: 200 },
      ),
  })
  assertEquals(result.method, "llm_polish")
  assertEquals(result.line.includes("Handyman Services By Michael"), true)
  assertEquals(/By never accepted/i.test(result.line), false)
})

Deno.test("polishWorkOrderRailLine rejects rewrite that drops the vendor name", async () => {
  const result = await polishWorkOrderRailLine({
    draft:
      "No acceptance from Handyman Services By Michael. Vendor unresponsive — needs a new vendor choice.",
    mustKeep: ["Handyman Services By Michael"],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "The vendor still hasn't accepted." } }],
        }),
        { status: 200 },
      ),
  })
  assertEquals(result.method, "deterministic")
  assertEquals(result.line.includes("Handyman Services By Michael"), true)
})
