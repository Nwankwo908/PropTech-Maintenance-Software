/**
 * Outbound landlord ask/follow-up copy must never show SNOOZE or SKIP.
 * Legacy inbound parsing of those words stays in parseDecisionReply.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

const SOURCE_FILES = [
  new URL("./batchMessage.ts", import.meta.url),
  new URL("./executeDecisions.ts", import.meta.url),
]

Deno.test("no outbound landlord copy contains SNOOZE or SKIP", async () => {
  for (const url of SOURCE_FILES) {
    const text = await Deno.readTextFile(url)
    // Strip block comments and line comments so docstrings don't false-positive.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
    assertEquals(
      /SNOOZE/.test(code),
      false,
      `${url.pathname} must not contain outbound SNOOZE`,
    )
    assertEquals(
      /SKIP/.test(code),
      false,
      `${url.pathname} must not contain outbound SKIP`,
    )
  }
})
