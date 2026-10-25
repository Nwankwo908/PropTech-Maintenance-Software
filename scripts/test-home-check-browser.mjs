// Capture-page smoke is retired with the public upload form.
// The replacement checks live in src/components/HomeCheckPanel.test.tsx.
// This file stays so the old local command does not drive a deleted form or send a text.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../src/components/HomeCheckCapturePage.tsx', import.meta.url), 'utf8')
assert.match(page, /no longer used/)
assert.doesNotMatch(page, /type=["']file["']/)
assert.doesNotMatch(page, /homeCheckRequest/)
console.log('Retired Home Check link page has no upload form.')
