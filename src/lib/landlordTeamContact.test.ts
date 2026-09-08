import { describe, expect, it } from 'vitest'
import { teamMemberContactFromOnboarding } from '@shared/landlordTeamContact'

describe('teamMemberContactFromOnboarding', () => {
  it('reads team member email and phone from account setup and org settings', () => {
    expect(
      teamMemberContactFromOnboarding({
        draft_state: {
          accountSetup: {
            backupContactName: 'Sam Lee',
            backupContactPhone: '555-0100',
            backupContactEmail: 'sam@acme.test',
          },
        },
        account_settings: {},
      }),
    ).toEqual({
      name: 'Sam Lee',
      email: 'sam@acme.test',
      phone: '555-0100',
    })
  })

  it('fills from organization settings when the draft account fields are blank', () => {
    expect(
      teamMemberContactFromOnboarding({
        draft_state: { accountSetup: {} },
        account_settings: {
          organization: {
            backupContactName: 'Jordan',
            backupContactPhone: '555-0199',
            backupContactEmail: 'jordan@acme.test',
          },
        },
      }),
    ).toEqual({
      name: 'Jordan',
      email: 'jordan@acme.test',
      phone: '555-0199',
    })
  })
})
