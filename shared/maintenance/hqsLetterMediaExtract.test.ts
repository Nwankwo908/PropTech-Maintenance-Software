import { describe, expect, it } from 'vitest'
import { HQS_FIXTURE_DOC2_TEXT } from './hqsInspectionLetter.fixtures.ts'
import {
  extractHqsLetterFromPdfText,
  extractHqsLetterViaVisionOcr,
  resolveHqsLetterMediaRoute,
} from './hqsLetterMediaExtract.ts'

describe('HQS letter media routes', () => {
  it('routes application/pdf to pdf_text', () => {
    expect(
      resolveHqsLetterMediaRoute({ contentType: 'application/pdf', storagePathOrUrl: 'x.pdf' }),
    ).toBe('pdf_text')
  })

  it('routes image/* to vision_ocr (not rehost-only)', () => {
    expect(
      resolveHqsLetterMediaRoute({ contentType: 'image/jpeg', storagePathOrUrl: 'x.jpg' }),
    ).toBe('vision_ocr')
  })

  it('photo attachment runs vision OCR then extract', async () => {
    let ocrCalled = false
    const result = await extractHqsLetterViaVisionOcr({
      storagePathOrUrl: 'sms/conv/msg/letter.jpg',
      contentType: 'image/jpeg',
      ocrImage: async () => {
        ocrCalled = true
        return HQS_FIXTURE_DOC2_TEXT
      },
    })
    expect(ocrCalled).toBe(true)
    expect(result.route).toBe('vision_ocr')
    expect(result.extraction.standardItemCount).toBe(13)
    expect(result.extraction.emergencyItemCount).toBe(0)
  })

  it('PDF text path does not call vision', () => {
    const result = extractHqsLetterFromPdfText(HQS_FIXTURE_DOC2_TEXT)
    expect(result.route).toBe('pdf_text')
    expect(result.extraction.reinspectionDate).toBe('2026-09-28')
  })
})
