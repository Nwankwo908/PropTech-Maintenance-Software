/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  COUNSEL_EXPERT_ROLES,
  formatCounselHandoffMarkdown,
  parseCounselExpertRoleId,
  recommendCounselExpert,
} from "./counselHandoff.ts"

Deno.test("recommendCounselExpert: eviction → landlord-tenant lawyer", () => {
  assertEquals(
    recommendCounselExpert([{ id: "eviction" }]),
    "landlord_tenant_lawyer",
  )
})

Deno.test("recommendCounselExpert: lead → compliance specialist", () => {
  assertEquals(
    recommendCounselExpert([{ id: "lead_environmental" }]),
    "compliance_specialist",
  )
})

Deno.test("recommendCounselExpert: screening → company attorney", () => {
  assertEquals(
    recommendCounselExpert([{ id: "tenant_screening" }]),
    "company_attorney",
  )
})

Deno.test("recommendCounselExpert: no topics → regional PM", () => {
  assertEquals(recommendCounselExpert([]), "regional_property_manager")
})

Deno.test("parseCounselExpertRoleId validates", () => {
  assertEquals(parseCounselExpertRoleId("company_attorney"), "company_attorney")
  assertEquals(parseCounselExpertRoleId("nope"), null)
})

Deno.test("formatCounselHandoffMarkdown lists suggested reviewer", () => {
  const md = formatCounselHandoffMarkdown({
    requireCounsel: true,
    counselNote: "High-stakes — review before acting.",
    recommendedExpertId: "landlord_tenant_lawyer",
  }).join("\n")
  assertEquals(md.includes("You may want a second opinion if"), true)
  assertEquals(md.includes("Suggested reviewer"), true)
  assertEquals(md.includes("landlord-tenant lawyer"), true)
  assertEquals(md.includes("← suggested"), false)
  for (const role of COUNSEL_EXPERT_ROLES) {
    // Full roster is no longer dumped; only the suggested reviewer is named.
    if (role.id === "landlord_tenant_lawyer") {
      assertEquals(md.includes(role.label), true)
    }
  }
})

Deno.test("formatCounselHandoffMarkdown omits when not high-stakes", () => {
  const md = formatCounselHandoffMarkdown({
    requireCounsel: false,
    counselNote: null,
    recommendedExpertId: "regional_property_manager",
    include: false,
  }).join("\n")
  assertEquals(md, "")
})
