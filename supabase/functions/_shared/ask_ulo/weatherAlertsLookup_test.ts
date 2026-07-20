/**
 * Weather alerts routing + NWS packet shape tests.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloCapability } from "./capability.ts"
import { resolveCapabilityRoute } from "./capabilityRoute.ts"
import { detectQuestionSubject, isWeatherAlertsQuestion } from "./questionSubjectMatch.ts"
import { planEvidenceForQuestion } from "./subjectEvidenceGate.ts"
import { getDomainTool } from "./domainTools/registry.ts"

Deno.test("weather: subject + capability route to get_weather_alerts", () => {
  const q = "Are there any weather alerts that could affect my properties?"
  assertEquals(isWeatherAlertsQuestion(q), true)
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "weather")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "search")
  assertEquals(cap.hints.metric, "weather_alerts")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("get_weather_alerts"), true)
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.allowPortfolioBriefing, false)
  assertEquals(getDomainTool("get_weather_alerts")?.status, "live")
})

Deno.test("weather: detector ignores unrelated weather mentions in maintenance", () => {
  assertEquals(isWeatherAlertsQuestion("HVAC in extreme weather for Unit 304"), false)
})
