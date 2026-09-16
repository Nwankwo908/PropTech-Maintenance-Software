-- Persist the authorization_code access token alongside the refresh token.
alter table public.landlord_thumbtack_oauth
  add column if not exists access_token text,
  add column if not exists access_token_expires_at timestamptz;

comment on column public.landlord_thumbtack_oauth.access_token is
  'Latest Thumbtack authorization_code access token (service role only).';
comment on column public.landlord_thumbtack_oauth.access_token_expires_at is
  'When access_token expires, if Thumbtack returned expires_in.';
