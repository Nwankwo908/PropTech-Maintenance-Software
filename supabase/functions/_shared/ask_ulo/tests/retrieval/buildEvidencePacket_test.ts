/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildOrganizedEvidencePacket,
  emptyEvidenceBundle,
  finalizeEvidenceBundle,
  formatOrganizedEvidenceBlock,
  recordToolExecution,
  summarizeEvidencePacket,
} from "../../retrieval/buildEvidencePacket.ts"

Deno.test("buildOrganizedEvidencePacket splits internal / legal / market / missing", () => {
  const bundle = emptyEvidenceBundle({
    subject: "resident",
    capability: "search",
    organizationId: "org-1",
  })
  recordToolExecution(bundle, {
    tool: "search_residents",
    arguments: { filter: "late_rent" },
    resultCount: 1,
    success: true,
  })
  bundle.findings.residents = [
    {
      residentId: "r1",
      name: "Jordan Lee",
      unitLabel: "2B",
      propertyName: "Maple Heights",
      balanceDue: 1250,
      daysOverdue: 14,
      workflowRunId: "wr1",
    },
  ]
  const finalized = finalizeEvidenceBundle(bundle)

  const packet = buildOrganizedEvidencePacket({
    bundle: finalized,
    jurisdiction: { stateCode: "NJ", cityLabel: "Newark", citySlug: "newark" },
    legal: {
      bullets: ["Notice period is typically 30 days in this city."],
      citations: [
        {
          tool: "legal_rag",
          title: "NJ notice statute",
          citation: "N.J.S.A. demo",
          excerpt: "30 days",
          sourceTier: "primary_official",
          lastUpdatedOn: "2026-01-15",
        },
      ],
    },
    market: {
      provider: "rentcast",
      bullets: ["Estimated rent $2,100 as of 2026-06-01"],
      citations: [
        {
          tool: "market_data",
          title: "RentCast AVM",
          citation: "rentcast",
          excerpt: "$2100",
        },
      ],
    },
    missing: ["lease payment ledger detail"],
    now: new Date("2026-07-19T12:00:00Z"),
  })

  assertEquals(packet.internal.length >= 1, true)
  assertEquals(packet.internal[0]?.label, "Jordan Lee")
  assertEquals(packet.legal.length >= 1, true)
  assertEquals(packet.market.length >= 1, true)
  assertEquals(packet.missing.includes("lease payment ledger detail"), true)
  assertEquals(packet.meta.jurisdiction.stateCode, "NJ")
  assertEquals(packet.meta.asOf, "2026-07-19")
  assertEquals(packet.meta.hasEvidence, true)

  // Official legal citation should outrank a plain bullet
  assertEquals(packet.legal[0]?.label, "NJ notice statute")

  const block = formatOrganizedEvidenceBlock(packet)
  assertStringIncludes(block, "ORGANIZED EVIDENCE")
  assertStringIncludes(block, "INTERNAL")
  assertStringIncludes(block, "LEGAL")
  assertStringIncludes(block, "MARKET")
  assertStringIncludes(block, "MISSING")
  assertStringIncludes(block, "Jordan Lee")
  assertStringIncludes(block, "lease payment ledger detail")

  const summary = summarizeEvidencePacket(packet)
  assertEquals((summary.counts as Record<string, number>).internal >= 1, true)
})

Deno.test("dedupes duplicate resident rows and ranks by balance strength", () => {
  const bundle = emptyEvidenceBundle({
    subject: "resident",
    capability: "search",
    organizationId: "org-1",
  })
  bundle.findings.residents = [
    {
      residentId: "r-low",
      name: "Low Balance",
      balanceDue: 100,
      daysOverdue: 2,
      propertyName: "A",
    },
    {
      residentId: "r-high",
      name: "High Balance",
      balanceDue: 5000,
      daysOverdue: 40,
      propertyName: "B",
    },
    {
      residentId: "r-low",
      name: "Low Balance",
      balanceDue: 100,
      daysOverdue: 2,
      propertyName: "A",
    },
  ]
  const packet = buildOrganizedEvidencePacket({
    bundle: finalizeEvidenceBundle(bundle),
    now: new Date("2026-07-19T12:00:00Z"),
  })
  assertEquals(packet.internal.length, 2)
  assertEquals(packet.internal[0]?.label, "High Balance")
})

Deno.test("marks stale legal citations", () => {
  const bundle = emptyEvidenceBundle({
    subject: "legal",
    capability: "search",
    organizationId: "org-1",
  })
  const packet = buildOrganizedEvidencePacket({
    bundle: finalizeEvidenceBundle(bundle),
    legal: {
      citations: [
        {
          tool: "legal_rag",
          title: "Old ordinance",
          citation: "muni",
          sourceTier: "agency_guidance",
          lastUpdatedOn: "2024-01-01",
        },
      ],
    },
    now: new Date("2026-07-19T12:00:00Z"),
  })
  assertEquals(packet.legal[0]?.stale, true)
})

Deno.test("failed tool executions become missing entries", () => {
  const bundle = emptyEvidenceBundle({
    subject: "work_order",
    capability: "search",
    organizationId: "org-1",
  })
  recordToolExecution(bundle, {
    tool: "search_work_orders",
    arguments: {},
    resultCount: 0,
    success: false,
    error: "db timeout",
  })
  const packet = buildOrganizedEvidencePacket({
    bundle: finalizeEvidenceBundle(bundle),
  })
  assertEquals(
    packet.missing.some((m) => m.includes("search_work_orders") && m.includes("db timeout")),
    true,
  )
})
