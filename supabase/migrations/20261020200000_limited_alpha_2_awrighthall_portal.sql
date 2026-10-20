-- Grant Limited Alpha 2 portal access to awrighthall@gmail.com.

delete from public.landlord_portal_members
where lower(email) = 'awrighthall@gmail.com';

insert into public.landlord_portal_members (
  landlord_id,
  email,
  role
)
values (
  'de300000-0000-4000-8000-000000000004'::uuid,
  'awrighthall@gmail.com',
  'team_member'
);

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', ''))) ilike '%@property-admin.auth.local'
    or lower(trim(coalesce(auth.jwt() ->> 'email', ''))) in (
      'emeka@ulohome.io',
      'osi@ulohome.io',
      'demo@ulohome.io',
      'newlandlord@ulohome.io',
      'limitedalpha1@ulohome.io',
      'limitedalpha2@ulohome.io',
      'ceorentalsnj@gmail.com',
      'shaquillegurley@yahoo.com',
      'adeogunfowora@gmail.com',
      'o.k.okafor@gmail.com',
      'drake@gtwgroupnwa.com',
      'awrighthall@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;
