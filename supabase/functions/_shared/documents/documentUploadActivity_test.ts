/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { documentUploadActivityMessage } from "./documentUploadActivity.ts"

Deno.test("upload activity uses a plain file name and no internal event wording", () => {
  assertEquals(
    documentUploadActivityMessage("qa-askulo/abc/qa-lease.pdf"),
    "Uploaded document ready to review: qa-lease.pdf.",
  )
  assertEquals(/text_saved|extracted|workflow/i.test(documentUploadActivityMessage("Lease.pdf")), false)
})
