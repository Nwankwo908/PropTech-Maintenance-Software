-- New onboarding rows default to a $100 auto-approval threshold.
-- Existing $250 values were the previous product default, not an explicit choice.
alter table public.landlord_onboarding
  alter column auto_approval_threshold set default 100;

update public.landlord_onboarding
set
  auto_approval_threshold = 100,
  draft_state = case
    when draft_state is null then draft_state
    else jsonb_set(
      draft_state,
      '{approvalRules,autoApprovalThreshold}',
      '100'::jsonb,
      true
    )
  end,
  account_settings = case
    when account_settings #>> '{organization,autoApprovalLimit}' in ('250', '250.00')
      then jsonb_set(
        account_settings,
        '{organization,autoApprovalLimit}',
        '"100"'::jsonb,
        true
      )
    else account_settings
  end
where auto_approval_threshold = 250;
