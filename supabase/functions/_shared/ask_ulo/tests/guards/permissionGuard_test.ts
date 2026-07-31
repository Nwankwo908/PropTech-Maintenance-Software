/**
 * Permission guard — subject → capability mapping (no domain tools).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  applyPermissionToolGates,
  checkAskUloPermissions,
  requiredCapabilityForSubject,
} from "../../guards/permissionGuard.ts"
import type { AskUloContext } from "../../core/context.ts"
import type { AskUloPermissions } from "../../core/types.ts"

function fakeContext(perms: Partial<AskUloPermissions>, question: string): AskUloContext {
  const base: AskUloPermissions = {
    canAskLegal: true,
    canSeeResidents: true,
    canSeeVendors: true,
    canSeeFinance: true,
    ...perms,
  }
  return {
    supabase: null as unknown as AskUloContext["supabase"],
    question,
    landlordId: "ll_test",
    userId: "user_1",
    history: [],
    conversationId: null,
    agentMode: null,
    now: new Date(),
    startedAt: Date.now(),
    priorUserTurns: [],
    retrievalQuestion: question,
    portfolioJurisdiction: {
      stateCode: "OR",
      citySlug: "portland",
      cityLabel: "Portland",
      buildingCount: 1,
      sampleBuildings: ["Oakwood"],
      locationSource: "none",
    },
    propertyScope: {
      buildingFilter: null,
      sampleBuildings: ["Oakwood"],
      buildingCount: 1,
    },
    permissions: base,
    flags: { openAiEnabled: false, openAiToolSelect: false },
  }
}

Deno.test("requiredCapabilityForSubject maps resident/vendor/legal/finance", () => {
  assertEquals(requiredCapabilityForSubject("resident"), "canSeeResidents")
  assertEquals(requiredCapabilityForSubject("vendor"), "canSeeVendors")
  assertEquals(requiredCapabilityForSubject("legal"), "canAskLegal")
  assertEquals(requiredCapabilityForSubject("finance"), "canSeeFinance")
  assertEquals(requiredCapabilityForSubject("property"), null)
})

Deno.test("checkAskUloPermissions refuses resident ask without canSeeResidents", () => {
  const ctx = fakeContext(
    { canSeeResidents: false },
    "Which tenants are late on rent?",
  )
  const result = checkAskUloPermissions(ctx)
  assertEquals(result.allowed, false)
  if (!result.allowed) {
    assertEquals(result.capability, "canSeeResidents")
    assertStringIncludes(result.answer, "resident")
  }
})

Deno.test("checkAskUloPermissions allows vendor ask when canSeeVendors", () => {
  const ctx = fakeContext({}, "Which vendors respond fastest?")
  const result = checkAskUloPermissions(ctx)
  assertEquals(result.allowed, true)
  if (result.allowed) {
    assertEquals(result.subject, "vendor")
    assertEquals(result.checked.includes("canSeeVendors"), true)
  }
})

Deno.test("applyPermissionToolGates drops resident and vendor needs", () => {
  const gated = applyPermissionToolGates(
    {
      canAskLegal: true,
      canSeeResidents: false,
      canSeeVendors: false,
      canSeeFinance: true,
    },
    {
      needsListResidents: true,
      needsVendorBest: true,
      needsVendorResponseSpeed: true,
      runLegalTools: true,
    },
  )
  assertEquals(gated.needsListResidents, false)
  assertEquals(gated.needsVendorBest, false)
  assertEquals(gated.needsVendorResponseSpeed, false)
  assertEquals(gated.runLegalTools, true)
})
