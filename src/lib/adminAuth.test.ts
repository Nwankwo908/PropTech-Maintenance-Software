import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { emailFromAuthSession } from './adminAuth'

describe('emailFromAuthSession', () => {
  it('reads email from Google identity data when user.email is empty', () => {
    const session = {
      user: {
        email: undefined,
        user_metadata: {},
        identities: [
          {
            identity_data: { email: 'osi@ulohome.io' },
          },
        ],
      },
    } as unknown as Session
    expect(emailFromAuthSession(session)).toBe('osi@ulohome.io')
  })
})
