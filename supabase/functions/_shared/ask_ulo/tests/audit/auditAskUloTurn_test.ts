import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  auditAskUloTurn,
  writeAuditRecord,
} from "../../audit/auditAskUloTurn.ts"

Deno.test("writeAuditRecord is an alias of auditAskUloTurn", () => {
  assertEquals(writeAuditRecord, auditAskUloTurn)
})
