import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/vision/equipmentLabel.test.ts',
      'shared/vision/equipmentAge.test.ts',
      'supabase/functions/_shared/vision/providers/equipment.test.ts',
      'supabase/functions/_shared/homeCheck/equipmentPair.test.ts',
      'shared/homeCheck.test.ts',
      'supabase/functions/_shared/homeCheck/sms.test.ts',
      'supabase/functions/_shared/homeCheck/service.test.ts',
    ],
  },
})
