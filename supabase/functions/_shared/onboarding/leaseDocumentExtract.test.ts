import { describe, expect, it, vi } from 'vitest'
vi.mock('./leaseDocumentSource.ts', () => ({ leaseDocumentParts: vi.fn() }))
import { extractLeaseDocument } from './leaseDocumentExtract'
import { leaseFixture } from '../../../../shared/onboarding/leaseScan.fixtures'
import { CLAUDE_DOCUMENT_MODEL, GEMINI_DOCUMENT_MODEL, type DocumentProviderInput } from './documentProvider'

const buildParts = vi.fn(async (_input: unknown, pages: number[]) => [{ text: `Original pages ${pages.join(',')}` }])
const response = (raw: unknown, provider: 'gemini' | 'claude' = 'gemini') => ({ raw, provider, model: provider === 'gemini' ? GEMINI_DOCUMENT_MODEL : CLAUDE_DOCUMENT_MODEL, inputTokens: 2000, outputTokens: 300 })
const input = () => ({ apiKey: 'fixture', anthropicApiKey: 'backup-fixture', bytes: new Uint8Array([1]), mimeType: 'application/pdf', pageTexts: Array.from({ length: 12 }, () => ''), buildParts })
describe('single-upload lease recovery', () => {
  it('reads every page and avoids extra calls when complete', async () => {
    const request = vi.fn(async () => response(leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))))
    const result = await extractLeaseDocument({ ...input(), request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(buildParts.mock.calls.at(-1)?.[1]).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(result.leaseReview.coverageComplete).toBe(true)
    expect(result.leaseReview.attempts[0].inputTokens).toBe(2000)
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
  it('uses Claude only after primary recovery leaves unclear fields', async () => {
    const raw = leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1))
    raw.fields.monthly_rent.status = 'unreadable'
    const request = vi.fn(async (call: DocumentProviderInput) => response(call.provider === 'claude' ? leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1)) : raw, call.provider))
    const result = await extractLeaseDocument({ ...input(), request })
    expect(result.leaseReview.attempts.map(a => a.phase)).toEqual(['initial', 'recovery', 'backup'])
    expect(result.leaseReview.attempts[2].model).toBe('claude-sonnet-5-5')
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
    const request = vi.fn(async (call: DocumentProviderInput) => { if (call.provider === 'gemini') throw new Error('fixture'); return response(leaseFixture(Array.from({ length: 12 }, (_, i) => i + 1)), 'claude') })
    const result = await extractLeaseDocument({ ...input(), request })
    expect(result.leaseReview.attempts.map(a => a.phase)).toEqual(['initial', 'backup'])
    expect(result.leaseReview.needsReview).toBe(false)
  })
  it('does not claim coverage for a PDF with unknown pages', async () => {
    await expect(extractLeaseDocument({ ...input(), pageTexts: [] })).rejects.toThrow('Could not verify')
  })
})
