import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { getDomainTool } from "../../tools/_shared/registry.ts"

Deno.test("rank_properties and search_operations_graph are live domain tools", () => {
  assertEquals(getDomainTool("rank_properties")?.status, "live")
  assertEquals(getDomainTool("search_operations_graph")?.status, "live")
})

Deno.test("search_legal_sources and get_market_intelligence are live domain tools", () => {
  assertEquals(getDomainTool("search_legal_sources")?.status, "live")
  assertEquals(getDomainTool("get_market_intelligence")?.status, "live")
})
