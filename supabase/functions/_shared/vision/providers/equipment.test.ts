import { describe, expect, it, vi } from 'vitest'
import { createGeminiVisionProvider } from './gemini.ts'
import { createOpenAiVisionProvider } from './openai.ts'
import { withEquipmentBackup } from './equipmentFallback.ts'
import { equipmentResult } from './equipmentRequest.ts'
import { ageYearsFromManufactureDate } from '../../../../../shared/vision/equipmentAge.ts'

const raw = {
  category: 'water_heater',
  identifiedItem: {
    type: 'Water heater',
    brand: 'Rheem',
    modelNumber: 'X123',
    serialNumber: 'AB012345',
  },
  estimatedAge: { value: 11, confidence: 'high', basis: 'Serial estimate' },
  condition: { rating: 'fair', summary: 'Visible rust at base' },
  deficiencies: [],
  maintenanceRecommendations: [],
  overallConfidence: 95,
  labelReadability: {
    status: 'readable',
    modelConfidence: 96,
    serialConfidence: 95,
    uncertainCharacters: [],
    retakeRequested: false,
    formatWarnings: [],
  },
}
const images = {
  purpose: 'label' as const,
  referenceImages: [{ purpose: 'overview' as const, imageBase64: 'Ag==', mediaType: 'image/jpeg' }],
}
const geminiResponse = (value: unknown = raw) =>
  new Response(
    JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{ thought: true, text: 'not output' }, { text: JSON.stringify(value) }],
        },
      }],
    }),
  )
const openaiResponse = (value: unknown = raw) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
    }),
  )
describe('Equipment age from a printed manufacture date', () => {
  it('replaces a stale model age when the basis quotes March 2019', () => {
    const result = equipmentResult({
      ...raw,
      identifiedItem: { ...raw.identifiedItem, serialNumber: '' },
      estimatedAge: {
        value: 4,
        confidence: 'high',
        basis: 'Manufacture date is clearly visible as 03/2019.',
      },
    })
    expect(result.estimatedAge.value).toBe(
      ageYearsFromManufactureDate({ year: 2019, month: 3 }, new Date())?.value,
    )
    expect(result.estimatedAge.value).not.toBe(4)
    expect(result.estimatedAge.basis).toContain('March 2019')
  })
})

