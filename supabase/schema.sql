create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  email_unsubscribe_token text not null default replace(gen_random_uuid()::text, '-', ''),
  email_unsubscribed_at timestamptz,
  last_digest_sent_at timestamptz,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories text[] not null default '{}'::text[],
  cadence text not null,
  delivery_mode text not null default 'scheduled',
  delivery_time time not null,
  timezone text not null default 'UTC',
  breaking_alerts_enabled boolean not null default false,
  alert_threshold integer not null default 8,
  max_alerts_per_day integer not null default 3,
  watchlist_keywords text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_cadence_check
    check (cadence in ('daily', 'weekly', 'breaking', 'biweekly')),
  constraint user_preferences_delivery_mode_check
    check (delivery_mode in ('scheduled', 'realtime')),
  constraint user_preferences_alert_threshold_check
    check (alert_threshold between 1 and 10),
  constraint user_preferences_max_alerts_per_day_check
    check (max_alerts_per_day between 1 and 25)
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_type text not null,
  title text not null,
  url text not null,
  doi text,
  abstract text,
  authors text[] not null default '{}'::text[],
  categories text[] not null default '{}'::text[],
  importance_score integer not null default 0,
  is_breaking boolean not null default false,
  breaking_reason text,
  matched_entities text[] not null default '{}'::text[],
  published_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  url_hash text not null,
  doi_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_source_type_check
    check (source_type in ('arxiv', 'rss', 'news')),
  constraint articles_importance_score_check
    check (importance_score between 0 and 10)
);

create table if not exists public.article_summaries (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  interest_categories text[] not null default '{}'::text[],
  summary text not null,
  why_this_matters text not null,
  model text not null,
  prompt_version text not null default 'phase-3-v1',
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint article_summaries_token_check
    check (
      (input_tokens is null or input_tokens >= 0)
      and (output_tokens is null or output_tokens >= 0)
    )
);

create table if not exists public.user_article_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  summary_id uuid references public.article_summaries(id) on delete set null,
  status text not null default 'summarized',
  first_seen_at timestamptz not null default now(),
  summarized_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id),
  constraint user_article_reads_status_check
    check (status in ('queued', 'summarized', 'delivered', 'read', 'skipped'))
);

alter table public.users
  add column if not exists email_unsubscribe_token text
    not null default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists last_digest_sent_at timestamptz;

alter table public.user_preferences
  add column if not exists breaking_alerts_enabled boolean not null default false,
  add column if not exists alert_threshold integer not null default 8,
  add column if not exists delivery_mode text not null default 'scheduled',
  add column if not exists max_alerts_per_day integer not null default 3,
  add column if not exists watchlist_keywords text[] not null default '{}'::text[];

alter table public.user_preferences
  drop constraint if exists user_preferences_delivery_mode_check;

alter table public.user_preferences
  add constraint user_preferences_delivery_mode_check
    check (delivery_mode in ('scheduled', 'realtime'));

alter table public.user_preferences
  drop constraint if exists user_preferences_alert_threshold_check;

alter table public.user_preferences
  add constraint user_preferences_alert_threshold_check
    check (alert_threshold between 1 and 10);

alter table public.user_preferences
  drop constraint if exists user_preferences_max_alerts_per_day_check;

alter table public.user_preferences
  add constraint user_preferences_max_alerts_per_day_check
    check (max_alerts_per_day between 1 and 25);

alter table public.articles
  add column if not exists importance_score integer not null default 0,
  add column if not exists is_breaking boolean not null default false,
  add column if not exists breaking_reason text,
  add column if not exists matched_entities text[] not null default '{}'::text[];

alter table public.articles
  drop constraint if exists articles_importance_score_check;

alter table public.articles
  add constraint articles_importance_score_check
    check (importance_score between 0 and 10);

create unique index if not exists users_email_unique_idx
  on public.users (lower(email));

create unique index if not exists users_email_unsubscribe_token_unique_idx
  on public.users (email_unsubscribe_token);

create unique index if not exists users_full_name_unique_idx
  on public.users (lower(full_name))
  where full_name is not null and btrim(full_name) <> '';

create unique index if not exists articles_url_hash_unique_idx
  on public.articles (url_hash);

create unique index if not exists articles_doi_hash_unique_idx
  on public.articles (doi_hash)
  where doi_hash is not null;

create index if not exists articles_published_at_idx
  on public.articles (published_at desc);

create index if not exists articles_categories_idx
  on public.articles using gin (categories);

create index if not exists articles_breaking_importance_idx
  on public.articles (is_breaking, importance_score desc, published_at desc);

create index if not exists articles_matched_entities_idx
  on public.articles using gin (matched_entities);

create index if not exists user_preferences_watchlist_keywords_idx
  on public.user_preferences using gin (watchlist_keywords);

create index if not exists user_preferences_delivery_mode_idx
  on public.user_preferences (delivery_mode, breaking_alerts_enabled);

create unique index if not exists article_summaries_user_article_unique_idx
  on public.article_summaries (user_id, article_id);

create index if not exists article_summaries_article_id_idx
  on public.article_summaries (article_id);

create index if not exists article_summaries_user_id_idx
  on public.article_summaries (user_id);

create index if not exists user_article_reads_status_idx
  on public.user_article_reads (user_id, status);

create index if not exists user_article_reads_article_id_idx
  on public.user_article_reads (article_id);

alter table public.users enable row level security;
alter table public.user_preferences enable row level security;
alter table public.articles enable row level security;
alter table public.article_summaries enable row level security;
alter table public.user_article_reads enable row level security;

drop policy if exists "Users can read their own profile" on public.users;
drop policy if exists "Users can insert their own profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;
drop policy if exists "Users can read their own preferences" on public.user_preferences;
drop policy if exists "Users can insert their own preferences" on public.user_preferences;
drop policy if exists "Users can update their own preferences" on public.user_preferences;
drop policy if exists "Authenticated users can read articles" on public.articles;
drop policy if exists "Users can read their own article summaries" on public.article_summaries;
drop policy if exists "Users can read their own article read state" on public.user_article_reads;

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

create policy "Authenticated users can read articles"
  on public.articles
  for select
  to authenticated
  using (true);

create policy "Users can read their own article summaries"
  on public.article_summaries
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their own article read state"
  on public.user_article_reads
  for select
  to authenticated
  using (auth.uid() = user_id);

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
