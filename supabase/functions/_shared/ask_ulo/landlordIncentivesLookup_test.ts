/**
 * Landlord incentives routing + catalog packet tests.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloCapability } from "./capability.ts"
import { resolveCapabilityRoute } from "./capabilityRoute.ts"
import {
  detectQuestionSubject,
  isHonestGapSubjectQuestion,
  isLandlordIncentivesQuestion,
} from "./questionSubjectMatch.ts"
import { planEvidenceForQuestion } from "./subjectEvidenceGate.ts"
import { getDomainTool } from "./domainTools/registry.ts"
import { programsForTest } from "./landlordIncentivesLookup.ts"

Deno.test("incentives: subject + capability route to get_landlord_incentives", () => {
  const q = "What grants or tax incentives are available for landlords?"
  assertEquals(isLandlordIncentivesQuestion(q), true)
  assertEquals(isHonestGapSubjectQuestion(q), false)
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "incentives")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "search")
  assertEquals(cap.hints.metric, "landlord_incentives")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("get_landlord_incentives"), true)
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.allowPortfolioBriefing, false)
  assertEquals(getDomainTool("get_landlord_incentives")?.status, "live")
})

Deno.test("incentives: OR catalog includes state + federal programs", () => {
  const orPrograms = programsForTest("OR")
  assertEquals(orPrograms.some((p) => p.id === "or-ohcs"), true)
  assertEquals(orPrograms.some((p) => p.id === "hud-lihtc"), true)
  assertEquals(orPrograms.some((p) => p.officialUrl.startsWith("https://")), true)
})

Deno.test("incentives: detector ignores unrelated grant language", () => {
  assertEquals(
    isLandlordIncentivesQuestion("Can I grant a vendor access to Unit 304?"),
    false,
  )
})
