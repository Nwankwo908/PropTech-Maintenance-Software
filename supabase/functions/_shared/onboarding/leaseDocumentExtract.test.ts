import { describe, expect, it, vi } from 'vitest'
vi.mock('./leaseDocumentSource.ts', () => ({ leaseDocumentParts: vi.fn() }))
import { extractLeaseDocument } from './leaseDocumentExtract'
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
  it('limits Fast Track scans to the first four pages', async () => {
    buildParts.mockClear()
    const request = vi.fn(async () => response(leaseFixture([1, 2, 3, 4])))
    const result = await extractLeaseDocument({ ...input(), maxPages: FAST_TRACK_LEASE_SCAN_PAGES, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(buildParts.mock.calls.at(-1)?.[1]).toEqual([1, 2, 3, 4])
    expect(result.leaseReview.pageCount).toBe(4)
    expect(result.leaseReview.pagesProvided).toEqual([1, 2, 3, 4])
    expect(result.leaseReview.coverageComplete).toBe(true)
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
