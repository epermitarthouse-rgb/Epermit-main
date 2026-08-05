insert into public.workspace_invitations (email, role, status, expires_at, token)
values ('iswain@commun-et.com', 'admin', 'pending', now() + interval '30 days', gen_random_uuid())
on conflict do nothing;