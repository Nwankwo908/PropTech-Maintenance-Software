import { describe, expect, it } from 'vitest'
import { splitMessageTextWithUrls } from './linkifyMessageText'

describe('splitMessageTextWithUrls', () => {
  it('keeps plain copy as a single text part', () => {
    expect(splitMessageTextWithUrls('Reply YES to accept the work order.')).toEqual([
      { type: 'text', text: 'Reply YES to accept the work order.' },
    ])
  })

  it('turns an https URL into a clickable part and keeps surrounding copy', () => {
    const parts = splitMessageTextWithUrls(
      'View details:\nhttps://app.ulohome.io/w/abc123\nThank you.',
    )
    expect(parts).toEqual([
      { type: 'text', text: 'View details:\n' },
      {
        type: 'url',
        text: 'https://app.ulohome.io/w/abc123',
        href: 'https://app.ulohome.io/w/abc123',
      },
      { type: 'text', text: '\nThank you.' },
    ])
  })

  it('treats www. hosts as https and strips trailing punctuation', () => {
    const parts = splitMessageTextWithUrls('Open www.ulohome.io/v/token.')
    expect(parts).toEqual([
      { type: 'text', text: 'Open ' },
      {
        type: 'url',
        text: 'www.ulohome.io/v/token',
        href: 'https://www.ulohome.io/v/token',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('does not treat javascript: as a link', () => {
    expect(splitMessageTextWithUrls('Ignore javascript:alert(1)')).toEqual([
      { type: 'text', text: 'Ignore javascript:alert(1)' },
    ])
  })
})
