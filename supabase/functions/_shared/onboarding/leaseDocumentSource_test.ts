import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PDFDocument, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { leaseDocumentParts } from './leaseDocumentSource.ts'
import { extractPortfolioDocument } from './portfolioDocumentExtract.ts'
import { documentBase64 } from './documentProvider.ts'
import { LEASE_FIELD_NAMES } from '../../../../shared/onboarding/leaseScan.ts'

async function mixedPdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4S8AAAAASUVORK5CYII='), c => c.charCodeAt(0))
  const scan = await pdf.embedPng(pixel)
  for (let i = 1; i <= 12; i++) {
    const page = pdf.addPage()
    if (i === 12) page.drawImage(scan, { x: 20, y: 20, width: 200, height: 200 })
    else page.drawText(`Page ${i}: Lease terms`, { x: 30, y: 700, font })
  }
  return new Uint8Array(await pdf.save())
}
Deno.test('native lease input retains every page and selected rereads preserve original numbering', async () => {
  const bytes = await mixedPdf(), pageTexts = Array.from({ length: 12 }, () => '')
  const full = await leaseDocumentParts({ bytes, mimeType: 'application/pdf', pageTexts }, pageTexts.map((_, i) => i + 1))
  assertEquals('bytes' in full[1] && full[1].bytes, bytes)
  const selected = await leaseDocumentParts({ bytes, mimeType: 'application/pdf', pageTexts }, [2, 12])
  assertEquals('text' in selected[0] && selected[0].text.includes('2, 12'), true)
  if (!('bytes' in selected[1])) throw new Error('Expected selected PDF')
  assertEquals((await PDFDocument.load(selected[1].bytes)).getPageCount(), 2)
})
Deno.test('mixed PDF extraction sends original bytes including scanned page 12 despite a short browser preview', async () => {
  const bytes = await mixedPdf(), originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    const native = body.contents[0].parts.find((part: { inlineData?: { mimeType: string } }) => part.inlineData?.mimeType === 'application/pdf')
    assertEquals(native.inlineData.data, documentBase64(bytes))
    const values: Record<string, unknown> = { tenant_names: ['Morgan Tenant'], property_address: '123 Example St', unit: '12A', lease_start: '2026-01-01', lease_end: '2026-12-31', monthly_rent: 1500, security_deposit: 0, rent_due_day: 1 }
    const raw = { fields: Object.fromEntries(LEASE_FIELD_NAMES.map(name => [name, { value: values[name], status: 'found', confidence: 96, pages: [12], quote: 'Lease terms on scanned page' }])), pages_reviewed: Array.from({ length: 12 }, (_, i) => i + 1), landlord_name: null, guarantor_names: [], property_manager_name: null, warnings: [] }
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] })
  }
  try {
    const result = await extractPortfolioDocument({ apiKey: 'fixture', fileName: 'lease.pdf', documentCategory: 'lease_agreement', contentType: 'application/pdf', bytes, pageImages: ['data:image/jpeg;base64,AQID'] })
    assertEquals(result.leaseReview?.pageCount, 12)
    assertEquals(result.leaseReview?.coverageComplete, true)
    assertEquals(result.leaseReview?.fields.monthly_rent.pages, [12])
    assertEquals(calls, 1)
  } finally { globalThis.fetch = originalFetch }
})
