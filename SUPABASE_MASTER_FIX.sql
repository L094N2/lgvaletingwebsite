-- LG Valeting emergency master/admin fix
-- Run this in Supabase > SQL Editor, then refresh admin.lgvaleting.com

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  phone text,
  role text not null default 'customer',
  permissions jsonb not null default '[]'::jsonb,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text not null,
  vehicle text not null,
  service text not null,
  date date not null,
  time text not null,
  location text not null,
  wax boolean not null default false,
  total numeric not null default 0,
  status text not null default 'Pending',
  source text not null default 'Website',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  rating int not null check (rating between 1 and 5),
  service text,
  text text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id,email,full_name,role,permissions,disabled)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'customer', '[]'::jsonb, false)
  on conflict (id) do update set email=excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.disabled=false and p.role in ('admin','master'));
$$;
create or replace function public.is_master()
returns boolean language sql stable security definer as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.disabled=false and p.role='master');
$$;

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.reviews enable row level security;
alter table public.admin_audit enable row level security;

drop policy if exists "profiles own read" on public.profiles;
create policy "profiles own read" on public.profiles for select using (auth.uid() = id or public.is_admin());
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (auth.uid() = id or public.is_master()) with check (auth.uid() = id or public.is_master());
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id or public.is_master());

drop policy if exists "bookings insert" on public.bookings;
create policy "bookings insert" on public.bookings for insert with check (auth.uid() = user_id or user_id is null or public.is_admin());
drop policy if exists "bookings read" on public.bookings;
create policy "bookings read" on public.bookings for select using (public.is_admin() or auth.uid() = user_id or lower(email) = lower((select email from auth.users where id=auth.uid())));
drop policy if exists "bookings admin update" on public.bookings;
create policy "bookings admin update" on public.bookings for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bookings admin delete" on public.bookings;
create policy "bookings admin delete" on public.bookings for delete using (public.is_admin());

drop policy if exists "reviews read" on public.reviews;
create policy "reviews read" on public.reviews for select using (approved=true or public.is_admin() or auth.uid()=user_id);
drop policy if exists "reviews insert" on public.reviews;
create policy "reviews insert" on public.reviews for insert with check (auth.uid() = user_id or user_id is null);
drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reviews admin delete" on public.reviews;
create policy "reviews admin delete" on public.reviews for delete using (public.is_admin());

drop policy if exists "audit admin read" on public.admin_audit;
create policy "audit admin read" on public.admin_audit for select using (public.is_admin());
drop policy if exists "audit admin insert" on public.admin_audit;
create policy "audit admin insert" on public.admin_audit for insert with check (public.is_admin());

insert into public.profiles (id,email,full_name,role,permissions,disabled)
select id,email,coalesce(raw_user_meta_data->>'full_name','Logan Shields'),'master',
'[
  "manageBookings",
  "addManualBookings",
  "manageReviews",
  "viewCustomers",
  "manageAdmins",
  "viewAnalytics"
]'::jsonb,false
from auth.users
where lower(email)=lower('logancrodden2912@icloud.com')
on conflict (id) do update set
  email=excluded.email,
  full_name=coalesce(public.profiles.full_name, excluded.full_name),
  role='master',
  permissions=excluded.permissions,
  disabled=false;
