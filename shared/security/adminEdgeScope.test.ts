import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionsRoot = join(process.cwd(), 'supabase/functions')

function functionIndexes(): string[] {
  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(functionsRoot, entry.name, 'index.ts'))
    .filter((path) => {
      try {
        return readFileSync(path, 'utf8').includes('requireAdminReassignAuth(')
      } catch {
        return false
      }
    })
}

describe('admin edge ownership', () => {
  it('does not ship the admin secret in browser auth code', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/adminEdgeAuth.ts'), 'utf8')
    expect(source).not.toContain('import.meta.env.VITE_ADMIN_REASSIGN_SECRET')
    expect(source).not.toContain('x-admin-reassign-secret')
    expect(source).toContain('x-ulo-access-token')
  })

  it('requires a landlord check or an explicit session-only marker', () => {
    const missing: string[] = []
    for (const path of functionIndexes()) {
      const source = readFileSync(path, 'utf8')
      const scoped =
        source.includes('denyUnless(') ||
        source.includes('assertAskUloLandlordAccess') ||
        source.includes('platformStaff') ||
        source.includes('session-scoped: caller-supplied content')
      if (!scoped) missing.push(path)
    }
    expect(missing).toEqual([])
  })
})
