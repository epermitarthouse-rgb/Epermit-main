-- Approval workflow for new members
do $$ begin
  create type public.member_approval_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists approval_status public.member_approval_status not null default 'pending',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejection_reason text;

-- Existing members should stay accessible.
update public.profiles p
set approval_status = 'approved', approved_at = coalesce(approved_at, p.created_at)
where approval_status = 'pending'
  and exists (select 1 from public.user_roles r where r.user_id = p.id);

-- Update signup trigger: pre-approve invited users, hold everyone else for admin review.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  invited_role public.app_role;
  invite_id uuid;
begin
  select id, role into invite_id, invited_role
  from public.workspace_invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  insert into public.profiles (id, email, full_name, title, company, phone, approval_status, approved_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'title', ''),
    coalesce(new.raw_user_meta_data ->> 'company', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when invite_id is not null then 'approved'::public.member_approval_status
         else 'pending'::public.member_approval_status end,
    case when invite_id is not null then now() else null end
  );

  if invite_id is not null then
    insert into public.user_roles (user_id, role)
    values (new.id, invited_role)
    on conflict do nothing;

    update public.workspace_invitations
      set status = 'accepted', accepted_by = new.id, accepted_at = now()
      where id = invite_id;
  end if;

  return new;
end;
$function$;

-- Approve / reject helpers (admin only, security-definer to bypass profile RLS).
create or replace function public.approve_member(_user_id uuid, _role public.app_role)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not authorized';
  end if;

  update public.profiles
     set approval_status = 'approved',
         approved_at = now(),
         approved_by = auth.uid(),
         rejection_reason = null
   where id = _user_id;

  insert into public.user_roles (user_id, role)
  values (_user_id, _role)
  on conflict (user_id, role) do nothing;
end;
$$;

create or replace function public.reject_member(_user_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not authorized';
  end if;

  delete from public.user_roles where user_id = _user_id;

  update public.profiles
     set approval_status = 'rejected',
         approved_at = null,
         approved_by = auth.uid(),
         rejection_reason = nullif(trim(_reason), '')
   where id = _user_id;
end;
$$;

grant execute on function public.approve_member(uuid, public.app_role) to authenticated;
grant execute on function public.reject_member(uuid, text) to authenticated;