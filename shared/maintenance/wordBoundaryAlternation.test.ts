/**
 * Structural guard: bare alternation with \b on only one end is the
 * "rat"/"temperature" class of bug. Prefer \b(alt1|alt2|alt3)\b.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [
  'shared/maintenance',
  'supabase/functions/_shared/sms',
  'supabase/functions/_shared/maintenance_classification',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (
      p.endsWith('.ts') &&
      !p.endsWith('.test.ts') &&
      !p.includes('_test.ts')
    ) {
      out.push(p)
    }
  }
  return out
}

/** Regex literal bodies that contain both \b and |. */
function regexBodies(line: string): string[] {
  const out: string[] = []
  const re = /\/((?:\\\/|[^/\n])+?)\/[gimsuy]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const body = m[1]
    if (body.includes('|') && body.includes('\\b')) out.push(body)
  }
  return out
}

/**
 * True when alternation is group-wrapped with boundaries on both ends:
 * \b(a|b)\b or \b(?:a|b)\b (possibly with other \b elsewhere for multi-clause ORs).
 */
function hasGroupWrappedAlternation(body: string): boolean {
  return /\\b\(\?:?[^)]*\|[^)]*\)\\b/.test(body)
}

/**
 * Bad: \b then alts without an opening group paren — e.g. \bac|cool\b or
 * \bno heat|no ac|not heating\b.
 */
function hasLeadingBBareAlternation(body: string): boolean {
  // \b not followed by ( or (?: — then tokens/spaces, then |
  return /\\b(?!\(\?:?)(?:[a-zA-Z']+(?:\s+[a-zA-Z']+)*)\|/.test(body)
}

/**
 * Bad: |…token\b where the trailing \b is not a group close )\b after \b(.
 * Catches a|b\b and no heat|not heating\b when leading \b was also bare.
 */
function hasTrailingBBareAlternation(body: string): boolean {
  // Pipe, then ungrouped alts, then \b that is NOT )\b
  return /\|(?:[^/\n()\\]|\\(?!b))*[a-zA-Z0-9']\\b/.test(body) &&
    !hasGroupWrappedAlternation(body)
}

function findViolations(): string[] {
  const violations: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        const trimmed = line.trim()
        if (
          !trimmed ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          !trimmed.includes('|') ||
          !trimmed.includes('\\b')
        ) {
          return
        }
        for (const body of regexBodies(trimmed)) {
          if (hasGroupWrappedAlternation(body) && !hasLeadingBBareAlternation(body)) {
            continue
          }
          if (hasLeadingBBareAlternation(body) || hasTrailingBBareAlternation(body)) {
            violations.push(`${file}:${idx + 1}: ${trimmed.slice(0, 160)}`)
          }
        }
      })
    }
  }
  return violations
}

describe('word-boundary alternation (maintenance classification)', () => {
  it('has no bare \\b-on-one-end alternation in classification sources', () => {
    const violations = findViolations()
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('group-wrapped patterns reject the known false-match words', () => {
    expect(/\b(?:ac|cool(?:ing)?|air\s*condition(?:ing|er)?)\b/i.test('coolant')).toBe(
      false,
    )
    expect(/\b(?:ac|cool(?:ing)?|air\s*condition(?:ing|er)?)\b/i.test('no cooling')).toBe(
      true,
    )
    expect(/\b(?:lock|keys?|can'?t get in)\b/i.test('monkey')).toBe(false)
    expect(/\b(?:lock|keys?|can'?t get in)\b/i.test('key')).toBe(true)
    expect(
      /\b(?:roach(?:es)?|cockroach(?:es)?|mice|mouse|rat(?:s)?|bed\s*bugs?)\b/i.test(
        'temperature',
      ),
    ).toBe(false)
    expect(/\b(sink|drain|clog)\b/i.test('sinking')).toBe(false)
    expect(/\b(?:sag(?:ging)?|collaps(?:e|ed|ing)?|fall(?:ing)?)\b/i.test('saga')).toBe(
      false,
    )
    expect(/\b(smoke|fire)\b/i.test('fireplace')).toBe(false)
    expect(/\b(outlet|spark(?:s|ing)?|power|electric(?:al)?)\b/i.test('sparkle')).toBe(
      false,
    )
    expect(/\b(water|leak|drip|pour(?:ing)?)\b/i.test('waterfall')).toBe(false)
    expect(/\b(?:no heat|no ac|not cooling|not heating)\b/i.test('no heated')).toBe(
      false,
    )
    expect(/\b(?:no heat|no ac|not cooling|not heating)\b/i.test('no heat')).toBe(true)
  })
})
