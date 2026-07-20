import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  cadenceForDocumentType,
  FEED_KIND_CADENCE,
  isFeedDue,
  isOfficialRefreshUrl,
  nextCheckAtAfter,
  probeOfficialSource,
} from "./refreshCadence.ts"

Deno.test("FEED_KIND_CADENCE matches product policy", () => {
  assertEquals(FEED_KIND_CADENCE.federal_law, "daily")
  assertEquals(FEED_KIND_CADENCE.state_law, "daily")
  assertEquals(FEED_KIND_CADENCE.municipal_code_published, "weekly")
  assertEquals(FEED_KIND_CADENCE.municipal_pending_announcements, "daily")
  assertEquals(FEED_KIND_CADENCE.court_opinions, "daily")
  assertEquals(FEED_KIND_CADENCE.hud_dataset, "on_publisher_schedule")
  assertEquals(FEED_KIND_CADENCE.equipment_manual, "on_manufacturer_release")
})

Deno.test("cadenceForDocumentType", () => {
  assertEquals(cadenceForDocumentType("statute"), "daily")
  assertEquals(cadenceForDocumentType("municipal_code"), "weekly")
  assertEquals(cadenceForDocumentType("maintenance_manual"), "on_manufacturer_release")
  assertEquals(cadenceForDocumentType("government_guide"), "on_publisher_schedule")
})

Deno.test("nextCheckAtAfter daily and weekly", () => {
  const from = new Date("2026-07-14T12:00:00.000Z")
  const daily = nextCheckAtAfter("daily", from)
  assertEquals(daily.toISOString(), "2026-07-15T12:00:00.000Z")
  const weekly = nextCheckAtAfter("weekly", from)
  assertEquals(weekly.toISOString(), "2026-07-21T12:00:00.000Z")
})

Deno.test("nextCheckAtAfter respects HUD publisher release date", () => {
  const from = new Date("2026-07-14T12:00:00.000Z")
  const release = new Date("2026-10-01T00:00:00.000Z")
  const next = nextCheckAtAfter("on_publisher_schedule", from, {
    publisherNextReleaseAt: release,
  })
  assertEquals(next.toISOString(), release.toISOString())
})

Deno.test("isFeedDue", () => {
  assertEquals(isFeedDue("2020-01-01T00:00:00.000Z", new Date("2026-07-14")), true)
  assertEquals(isFeedDue("2099-01-01T00:00:00.000Z", new Date("2026-07-14")), false)
})

Deno.test("isOfficialRefreshUrl prefers .gov and rejects aggregators", () => {
  assertEquals(isOfficialRefreshUrl("https://www.huduser.gov/portal/datasets/fmr.html"), true)
  assertEquals(isOfficialRefreshUrl("https://www.oregonlegislature.gov/ors"), true)
  assertEquals(isOfficialRefreshUrl("https://www.courtlistener.com/opinion/1/"), false)
  assertEquals(isOfficialRefreshUrl("https://library.municode.com/or/portland"), false)
})

Deno.test("probeOfficialSource skips non-official hosts", async () => {
  const r = await probeOfficialSource({
    official_url: "https://www.courtlistener.com/x",
    official_api_url: null,
    last_etag: null,
    last_modified_header: null,
    content_fingerprint: null,
  })
  assertEquals(r.status, "skipped")
  assertEquals(r.changed, false)
})

Deno.test("probeOfficialSource detects fingerprint change", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("version-two-body", {
      status: 200,
      headers: { etag: '"abc"' },
    })
  const first = await probeOfficialSource(
    {
      official_url: "https://www.hud.gov/topics",
      official_api_url: null,
      last_etag: null,
      last_modified_header: null,
      content_fingerprint: null,
    },
    fetchImpl,
  )
  assertEquals(first.status, "ok")
  assertEquals(Boolean(first.fingerprint), true)

  const second = await probeOfficialSource(
    {
      official_url: "https://www.hud.gov/topics",
      official_api_url: null,
      last_etag: null,
      last_modified_header: null,
      content_fingerprint: "deadbeef",
    },
    fetchImpl,
  )
  assertEquals(second.status, "changed")
  assertEquals(second.changed, true)
})
