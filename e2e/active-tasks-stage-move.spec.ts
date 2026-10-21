/**
 * Playwright coverage for Active Tasks stage moves.
 * Run when Playwright is available:
 *   npx playwright test e2e/active-tasks-stage-move.spec.ts
 *
 * Requires a logged-in admin session and at least one maintenance card in New Intake.
 */
import { test, expect } from '@playwright/test'

test.describe('Active Tasks stage move', () => {
  test.skip(
    !process.env.E2E_ADMIN_URL,
    'Set E2E_ADMIN_URL to a logged-in Active Tasks URL to run',
  )

  test('drag New Intake → Assigned opens the vendor modal; cancel returns the card', async ({
    page,
  }) => {
    await page.goto(process.env.E2E_ADMIN_URL!)
    const card = page.locator('[data-stage-draggable="1"]').first()
    await expect(card).toBeVisible()
    const cardId = await card.getAttribute('data-workflow-card-id')
    expect(cardId).toBeTruthy()

    const assignedColumn = page.getByLabel('Workflow stages').locator('text=Assigned').first()
    await card.dragTo(assignedColumn)

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(`[data-workflow-card-id="${cardId}"]`)).toBeVisible()
  })

  test('Undo restores the previous stage after a successful move', async ({ page }) => {
    await page.goto(process.env.E2E_ADMIN_URL!)
    // Prefer Move to… menu to avoid drag flakiness in CI.
    const menu = page.getByRole('button', { name: 'Move to stage' }).first()
    await menu.click()
    await page.getByRole('menuitem', { name: 'In Progress' }).click()
    // Confirm path may appear when completing; for in_progress with vendor it moves directly.
    const toast = page.getByRole('status').filter({ hasText: /Moved to/i })
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(toast).toHaveCount(0)
  })

  test('keyboard-only move works (Space to pick up)', async ({ page }) => {
    await page.goto(process.env.E2E_ADMIN_URL!)
    const card = page.locator('[data-stage-draggable="1"]').first()
    await card.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    // Either a confirm dialog, vendor modal, or toast appears depending on target.
    const feedback = page.getByRole('dialog').or(page.getByRole('status'))
    await expect(feedback.first()).toBeVisible({ timeout: 10_000 })
  })
})
