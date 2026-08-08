/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { getWorkflowTemplate, listWorkflowTemplates } from "./registry.ts"
import { inspectionTemplate } from "./inspection.ts"
import { moveInTemplate } from "./moveIn.ts"
import { moveOutTemplate } from "./moveOut.ts"
import { vendorOnboardingTemplate } from "./vendorOnboarding.ts"

Deno.test("official lifecycle templates are registered", () => {
  const ids = new Set(listWorkflowTemplates().map((t) => t.id))
  for (const id of ["vendor_onboarding", "move_in", "move_out", "inspection"]) {
    assertEquals(ids.has(id), true)
  }
})

Deno.test("official engine files export the same templates as registry", () => {
  assertEquals(getWorkflowTemplate("vendor_onboarding"), vendorOnboardingTemplate)
  assertEquals(getWorkflowTemplate("move_in"), moveInTemplate)
  assertEquals(getWorkflowTemplate("move_out"), moveOutTemplate)
  assertEquals(getWorkflowTemplate("inspection"), inspectionTemplate)
})

Deno.test("lifecycle templates implement classify act escalate", () => {
  for (const template of [
    vendorOnboardingTemplate,
    moveInTemplate,
    moveOutTemplate,
    inspectionTemplate,
  ]) {
    assertEquals(typeof template.classify, "function")
    assertEquals(typeof template.act, "function")
    assertEquals(typeof template.escalate, "function")
  }
})
