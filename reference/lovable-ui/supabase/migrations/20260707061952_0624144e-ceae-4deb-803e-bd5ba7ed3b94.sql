
-- =========================================================
-- Enums & role infrastructure
-- =========================================================
create type public.app_role as enum ('admin', 'staff', 'client');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users can view their own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);
create policy "Admins can view all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- Profiles
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  title text,
  company text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "Profiles are updatable by owner" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Profiles are insertable by owner" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- Auto-create a profile + default client role on new signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, title, company, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'title', ''),
    coalesce(new.raw_user_meta_data ->> 'company', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  insert into public.user_roles (user_id, role) values (new.id, 'client')
    on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- Client authorizations (executed LOAs)
-- =========================================================
create type public.signature_method as enum ('typed', 'drawn');

create table public.client_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Property owner + project
  owner_entity text not null,
  project_address text not null,
  additional_parties text,

  -- Signer
  signer_name text not null,
  signer_title text not null,
  signer_company text not null,
  signer_email text not null,
  signer_phone text,

  -- Authorization details
  effective_date date not null default (now() at time zone 'utc')::date,
  authorization_scope text not null default
    'Commun-ET LLC and all of its employees, officers, and authorized agents and subcontractors',

  -- Signature
  signature_method public.signature_method not null,
  typed_signature text,
  signature_image_path text,
  acknowledged boolean not null default false,

  -- Audit
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signature_present check (
    (signature_method = 'typed' and coalesce(length(trim(typed_signature)), 0) > 0)
    or (signature_method = 'drawn' and coalesce(length(signature_image_path), 0) > 0)
  )
);

grant select, insert, update on public.client_authorizations to authenticated;
grant all on public.client_authorizations to service_role;
alter table public.client_authorizations enable row level security;

create policy "Clients view their own LOAs" on public.client_authorizations
  for select to authenticated using (auth.uid() = user_id);
create policy "Clients insert their own LOAs" on public.client_authorizations
  for insert to authenticated with check (auth.uid() = user_id and acknowledged = true);
create policy "Clients cannot modify signed LOAs" on public.client_authorizations
  for update to authenticated using (false) with check (false);
create policy "Admins view all LOAs" on public.client_authorizations
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create index client_authorizations_user_id_idx on public.client_authorizations(user_id);
create index client_authorizations_signed_at_idx on public.client_authorizations(signed_at desc);
