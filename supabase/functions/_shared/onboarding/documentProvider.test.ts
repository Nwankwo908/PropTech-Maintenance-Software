import { describe, expect, it, vi } from 'vitest'
import { requestDocumentJson } from './documentProvider'
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
const gemini = () => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"rent":1500}' }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 200, thoughtsTokenCount: 50 } })
describe('document model transport', () => {
  it('uses Gemini structured output, high resolution, the native PDF and actual usage', async () => {
    const fetchImpl = vi.fn(async () => gemini())
    const result = await requestDocumentJson({ apiKey: 'fixture-key', system: 'Read this lease', parts: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' }], schema: { type: 'object' }, fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('models/gemini-3.8-flash:generateContent')
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH')
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'application/pdf', data: 'AQID' })
    expect(result.outputTokens).toBe(250)
    expect(result.raw).toEqual({ rent: 1500 })
  })
  it('uses gpt-4o-mini structured extraction for difficult native PDFs', async () => {
    const fetchImpl = vi.fn(async () => json({ choices: [{ finish_reason: 'stop', message: { content: '{"rent":1500}' } }], usage: { prompt_tokens: 1000, completion_tokens: 250 } }))
    const result = await requestDocumentJson({ provider: 'openai', apiKey: 'fixture-key', system: 'Read', parts: [{ bytes: new Uint8Array([1]), mimeType: 'application/pdf' }], schema: { type: 'object', properties: { confidence: { type: 'number', minimum: 0, maximum: 100 } } }, fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[1].content[0].type).toBe('file')
    expect(body.messages[1].content[0].file.file_data).toContain('data:application/pdf;base64,')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.properties.confidence.minimum).toBeUndefined()
    expect(result.inputTokens).toBe(1000)
    expect(result.provider).toBe('openai')
    expect(result.raw).toEqual({ rent: 1500 })
  })
  it('uploads large PDFs and deletes the temporary provider file after extraction', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/upload/v1beta/files')) return json({}, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/session' } })
      if (String(url).endsWith('/upload/session')) return json({ file: { name: 'files/fixture123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/fixture123', state: 'ACTIVE' } })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return gemini()
    })
    await requestDocumentJson({ apiKey: 'fixture-key', system: 'Read', parts: [{ bytes: new Uint8Array(10 * 1024 * 1024), mimeType: 'application/pdf' }], fetchImpl })
    expect(fetchImpl.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
    const generation = fetchImpl.mock.calls.find(([url]) => String(url).includes(':generateContent'))!
    expect(JSON.parse(String(generation[1]?.body)).contents[0].parts[0].fileData.mimeType).toBe('application/pdf')
  })
  it('rejects an untrusted upload URL before sending the document or key', async () => {
    const fetchImpl = vi.fn(async () => json({}, { headers: { 'x-goog-upload-url': 'https://untrusted.invalid/upload' } }))
    await expect(requestDocumentJson({ apiKey: 'fixture-key', system: 'Read', parts: [{ bytes: new Uint8Array(10 * 1024 * 1024), mimeType: 'application/pdf' }], fetchImpl })).rejects.toThrow('Invalid document upload destination')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects truncated output and sanitizes provider error bodies', async () => {
    await expect(requestDocumentJson({ apiKey: 'fixture', system: 'Read', parts: [], fetchImpl: async () => json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) })).rejects.toThrow('incomplete')
    await expect(requestDocumentJson({ apiKey: 'fixture', system: 'Read', parts: [], fetchImpl: async () => new Response('sensitive provider error', { status: 401 }) })).rejects.toThrow('Document provider request failed (401)')
  })
})
