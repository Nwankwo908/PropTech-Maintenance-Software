/// <reference lib="deno.ns" />
/**
 * Replays every SMS fixture in ./fixtures through the real inbound pipeline.
 *
 * - locked fixtures must pass.
 * - known_bug fixtures pass while the bug still reproduces, and fail once it
 *   is fixed, with a reminder to change their status to "locked".
 */
import { checkFixture, formatTranscript, runFixture, type SmsFixture } from "./replay.ts"

const dir = new URL("./fixtures/", import.meta.url)
const fixtures: SmsFixture[] = []
for await (const entry of Deno.readDir(dir)) {
  if (!entry.isFile || !entry.name.endsWith(".json")) continue
  const fixture = JSON.parse(
    await Deno.readTextFile(new URL(entry.name, dir)),
  ) as SmsFixture
  if (`${fixture.id}.json` !== entry.name) {
    throw new Error(`Fixture ${entry.name} must have id "${entry.name.replace(/\.json$/, "")}"`)
  }
  fixtures.push(fixture)
}
fixtures.sort((a, b) => a.id.localeCompare(b.id))

Deno.test("sms sandbox: fixtures directory is not empty", () => {
  if (fixtures.length === 0) throw new Error("No SMS fixtures found")
})

for (const fixture of fixtures) {
  Deno.test({
    name: `sms replay [${fixture.status}] ${fixture.id}: ${fixture.title}`,
    // The pipeline schedules fire-and-forget writes; the fake DB absorbs them.
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const run = await runFixture(fixture)
      const failures = checkFixture(fixture, run)
      if (fixture.status === "locked" && failures.length > 0) {
        throw new Error(
          `Regression in ${fixture.id}:\n- ${failures.join("\n- ")}\n\n${formatTranscript(fixture, run)}`,
        )
      }
      if (fixture.status === "known_bug" && failures.length === 0) {
        throw new Error(
          `${fixture.id} now behaves as expected. The bug looks fixed: set "status": "locked" ` +
            `and remove "currentBehavior" in fixtures/${fixture.id}.json.`,
        )
      }
    },
  })
}