describe('Gemini and gpt-4o-mini equipment adapters', () => {
  it('uses Gemini 3.8 Flash with two labeled image inputs and strict evidence schema', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse())
    const result = await createGeminiVisionProvider('fixture-key', { fetchImpl }).analyzeImage(
      'AQ==',
      'water_heater',
      'image/jpeg',
      images,
    )
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/models/gemini-3.8-flash:generateContent')
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'fixture-key' })
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts.filter((part: Record<string, unknown>) => part.inlineData))
      .toHaveLength(2)
    expect(body.generationConfig.responseJsonSchema.required).toContain('labelReadability')
    expect(result.extractionTrace?.selectedModel).toBe('gemini-3.8-flash')
  })
  it('uses gpt-4o-mini and structured JSON, not arbitrary prose', async () => {
    const fetchImpl = vi.fn(async () => openaiResponse())
    const result = await createOpenAiVisionProvider('fixture-key', { fetchImpl }).analyzeImage(
      'AQ==',
      'water_heater',
      'image/jpeg',
      images,
    )
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url'))
      .toHaveLength(2)
    expect(body.response_format.json_schema.name).toBe('equipment_reading')
    expect(result.identifiedItem.serialNumber).toBe('AB012345')
    expect(result.extractionTrace?.selectedProvider).toBe('openai')
  })
  it('readable Gemini labels do not call the backup', async () => {
    const secondary = vi.fn(async () => openaiResponse())
    const result = await withEquipmentBackup(
      createGeminiVisionProvider('fixture', { fetchImpl: vi.fn(async () => geminiResponse()) }),
      createOpenAiVisionProvider('fixture', { fetchImpl: secondary }),
    ).analyzeImage('AQ==', undefined, 'image/jpeg', images)
    expect(secondary).not.toHaveBeenCalled()
    expect(result.extractionTrace?.selectedProvider).toBe('gemini')
  })
  it('unreadable Gemini labels get one gpt-4o-mini pass with both images', async () => {
    const unreadable = {
      ...raw,
      labelReadability: { ...raw.labelReadability, status: 'unreadable' },
    }
    const primary = vi.fn(async () => geminiResponse(unreadable))
    const secondary = vi.fn(async () => openaiResponse())
    const result = await withEquipmentBackup(
      createGeminiVisionProvider('fixture', { fetchImpl: primary }),
      createOpenAiVisionProvider('fixture', { fetchImpl: secondary }),
    ).analyzeImage('AQ==', undefined, 'image/jpeg', images)
    expect(primary).toHaveBeenCalledTimes(1)
    expect(secondary).toHaveBeenCalledTimes(1)
    expect(result.extractionTrace?.selectedModel).toBe('gpt-4o-mini')
    expect(result.extractionTrace?.attempts).toHaveLength(2)
    expect(result.labelReadability?.retakeRequested).toBe(false)
  })
  it('both readers failing to read a label produces a retake with unknown numbers', async () => {
    const value = { ...raw, labelReadability: { ...raw.labelReadability, status: 'unreadable' } }
    const result = await withEquipmentBackup(
      createGeminiVisionProvider('fixture', {
        fetchImpl: vi.fn(async () => geminiResponse(value)),
      }),
      createOpenAiVisionProvider('fixture', {
        fetchImpl: vi.fn(async () => openaiResponse(value)),
      }),
    ).analyzeImage('AQ==', undefined, 'image/jpeg', images)
    expect(result.identifiedItem.modelNumber).toBeUndefined()
    expect(result.identifiedItem.serialNumber).toBeUndefined()
    expect(result.estimatedAge.value).toBeNull()
    expect(result.labelReadability?.retakeMessage).toContain('closer photo without flash')
  })
  it('preserves a retake when the backup is unavailable, and exposes no key in errors', async () => {
    const value = { ...raw, labelReadability: { ...raw.labelReadability, status: 'unreadable' } }
    const result = await withEquipmentBackup(
      createGeminiVisionProvider('fixture', {
        fetchImpl: vi.fn(async () => geminiResponse(value)),
      }),
      createOpenAiVisionProvider('', { fetchImpl: vi.fn() }),
    ).analyzeImage('AQ==')
    expect(result.labelReadability?.retakeRequested).toBe(true)
    const failure = createGeminiVisionProvider('secret-fixture', {
      fetchImpl: vi.fn(async () => new Response('secret-fixture', { status: 401 })),
    })
    await expect(failure.analyzeImage('AQ==')).rejects.toThrow('HTTP 401')
  })
  it('rejects truncated, blocked, or evidence-free responses', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }))
    )
    await expect(createGeminiVisionProvider('fixture', { fetchImpl }).analyzeImage('AQ==')).rejects
      .toThrow('incomplete')
    expect(() => equipmentResult({ category: 'water_heater' })).toThrow('required evidence')
  })
  it('conflicting confident model readings remain unconfirmed after a backup', async () => {
    const first = {
      ...raw,
      labelReadability: {
        ...raw.labelReadability,
        status: 'uncertain',
        uncertainCharacters: [{ field: 'serialNumber', index: 2, alternatives: ['0', 'O'] }],
      },
    }
    const second = { ...raw, identifiedItem: { ...raw.identifiedItem, modelNumber: 'X128' } }
    const result = await withEquipmentBackup(
      createGeminiVisionProvider('fixture', {
        fetchImpl: vi.fn(async () => geminiResponse(first)),
      }),
      createOpenAiVisionProvider('fixture', {
        fetchImpl: vi.fn(async () => openaiResponse(second)),
      }),
    ).analyzeImage('AQ==')
    expect(result.identifiedItem.modelNumber).toBeUndefined()
    expect(result.labelReadability?.retakeRequested).toBe(true)
    expect(
      result.labelReadability?.uncertainCharacters.some((char) => char.field === 'modelNumber'),
    ).toBe(true)
  })
})
