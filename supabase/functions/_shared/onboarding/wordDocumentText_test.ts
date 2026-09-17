/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import JSZip from "npm:jszip@3.10.1"
import {
  detectWordBinaryKind,
  rtfToPlainText,
  wordBytesToPlainText,
  wordXmlToPlainText,
} from "./wordDocumentText.ts"

Deno.test("detectWordBinaryKind reads zip, ole, rtf, and pdf magics", () => {
  assertEquals(detectWordBinaryKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])), "docx")
  assertEquals(detectWordBinaryKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])), "doc")
  assertEquals(
    detectWordBinaryKind(new TextEncoder().encode("{\\rtf1\\ansi Hello}")),
    "rtf",
  )
  assertEquals(detectWordBinaryKind(new TextEncoder().encode("%PDF-1.7")), "pdf")
})

Deno.test("wordXmlToPlainText strips OOXML tags", () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>LEASE AGREEMENT</w:t></w:r></w:p><w:p><w:r><w:t>Tenant: Jane Doe</w:t></w:r></w:p></w:body></w:document>`
  const text = wordXmlToPlainText(xml)
  assertStringIncludes(text, "LEASE AGREEMENT")
  assertStringIncludes(text, "Jane Doe")
})

Deno.test("rtfToPlainText keeps visible lease copy", () => {
  const text = rtfToPlainText("{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Times;}}\\f0\\fs24 Residential Lease\\par Tenant Jane Doe\\par}")
  assertStringIncludes(text, "Residential Lease")
  assertStringIncludes(text, "Jane Doe")
})

Deno.test("wordBytesToPlainText reads a zip with only document.xml", async () => {
  const zip = new JSZip()
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>LEASE AGREEMENT Tenant Jane Doe Unit 4B</w:t></w:r></w:p></w:body></w:document>`,
  )
  const bytes = await zip.generateAsync({ type: "uint8array" })
  const text = await wordBytesToPlainText(bytes, "lease.docx")
  assertStringIncludes(text, "LEASE AGREEMENT")
  assertStringIncludes(text, "Jane Doe")
})

Deno.test("wordBytesToPlainText reads RTF saved as .doc", async () => {
  const bytes = new TextEncoder().encode(
    "{\\rtf1\\ansi Residential Lease Agreement\\par Tenant: Alex Rivera\\par Unit 2A\\par}",
  )
  const text = await wordBytesToPlainText(bytes, "lease.doc", "application/msword")
  assertStringIncludes(text, "Residential Lease")
  assertStringIncludes(text, "Alex Rivera")
})
