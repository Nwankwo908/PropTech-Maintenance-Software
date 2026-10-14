import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve('src'), '@shared': path.resolve('shared') } },
  test: { environment: 'node', include: [
    'shared/onboarding/leaseScan.test.ts',
    'supabase/functions/_shared/onboarding/{leaseDocumentExtract,documentProvider}.test.ts',
    'src/lib/documentScanStream.test.ts',
    'src/components/onboarding/LeaseScanSummary.test.tsx',
    'src/lib/modelPolicy.test.ts',
    'src/lib/onboardingDocumentUpload.leaseScan.test.ts',
    'src/lib/onboarding/typedDocumentExtract*.test.ts',
  ] },
})
