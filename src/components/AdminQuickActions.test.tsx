/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AdminQuickActions } from '@/components/AdminQuickActions'

afterEach(() => {
  cleanup()
})

describe('AdminQuickActions', () => {
  it('opens Add resident, Add vendor, and Add property', () => {
    render(
      <MemoryRouter>
        <AdminQuickActions />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }))
    expect(screen.getByRole('menuitem', { name: 'Add resident' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Add vendor' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Add property' })).toBeTruthy()
  })
})
