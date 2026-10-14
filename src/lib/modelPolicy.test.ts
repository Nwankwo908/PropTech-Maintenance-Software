import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sources(file) : /\.(?:ts|tsx)$/.test(file) && !/(?:[._](?:test|spec)|fixtures)\./.test(file) ? [file] : []
  })
}
it('prevents the prohibited mini model from returning as a primary or fallback runtime model', () => {
  const prohibited = /gpt-4[o0]-mini(?:-\d{4}-\d{2}-\d{2})?/i
  const matches = ['src', 'shared', 'supabase/functions'].flatMap(sources).filter(file => prohibited.test(readFileSync(file, 'utf8')))
  expect(matches).toEqual([])
})
