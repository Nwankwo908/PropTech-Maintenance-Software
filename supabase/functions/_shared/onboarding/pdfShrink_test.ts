import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1"
import { shrinkPdfForExtract } from "./pdfShrink.ts"

Deno.test("shrinkPdfForExtract keeps a small PDF intact", async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 400])
  page.drawText("Lease", { x: 40, y: 200, size: 18, font })
  const bytes = new Uint8Array(await doc.save())
  const shrunk = await shrinkPdfForExtract(bytes, { maxPages: 8, maxBytes: 1_800_000 })
  assertEquals(shrunk.pageCount, 1)
  assertEquals(shrunk.usedPages, 1)
})

Deno.test("shrinkPdfForExtract caps page count", async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 5; i += 1) {
    const page = doc.addPage([400, 400])
    page.drawText(`Page ${i + 1}`, { x: 40, y: 200, size: 18, font })
  }
  const bytes = new Uint8Array(await doc.save())
  const shrunk = await shrinkPdfForExtract(bytes, { maxPages: 2, maxBytes: 1_800_000 })
  assertEquals(shrunk.pageCount, 5)
  assertEquals(shrunk.usedPages, 2)
})

Deno.test("shrinkPdfForExtract copies a later declarations page range", async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 20; i += 1) {
    const page = doc.addPage([400, 400])
    page.drawText(i === 14 ? "POLICY DECLARATIONS" : `Page ${i + 1}`, {
      x: 40,
      y: 200,
      size: 18,
      font,
    })
  }
  const bytes = new Uint8Array(await doc.save())
  const shrunk = await shrinkPdfForExtract(bytes, {
    maxPages: 3,
    maxBytes: 1_800_000,
    pageNumbers: [15, 16, 17],
  })
  assertEquals(shrunk.pageCount, 20)
  assertEquals(shrunk.usedPages, 3)
  assertEquals(shrunk.pageNumbers, [15, 16, 17])
})
