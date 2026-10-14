import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sources(file) : /\.(?:ts|tsx)$/.test(file) && !/(?:[._](?:test|spec)|fixtures)\./.test(file) ? [file] : []
  })
}
it('keeps gpt-4o-mini limited to the Gemini lease and equipment backups', () => {
  const prohibited = /gpt-4[o0]-mini(?:-\d{4}-\d{2}-\d{2})?/i
  const allowed = new Set([
    'supabase/functions/_shared/onboarding/documentProvider.ts',
    'supabase/functions/_shared/vision/providers/equipmentRequest.ts',
    'supabase/functions/_shared/vision/serialFormat.ts',
    'src/lib/vision/types.ts',
  ].map(file => path.normalize(file)))
  const matches = ['src', 'shared', 'supabase/functions'].flatMap(sources).filter(file => prohibited.test(readFileSync(file, 'utf8')) && !allowed.has(path.normalize(file)))
  expect(matches).toEqual([])
})
