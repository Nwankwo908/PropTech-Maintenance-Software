import { describe, expect, it } from 'vitest'
import {
  importActorActivityMetadata,
  importActorUserColumns,
} from './importActor'

describe('importActor helpers', () => {
  it('maps actor fields onto user columns', () => {
    expect(
      importActorUserColumns(
        {
          userId: 'user-1',
          email: 'nwankwo908@gmail.com',
          sessionId: 'sess_abc',
        },
        '2026-09-25T21:00:00.000Z',
      ),
    ).toEqual({
      imported_by_user_id: 'user-1',
      imported_by_email: 'nwankwo908@gmail.com',
      import_session_id: 'sess_abc',
      imported_at: '2026-09-25T21:00:00.000Z',
    })
  })

  it('maps actor fields onto activity metadata', () => {
    expect(
      importActorActivityMetadata({
        userId: 'user-1',
        email: 'nwankwo908@gmail.com',
        sessionId: 'sess_abc',
      }),
    ).toEqual({
      initiated_by_user_id: 'user-1',
      initiated_by_email: 'nwankwo908@gmail.com',
      import_session_id: 'sess_abc',
    })
  })
})
