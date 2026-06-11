create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories text[] not null default '{}'::text[],
  cadence text not null,
  delivery_time time not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_cadence_check
    check (cadence in ('daily', 'weekly', 'breaking', 'biweekly'))
);

create unique index if not exists users_email_unique_idx
  on public.users (lower(email));

create unique index if not exists users_full_name_unique_idx
  on public.users (lower(full_name))
  where full_name is not null and btrim(full_name) <> '';

alter table public.users enable row level security;
alter table public.user_preferences enable row level security;

drop policy if exists "Users can read their own profile" on public.users;
drop policy if exists "Users can insert their own profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;
drop policy if exists "Users can read their own preferences" on public.user_preferences;
drop policy if exists "Users can insert their own preferences" on public.user_preferences;
drop policy if exists "Users can update their own preferences" on public.user_preferences;

create policy "Users can read their own profile"
  on public.users
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.users
  for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can read their own preferences"
  on public.user_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own preferences"
  on public.user_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own preferences"
  on public.user_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, options)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    options = excluded.options,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.check_signup_availability(
  candidate_email text,
  candidate_full_name text
)
returns table (
  email_exists boolean,
  full_name_exists boolean
)
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from auth.users
      where lower(email) = lower(btrim(candidate_email))
    )
    or exists (
      select 1
      from public.users
      where lower(email) = lower(btrim(candidate_email))
    ) as email_exists,
    exists (
      select 1
      from auth.users
      where lower(raw_user_meta_data ->> 'full_name') =
        lower(btrim(candidate_full_name))
    )
    or exists (
      select 1
      from public.users
      where lower(full_name) = lower(btrim(candidate_full_name))
    ) as full_name_exists;
$$;

grant execute on function public.check_signup_availability(text, text)
  to anon, authenticated;

insert into public.users (id, email, full_name, options)
select
  id,
  email,
  raw_user_meta_data ->> 'full_name',
  coalesce(raw_user_meta_data, '{}'::jsonb)
from auth.users
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  options = excluded.options,
  updated_at = now();
