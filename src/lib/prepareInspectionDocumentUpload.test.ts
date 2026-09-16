import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pdfPageImagesBrowser', () => ({
  renderPdfFileToJpegDataUrls: async () => [
    'data:image/jpeg;base64,pageone',
    'data:image/jpeg;base64,pagetwo',
    'data:image/jpeg;base64,pagethree',
  ],
  extractPdfPageTexts: async () => ['563 Springdale Cir HVAC 9 years'],
}))

import { prepareInspectionDocumentUpload } from '@/lib/prepareInspectionDocumentUpload'

describe('prepareInspectionDocumentUpload', () => {
  it('stores the PDF and sends every rasterized page for vision', async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], '4P_Okafor.pdf', {
      type: 'application/pdf',
    })
    const prepared = await prepareInspectionDocumentUpload(file)
    expect(prepared.contentType).toBe('application/pdf')
    expect(prepared.fileName).toBe('4P_Okafor.pdf')
    expect(prepared.pageImages?.map((page) => page.base64)).toEqual([
      'pageone',
      'pagetwo',
      'pagethree',
    ])
    expect(prepared.pageTexts).toEqual(['563 Springdale Cir HVAC 9 years'])
  })
})
