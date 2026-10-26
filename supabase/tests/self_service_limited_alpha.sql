-- Local fixture schema only; real Auth accounts and seeded portfolios are never used.
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111','first@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','second@example.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','unverified@example.invalid',null);
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;
do $$ declare first jsonb; retry jsonb; begin
 first := public.ensure_my_limited_alpha_profile();
 retry := public.ensure_my_limited_alpha_profile();
 if first->>'label' <> 'Limited Alpha 3' or first <> retry then raise exception 'first signup / retry failed'; end if;
 if not public.can_mutate_onboarding_inventory((first->>'landlord_id')::uuid) then raise exception 'own onboarding denied'; end if;
end $$;
reset role;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;
do $$ declare second jsonb; begin
 second := public.ensure_my_limited_alpha_profile();
 if second->>'label' <> 'Limited Alpha 4' then raise exception 'second signup failed'; end if;
 if (select count(*) from public.limited_alpha_signup_profiles) <> 1 then raise exception 'profile RLS leaked'; end if;
 if public.can_mutate_onboarding_inventory((select landlord_id from public.landlord_portal_members where email='first@example.invalid')) then raise exception 'cross tenant onboarding allowed'; end if;
end $$;
reset role;
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set role authenticated;
do $$ begin
 begin perform public.ensure_my_limited_alpha_profile(); raise exception 'unverified signup accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set request.jwt.claim.sub = '';
set role authenticated;
do $$ begin
 begin perform public.ensure_my_limited_alpha_profile(); raise exception 'missing identity accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare target uuid; begin
 select landlord_id into target from public.limited_alpha_signup_profiles where alpha_number=3;
 update public.landlord_onboarding set onboarding_status='completed' where landlord_id=target;
 if not exists(select 1 from public.limited_alpha_signup_profiles where landlord_id=target and status='active' and activated_at is not null) then raise exception 'completion did not activate'; end if;
 if (select count(*) from public.landlords) <> 2 then raise exception 'duplicate or unverified landlord'; end if;
 if not public.can_mutate_onboarding_inventory('de300000-0000-4000-8000-000000000003') then raise exception 'seeded helper behavior changed'; end if;
 if has_function_privilege('anon','public.ensure_my_limited_alpha_profile()','execute') then raise exception 'anon may provision'; end if;
end $$;

-- Existing-member signup reuses its original account without profile reassignment.
insert into auth.users values ('44444444-4444-4444-8444-444444444444','existing@example.invalid',now());
insert into public.landlords(id,name,email) values ('99999999-9999-4999-8999-999999999999','Existing fixture','existing@example.invalid');
insert into public.landlord_portal_members values ('99999999-9999-4999-8999-999999999999','existing@example.invalid','team_member');
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set role authenticated;
do $$ declare result jsonb; begin
 result := public.ensure_my_limited_alpha_profile();
 if result->>'landlord_id' <> '99999999-9999-4999-8999-999999999999' or result->>'status' <> 'existing' then raise exception 'existing account reassigned'; end if;
 begin update public.limited_alpha_signup_profiles set status='active'; raise exception 'client may change profile registration'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'SIGNUP_SUITE_OK';
