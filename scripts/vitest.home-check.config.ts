import { defineConfig } from 'vitest/config'

// Backend routing tests use mocked I/O and do not enter the frontend TS project.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/homeCheck.test.ts',
      'shared/homeCheckVisit.test.ts',
      'supabase/functions/_shared/homeCheck/sms.test.ts',
      'supabase/functions/_shared/homeCheck/smsCopy.test.ts',
      'supabase/functions/_shared/homeCheck/service.test.ts',
      'supabase/functions/_shared/homeCheck/guideAct.test.ts',
      'supabase/functions/_shared/homeCheck/workflowPerf.test.ts',
    ],
  },
})
