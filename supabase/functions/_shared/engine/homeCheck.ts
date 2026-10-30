import type { WorkflowTemplate } from './types.ts'
import { sweepHomeCheckGuides } from '../homeCheck/guideAct.ts'
import { actHomeCheckSms, runHomeCheckReminder } from '../homeCheck/sms.ts'
import { startDueHomeCheckPhotoPrompts } from '../homeCheck/visitAct.ts'
import { checked, homeCheckEvent, type HomeCheckRow, requireData } from '../homeCheck/service.ts'

export const homeCheckTemplate: WorkflowTemplate = {
  id: 'home_check',
  name: 'Home Check',
  supportedTriggers: ['home_check', 'sms_inbound', 'cron'],
  classify(ctx) {
    return ctx.homeCheck
      ? { templateId: 'home_check', confidence: 'high', reason: 'explicit_scoped_home_check' }
      : null
  },
  async act(db, ctx) {
    if (ctx.homeCheck) {
      const result = await actHomeCheckSms(db, ctx.landlordId, ctx.homeCheck)
      return {
        templateId: 'home_check',
        route: 'home_check',
        runId: result.runId,
        replyHint: result.reply,
        metadata: { skipGenericAutoReply: true },
      }
    }
    if (ctx.trigger === 'cron') {
      const now = new Date().toISOString()
      const expired = requireData(
        await db.from('home_checks').select('*').eq('landlord_id', ctx.landlordId).eq(
          'status',
          'collecting',
        ).lte('expires_at', now),
      ) as HomeCheckRow[]
      for (const check of expired) {
        await checked(
          db.from('home_checks').update({ status: 'expired' }).eq('id', check.id).eq(
            'status',
            'collecting',
          ),
        )
        await checked(
          db.from('workflow_runs').update({
            status: 'cancelled',
            current_step: 'capture_expired',
            completed_at: now,
          }).eq('id', check.workflow_run_id).eq('status', 'active'),
        )
        await homeCheckEvent(db, check, 'expired')
      }
      const due = requireData(
        await db.from('home_checks').select('*').eq('landlord_id', ctx.landlordId).eq(
          'role',
          'tenant',
        ).eq('status', 'collecting').gt('expires_at', now).lte(
          'sent_at',
          new Date(Date.now() - 48 * 3600000).toISOString(),
        ).is('reminder_claimed_at', null),
      ) as HomeCheckRow[]
      let reminders = 0
      let guideReminders = 0
      let guideHandoffs = 0
      try {
        const guided = await sweepHomeCheckGuides(db, ctx.landlordId)
        guideReminders = guided.reminders
        guideHandoffs = guided.handoffs
      } catch (error) {
        console.error(
          '[home-check] guide sweep failed',
          error instanceof Error ? error.message : 'failed',
        )
      }
      for (const check of due) {
        try {
          await runHomeCheckReminder(db, check)
          reminders++
        } catch (error) {
          console.error(
            '[home-check] reminder failed',
            check.id,
            error instanceof Error ? error.message : 'failed',
          )
        }
      }
      return {
        templateId: 'home_check',
        route: 'home_check',
        metadata: { reminders, expired: expired.length, guideReminders, guideHandoffs },
      }
    }
    return {
      templateId: 'home_check',
      route: 'home_check',
      runId: ctx.activeRun?.id,
      metadata: { observation_only: true },
    }
  },
}
