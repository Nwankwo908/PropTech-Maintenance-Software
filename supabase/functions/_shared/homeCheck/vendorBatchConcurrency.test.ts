import { expect, it, vi } from 'vitest'
import { identifyVendorHomeCheckBatch } from './vendorBatch.ts'

vi.mock('./photoSlot.ts', () => ({ readHomeCheckPhoto: vi.fn() }))

it('isolates overlapping checks when one download fails, one reader times out, and one set repeats a view', async () => {
  // In-process simulation only: no database, carrier, or AI-provider requests.
  const names = ['heatingWhole', 'waterLabel', 'heatingLabel', 'waterWhole']
  const count = 24
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let downloads = 0
  let readers = 0
  let peakReaders = 0
  const diagnostics = Array.from({ length: count }, () => [] as unknown[])
  const jobs = Array.from({ length: count }, (_, check) => {
    const paths = names.map(name => `disposable-${check % 2}/check-${check}/${name}`)
    return identifyVendorHomeCheckBatch(paths, async path => {
      if (++downloads === count * 4) release()
      await gate
      if (check === 0 && path.endsWith('waterLabel')) throw Error('Simulated storage failure')
      return { bytes: new TextEncoder().encode(path), contentType: 'image/jpeg' }
    }, async (bytes, _type, observe) => {
      peakReaders = Math.max(peakReaders, ++readers)
      try {
        await new Promise(resolve => setTimeout(resolve, check % 3))
        const name = new TextDecoder().decode(bytes).split('/').at(-1)!
        if (check === 1 && name === 'waterLabel') {
          observe?.({ phase: 'complete', outcome: 'timeout', durationMs: 17_000, provider: 'gemini' })
          return null
        }
        const water = name.startsWith('water')
        return { category: water ? 'water_heater' : 'hvac', photoView: {
          equipment: water ? 'water_heater' : 'heating_system',
          framing: check === 2 && name === 'waterWhole' || name.endsWith('Label') ? 'label_closeup' : 'whole_appliance',
          confidence: 'high',
        } } as never
      } finally { readers-- }
    }, event => diagnostics[check].push(event))
  })
  const results = await Promise.allSettled(jobs)
  expect(downloads).toBe(96)
  expect(peakReaders).toBeGreaterThanOrEqual(count)
  expect(results[0]).toMatchObject({ status: 'rejected', reason: expect.any(Error) })
  for (const check of [1, 2]) expect(results[check]).toMatchObject({ status: 'fulfilled', value: null })
  for (let check = 3; check < count; check++) {
    const result = results[check]
    if (result.status !== 'fulfilled') throw result.reason
    expect(result.value?.map(photo => photo.slot)).toEqual([
      'water_heater_label', 'water_heater_whole', 'heating_label', 'heating_whole',
    ])
    expect(result.value?.every(photo => photo.path.startsWith(`disposable-${check % 2}/check-${check}/`))).toBe(true)
    expect(diagnostics[check].at(-1)).toMatchObject({ stage: 'batch', outcome: 'success' })
  }
  expect(JSON.stringify(diagnostics)).not.toContain('disposable-')
})
