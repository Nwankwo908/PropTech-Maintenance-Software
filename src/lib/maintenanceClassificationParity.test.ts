import { describe, expect, it } from 'vitest'
import {
  CLASSIFICATION_PARITY_EXAMPLES,
  inferTradeFromDescription,
} from './maintenanceClassificationParity'

describe('maintenanceClassificationParity', () => {
  it('classifies canonical examples via shared deterministic rules', () => {
    for (const { text, trade } of CLASSIFICATION_PARITY_EXAMPLES) {
      expect(inferTradeFromDescription(text), text).toBe(trade)
    }
  })
})
