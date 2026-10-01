import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloJob } from "../../routing/classifyAskUloJob.ts"

Deno.test("classifyAskUloJob: portfolio late rent", () => {
  const r = classifyAskUloJob("Which tenants are late on rent at Maple Heights?")
  assertEquals(r.job, "portfolio_analyst")
})

Deno.test("classifyAskUloJob: product how-do-I", () => {
  const r = classifyAskUloJob("How do I send a welcome text to a resident?")
  assertEquals(r.job, "product_support")
  assertEquals(r.explicitSupportAsk, false)
})

Deno.test("classifyAskUloJob: explicit support ask", () => {
  const r = classifyAskUloJob("I need help from support — the invite button is stuck")
  assertEquals(r.job, "product_support")
  assertEquals(r.explicitSupportAsk, true)
})

Deno.test("classifyAskUloJob: legal / counsel topics stay legal", () => {
  const r = classifyAskUloJob(
    "Can I file an eviction notice for nonpayment under Georgia landlord-tenant law?",
  )
  assertEquals(r.job, "legal")
})

Deno.test("classifyAskUloJob: portfolio beats vague help when ops entities named", () => {
  const r = classifyAskUloJob("Help me — which work orders are awaiting approval?")
  assertEquals(r.job, "portfolio_analyst")
})
