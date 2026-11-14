/**
 * Run SMS fixtures through the sandbox and print the transcripts.
 *
 *   deno run --allow-env --allow-read --allow-net \
 *     supabase/functions/_shared/sms/sim/cli.ts [fixture.json ...]
 *
 * With no arguments, runs every fixture in ./fixtures. Exit code 1 if any
 * locked fixture fails. No SMS is sent and no network is used.
 */
import { checkFixture, formatTranscript, runFixture, type SmsFixture } from "./replay.ts"

const paths = Deno.args.length > 0 ? Deno.args : await (async () => {
  const dir = new URL("./fixtures/", import.meta.url)
  const out: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      out.push(new URL(entry.name, dir).pathname)
    }
  }
  return out.sort()
})()

// Keep pipeline logs out of the transcript.
const quiet = Deno.env.get("SMS_SIM_VERBOSE") !== "1"
const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log }
function silence() {
  if (!quiet) return
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
  console.log = () => {}
}
function restore() {
  Object.assign(console, realLog)
}

let lockedFailures = 0
for (const path of paths) {
  const fixture = JSON.parse(await Deno.readTextFile(path)) as SmsFixture
  silence()
  let run
  try {
    run = await runFixture(fixture)
  } finally {
    restore()
  }
  const failures = checkFixture(fixture, run)
  const verdict = failures.length === 0
    ? "PASS"
    : fixture.status === "known_bug"
    ? "KNOWN BUG (still reproduces)"
    : "FAIL"
  if (fixture.status === "locked" && failures.length > 0) lockedFailures += 1
  console.log(formatTranscript(fixture, run))
  console.log(`=> ${verdict}`)
  for (const f of failures) console.log(`   - ${f}`)
  console.log("")
}
Deno.exit(lockedFailures > 0 ? 1 : 0)
