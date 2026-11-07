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
      'supabase/functions/_shared/homeCheck/landlordBatchPerf.test.ts',
      'supabase/functions/_shared/homeCheck/smsVideoPerf.test.ts',
      'supabase/functions/_shared/homeCheck/resultsFollowUpPerf.test.ts',
      'supabase/functions/_shared/homeCheck/manufactureCorrection.test.ts',
      'supabase/functions/_shared/homeCheck/homeCheckMedia.test.ts',
      'supabase/functions/_shared/homeCheck/openCopy.test.ts',
      'supabase/functions/_shared/homeCheck/photoViewReader.test.ts',
    ],
  },
})
