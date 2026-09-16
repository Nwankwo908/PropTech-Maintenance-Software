/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inspectionRemovalActivity,
  isInspectionDocumentFile,
} from "./inspectionRemoval.ts"

Deno.test("PDF uploads are inspection documents", () => {
  assertEquals(isInspectionDocumentFile("4P_Okafor.pdf", "application/pdf"), true)
  assertEquals(isInspectionDocumentFile("report.PDF", "image/jpeg"), true)
  assertEquals(isInspectionDocumentFile("panel.jpg", "image/jpeg"), false)
})

Deno.test("document removal copy is landlord-facing", () => {
  assertEquals(
    inspectionRemovalActivity(true).message,
    "An inspection report was removed from this property.",
  )
  assertEquals(inspectionRemovalActivity(false).eventType, "inspection.photo_removed")
})
