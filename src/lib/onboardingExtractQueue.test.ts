import { describe, expect, it } from 'vitest'
import { createSerialAsyncQueue } from './onboardingDocumentUpload'

describe('createSerialAsyncQueue', () => {
  it('runs work one after another', async () => {
    const enqueue = createSerialAsyncQueue()
    const order: number[] = []
    const first = enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push(1)
      return 'a'
    })
    const second = enqueue(async () => {
      order.push(2)
      return 'b'
    })
    await expect(Promise.all([first, second])).resolves.toEqual(['a', 'b'])
    expect(order).toEqual([1, 2])
  })
})
