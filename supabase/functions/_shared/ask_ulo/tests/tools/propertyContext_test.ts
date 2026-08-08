/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  companyPolicyBulletsFromApprovalRules,
  formatPropertyScopeClarifyMarkdown,
  legalOpsContextFromOpsBullets,
  needsPortfolioPropertyScope,
} from "../../tools/properties/propertyContext.ts"

Deno.test("needsPortfolioPropertyScope: rent increase", () => {
  assertEquals(needsPortfolioPropertyScope("Can I raise the rent?"), true)
  assertEquals(
    needsPortfolioPropertyScope("What notice do I need for a rent increase?"),
    true,
  )
})

Deno.test("needsPortfolioPropertyScope: generic statute question is false", () => {
  assertEquals(
    needsPortfolioPropertyScope("What is the maximum late fee under ORS for Oregon landlords?"),
    false,
  )
  assertEquals(
    needsPortfolioPropertyScope("Summarize federal Fair Housing Act protected classes"),
    false,
  )
})

Deno.test("needsPortfolioPropertyScope: section 8 / lease term", () => {
  assertEquals(needsPortfolioPropertyScope("Section 8 inspection tomorrow"), true)
  assertEquals(
    needsPortfolioPropertyScope("Is this unit month-to-month or fixed-term?"),
    true,
  )
})

Deno.test("formatPropertyScopeClarifyMarkdown lists buildings", () => {
  const md = formatPropertyScopeClarifyMarkdown(
    ["Maple Heights", "Oakwood Apartments"],
    "Can I raise the rent?",
  )
  assertStringIncludes(md, "Which property?")
  assertStringIncludes(md, "Maple Heights")
  assertStringIncludes(md, "Oakwood Apartments")
})

Deno.test("legalOpsContextFromOpsBullets strips ticket dumps", () => {
  const out = legalOpsContextFromOpsBullets([
    "Open maintenance tickets: 3 (filter: Maple Heights).",
    "Ticket abc12345: plumbing (high) — in_progress @ Maple Heights · 207.",
    "Open workflows: 2.",
  ])
  assertEquals(out.length >= 1, true)
  assertEquals(out.some((b) => /abc12345/.test(b)), false)
  assertEquals(out.some((b) => /3 open maintenance/i.test(b)), true)
})

Deno.test("companyPolicyBulletsFromApprovalRules includes auto-approve threshold", () => {
  const bullets = companyPolicyBulletsFromApprovalRules({
    autoApprovalThreshold: 250,
    afterHoursRule: "auto_approve_emergencies",
  })
  assertEquals(bullets.some((p) => /Auto-approve maintenance under \$250/.test(p)), true)
  assertEquals(bullets.some((p) => /After hours, emergencies/.test(p)), true)
})

Deno.test("companyPolicyBulletsFromApprovalRules handles require_approval after hours", () => {
  const bullets = companyPolicyBulletsFromApprovalRules({
    afterHoursRule: "require_approval",
  })
  assertEquals(bullets.some((p) => /After-hours work requires your approval/.test(p)), true)
})

Deno.test("formatPropertyScopeClarifyMarkdown encourages portfolio-specific answer", () => {
  const md = formatPropertyScopeClarifyMarkdown(["Cedar Court"], "Can I raise the rent?")
  assertStringIncludes(md, "local law")
  assertStringIncludes(md, "leases")
})
