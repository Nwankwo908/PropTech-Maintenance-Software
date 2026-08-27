import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyDocumentHead, applyRootMarkup } from './htmlShell'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8')

describe('htmlShell', () => {
  it('injects markup into the empty root and updates head tags', () => {
    const withHead = applyDocumentHead(indexHtml, {
      title: 'Terms of Service | Ulo',
      description: 'How Ulo Home collects information',
      canonical: 'https://app.ulohome.io/terms',
    })
    const withRoot = applyRootMarkup(withHead, '<h1>Terms of Service</h1>')

    expect(withRoot).toContain('<title>Terms of Service | Ulo</title>')
    expect(withRoot).toContain('content="How Ulo Home collects information"')
    expect(withRoot).toContain('href="https://app.ulohome.io/terms"')
    expect(withRoot).toContain('<div id="root"><h1>Terms of Service</h1></div>')
  })
})
