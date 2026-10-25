import { describe, expect, it } from 'vitest'
import { buildInvitePreview } from '@/lib/inviteMessagePreview'

describe('buildInvitePreview', () => {
  it('shows the tenant welcome text with their first name', () => {
    const [text] = buildInvitePreview({
      kind: 'resident',
      recipientName: 'Sebastian Hall',
      companyName: 'Oak Properties',
      channel: 'sms',
    })
    expect(text?.label).toBe('Text')
    expect(text?.body).toContain('Hi Sebastian — this is the property management team at Oak Properties.')
    expect(text?.body).toContain('Reply YES to activate maintenance requests')
  })

  it('shows the vendor text and email that will be sent', () => {
    const blocks = buildInvitePreview({
      kind: 'vendor',
      recipientName: 'Flex Plumbing',
      companyName: 'Oak Properties',
      channel: 'both',
      link: 'https://www.ulohome.io/v/example',
    })
    expect(blocks.map((block) => block.label)).toEqual(['Text', 'Email'])
    expect(blocks[0]?.body).toContain('Hi Flex Plumbing,')
    expect(blocks[0]?.body).toContain('https://www.ulohome.io/v/example')
    expect(blocks[1]?.subject).toBe("You're invited to join our vendor network")
    expect(blocks[1]?.body).toContain('Start verification: https://www.ulohome.io/v/example')
  })
})
