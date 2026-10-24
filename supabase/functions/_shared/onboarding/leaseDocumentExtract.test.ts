import { describe, expect, it, vi } from 'vitest'
vi.mock('./leaseDocumentSource.ts', () => ({ leaseDocumentParts: vi.fn() }))
import { extractLeaseDocument } from './leaseDocumentExtract'
import { leaseReviewIssues } from '../../../../shared/onboarding/documentAttention'
import { FAST_TRACK_LEASE_SCAN_PAGES } from '../../../../shared/onboarding/leaseScan'
import { leaseFixture } from '../../../../shared/onboarding/leaseScan.fixtures'
import { GEMINI_DOCUMENT_MODEL, OPENAI_LEASE_BACKUP_MODEL, type DocumentProviderInput } from './documentProvider'

const buildParts = vi.fn(async (_input: unknown, pages: number[]) => [{ text: `Original pages ${pages.join(',')}` }])
const response = (raw: unknown, provider: 'gemini' | 'openai' = 'gemini') => ({ raw, provider, model: provider === 'gemini' ? GEMINI_DOCUMENT_MODEL : OPENAI_LEASE_BACKUP_MODEL, inputTokens: 2000, outputTokens: 300 })
const input = () => ({ apiKey: 'fixture', openaiApiKey: 'backup-fixture', bytes: new Uint8Array([1]), mimeType: 'application/pdf', pageTexts: Array.from({ length: 12 }, () => ''), buildParts })
describe('single-upload lease recovery', () => {
  it('reads every page and avoids extra calls when complete', async () => {
    const request = vi.fn(async () => response(leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))))
    const result = await extractLeaseDocument({ ...input(), request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(buildParts.mock.calls.at(-1)?.[1]).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(result.leaseReview.coverageComplete).toBe(true)
    expect(result.leaseReview.attempts[0].inputTokens).toBe(2000)
  })
  it('limits Fast Track scans to the first four pages and discloses the unread remainder', async () => {
    buildParts.mockClear()
    const request = vi.fn(async (call: DocumentProviderInput) => {
      const notice = String((call.parts[0] as { text?: string }).text ?? '')
      expect(notice).toContain('This document has 12 pages.')
      expect(notice).toContain('Supplied original pages: 1, 2, 3, 4.')
      expect(notice).toContain('Only the first 4 pages are included')
      expect(notice).not.toContain('Supplied original pages: 1, 2, 3, 4, 5')
      return response(leaseFixture([1, 2, 3, 4]))
    })
    const result = await extractLeaseDocument({ ...input(), maxPages: FAST_TRACK_LEASE_SCAN_PAGES, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(buildParts.mock.calls.at(-1)?.[1]).toEqual([1, 2, 3, 4])
    expect(result.leaseReview.pageCount).toBe(12)
    expect(result.leaseReview.pagesReviewed).toEqual([1, 2, 3, 4])
    expect(result.leaseReview.coverageComplete).toBe(false)
    expect(leaseReviewIssues(result.leaseReview).pages).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    expect(result.leaseReview.fields.tenant_names.value).toEqual(['Morgan Tenant'])
    expect(result.leaseReview.fields.monthly_rent.value).toBe(1500)
    expect(result.residents[0]?.monthlyRent).toBe('1500')
    expect(result.residents[0]?.leaseStart).toBe('2026-01-01')
    expect(result.residents[0]?.leaseEnd).toBe('2026-12-31')
  })
  it('does not treat a lease that fits in four pages as partially unread', async () => {
    buildParts.mockClear()
    const request = vi.fn(async () => response(leaseFixture([1, 2, 3, 4])))
    const result = await extractLeaseDocument({
      ...input(),
      pageTexts: Array.from({ length: FAST_TRACK_LEASE_SCAN_PAGES }, () => ''),
      maxPages: FAST_TRACK_LEASE_SCAN_PAGES,
      request,
    })
    expect(buildParts.mock.calls.at(-1)?.[1]).toEqual([1, 2, 3, 4])
    expect(result.leaseReview.pageCount).toBe(4)
    expect(result.leaseReview.coverageComplete).toBe(true)
    expect(leaseReviewIssues(result.leaseReview).pages).toEqual([])
  })
  it('keeps a term missing from the opening pages unknown instead of inventing it', async () => {
    buildParts.mockClear()
    const raw = leaseFixture([1, 2, 3, 4])
    raw.fields.unit = { ...raw.fields.unit, value: null, status: 'not_stated', quote: '' }
    raw.fields.monthly_rent = { ...raw.fields.monthly_rent, value: null, status: 'unreadable', quote: '' }
    const request = vi.fn(async () => response(raw))
    const result = await extractLeaseDocument({ ...input(), maxPages: FAST_TRACK_LEASE_SCAN_PAGES, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.leaseReview.fields.unit.value).toBeNull()
    expect(result.leaseReview.fields.unit.status).toBe('unreadable')
    expect(result.leaseReview.fields.unit.reviewReasons?.[0]).toMatch(/may still be present/)
    expect(result.leaseReview.fields.monthly_rent.value).toBeNull()
    expect(result.leaseReview.fields.monthly_rent.status).toBe('unreadable')
    expect(result.units).toEqual([])
    expect(result.residents[0]?.unit).toBe('')
    expect(result.residents[0]?.monthlyRent).toBe('')
    expect(result.residents[0]?.fullName).toBe('Morgan Tenant')
  })
  it('skips Fast Track recovery and field backup when Gemini returns a scan', async () => {
    buildParts.mockClear()
    const raw = leaseFixture([1, 2, 3, 4])
    raw.fields.monthly_rent = { ...raw.fields.monthly_rent, value: null, status: 'unreadable' }
    raw.fields.lease_start.quote = ''
    const request = vi.fn(async (call: DocumentProviderInput) => {
      expect(call.provider).toBe('gemini')
      expect(call.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM')
      return response(raw)
    })
    const result = await extractLeaseDocument({ ...input(), maxPages: FAST_TRACK_LEASE_SCAN_PAGES, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.leaseReview.attempts.map((attempt) => attempt.phase)).toEqual(['initial'])
    expect(result.leaseReview.pageCount).toBe(12)
    expect(result.leaseReview.coverageComplete).toBe(false)
    expect(result.leaseReview.fields.monthly_rent.value).toBeNull()
    expect(result.leaseReview.fields.monthly_rent.needsReview).toBe(true)
  })
  it('uses OpenAI on Fast Track only when Gemini completely fails', async () => {
    buildParts.mockClear()
    const request = vi.fn(async (call: DocumentProviderInput) => {
      if (call.provider === 'gemini') throw new Error('fixture gemini outage')
      expect(call.provider).toBe('openai')
      return response(leaseFixture([1, 2, 3, 4]), 'openai')
    })
    const stages: string[] = []
    const result = await extractLeaseDocument({
      ...input(),
      maxPages: FAST_TRACK_LEASE_SCAN_PAGES,
      request,
      onUpdate: (_partial, stage) => { stages.push(stage) },
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.leaseReview.attempts.map((attempt) => [attempt.provider, attempt.phase, attempt.outcome])).toEqual([
      ['gemini', 'initial', 'request_failed'],
      ['openai', 'backup', 'read'],
    ])
    expect(result.leaseReview.attempts[1].model).toBe(OPENAI_LEASE_BACKUP_MODEL)
    expect(result.leaseReview.attempts.every((attempt) => attempt.pages.join() === '1,2,3,4')).toBe(true)
    expect(result.leaseReview.pageCount).toBe(12)
    expect(result.leaseReview.coverageComplete).toBe(false)
    expect(stages).toContain('backup')
    expect(result.leaseReview.fields.tenant_names.status).toBe('found')
  })
  it('shows partial fields before rereading and recovers a late-page term', async () => {
    const raw = leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))
    raw.fields.monthly_rent = { ...raw.fields.monthly_rent, value: null, status: 'unreadable' }
    const stages: string[] = []
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 2) expect(stages).toContain('recovering')
      const found = leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))
      found.fields.monthly_rent.pages = [12]
      return response(request.mock.calls.length === 1 ? raw : found)
    })
    const result = await extractLeaseDocument({ ...input(), request, onUpdate: (partial, stage) => { stages.push(stage); if (stage === 'recovering') expect(partial?.leaseReview.fields.tenant_names.status).toBe('found') } })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.leaseReview.fields.monthly_rent.pages).toEqual([12])
    expect(result.leaseReview.needsReview).toBe(false)
  })
  it('uses gpt-4o-mini only after primary recovery leaves unclear fields', async () => {
    const raw = leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))
    raw.fields.monthly_rent.status = 'unreadable'
    const request = vi.fn(async (call: DocumentProviderInput) => response(call.provider === 'openai' ? leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1)) : raw, call.provider))
    const result = await extractLeaseDocument({ ...input(), request })
    expect(result.leaseReview.attempts.map(a => a.phase)).toEqual(['initial', 'recovery', 'backup'])
    expect(result.leaseReview.attempts[2].provider).toBe('openai')
    expect(result.leaseReview.attempts[2].model).toBe('gpt-4o-mini')
  })
  it('retains partial evidence and requests review when subsequent calls fail', async () => {
    const raw = leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))
    raw.fields.monthly_rent.status = 'unreadable'
    const request = vi.fn(async () => { if (request.mock.calls.length > 1) throw new Error('fixture outage'); return response(raw) })
    const result = await extractLeaseDocument({ ...input(), request })
    expect(result.leaseReview.needsReview).toBe(true)
    expect(result.leaseReview.fields.tenant_names.status).toBe('found')
    expect(result.leaseReview.attempts.map(a => a.outcome)).toEqual(['read', 'request_failed', 'request_failed'])
    expect(result.leaseReview.fields.monthly_rent.status).toBe('unreadable')
  })
  it('uses backup when the initial Gemini call fails', async () => {
    const request = vi.fn(async (call: DocumentProviderInput) => { if (call.provider === 'gemini') throw new Error('fixture'); return response(leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1)), 'openai') })
    const result = await extractLeaseDocument({ ...input(), request })
    expect(result.leaseReview.attempts.map(a => a.phase)).toEqual(['initial', 'backup'])
    expect(result.leaseReview.needsReview).toBe(false)
  })
  it('surfaces the OpenAI failure detail when both providers fail', async () => {
    const request = vi.fn(async () => {
      throw new Error('Document provider request failed (401). Check the provider configuration.')
    })
    await expect(extractLeaseDocument({ ...input(), request })).rejects.toThrow(
      /Lease reading is unavailable\. Document provider request failed \(401\)/,
    )
  })
  it('does not claim coverage for a PDF with unknown pages', async () => {
    await expect(extractLeaseDocument({ ...input(), pageTexts: [] })).rejects.toThrow('Could not verify')
  })
  it('verifies only missing pages when all lease fields already pass at 100% confidence', async () => {
    const first = leaseFixture([1])
    for (const field of Object.values(first.fields)) field.confidence = 100
    const request = vi.fn(async (call: DocumentProviderInput) => {
      if (request.mock.calls.length === 1) return response(first)
      expect(call.schema?.required).toContain('page_checks')
      expect(call.parts[0]).toMatchObject({ text: expect.stringContaining('Supplied original pages: 2') })
      expect(call.provider).toBe('gemini')
      const next = leaseFixture([2])
      next.fields.monthly_rent.value = 9999
      return response({ ...next, page_checks: { '2': { status: 'read', summary: 'Signature page' } } })
    })
    const result = await extractLeaseDocument({ ...input(), pageTexts: ['', ''], request })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.leaseReview.coverageComplete).toBe(true)
    expect(result.leaseReview.needsReview).toBe(false)
    expect(result.leaseReview.fields.monthly_rent.value).toBe(1500)
    expect(result.leaseReview.attempts[1].purpose).toBe('coverage')
    expect(result.leaseReview.attempts[1].model).toBe(GEMINI_DOCUMENT_MODEL)
    expect(result.leaseReview.pageChecks?.['2'].status).toBe('read')
  })
  it('uses gpt-4o-mini to verify a blank page the Gemini coverage pass could not confirm', async () => {
    const first = leaseFixture([1])
    const request = vi.fn(async (call: DocumentProviderInput) => {
      if (request.mock.calls.length === 1) return response(first)
      const next = leaseFixture([2])
      return response({ ...next, page_checks: { '2': { status: call.provider === 'openai' ? 'blank' : 'unreadable', summary: call.provider === 'openai' ? 'Blank page' : 'Unable to read page' } } }, call.provider)
    })
    const result = await extractLeaseDocument({ ...input(), pageTexts: ['', ''], request })
    expect(request).toHaveBeenCalledTimes(3)
    expect(result.leaseReview.attempts.map(attempt => attempt.provider)).toEqual(['gemini', 'gemini', 'openai'])
    expect(result.leaseReview.attempts[2].model).toBe('gpt-4o-mini')
    expect(result.leaseReview.complete).toBe(true)
    expect(result.leaseReview.pageChecks?.['2'].status).toBe('blank')
  })
  it('does not call coverage complete when a page remains unreadable at 100% field confidence', async () => {
    const first = leaseFixture([1])
    for (const field of Object.values(first.fields)) field.confidence = 100
    const request = vi.fn(async () => request.mock.calls.length === 1 ? response(first) : response({ ...leaseFixture([2]), page_checks: { '2': { status: 'unreadable', summary: 'Page cannot be read' } } }))
    const result = await extractLeaseDocument({ ...input(), pageTexts: ['', ''], request })
    expect(result.leaseReview.coverageComplete).toBe(false)
    expect(result.leaseReview.needsReview).toBe(true)
    expect(result.leaseReview.pagesReviewed).toEqual([1])
    expect(Object.values(result.leaseReview.fields).every(field => field.confidence === 100 && !field.needsReview)).toBe(true)
  })
})
