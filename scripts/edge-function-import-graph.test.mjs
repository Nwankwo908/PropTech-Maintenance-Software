import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('deployment hash includes lazy local dependencies and their transitive imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'ulo-import-graph-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'supabase/functions/probe'), { recursive: true })
    copyFileSync(new URL('./edge-function-import-graph.mjs', import.meta.url), join(root, 'scripts/edge-function-import-graph.mjs'))
    writeFileSync(join(root, 'supabase/functions/probe/index.ts'), 'export async function probe() { return import(\n "./lazy.ts"\n) }')
    writeFileSync(join(root, 'supabase/functions/probe/lazy.ts'), 'export { value } from "./leaf.ts"')
    const leaf = join(root, 'supabase/functions/probe/leaf.ts')
    writeFileSync(leaf, 'export const value = 1')
    const read = () => JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/edge-function-import-graph.mjs'), 'probe'], { encoding: 'utf8' }))
    const before = read()
    assert.equal(before.fileCount, 3)
    assert.ok(before.files.includes('supabase/functions/probe/lazy.ts'))
    writeFileSync(leaf, 'export const value = 2')
    assert.notEqual(read().hash, before.hash)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
