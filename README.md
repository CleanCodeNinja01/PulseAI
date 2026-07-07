# PulseAI
Your personal AI research digest - curated, summarized, and delivered on your schedule.

Phase 1 — User onboarding & preferences is where users select AI categories (NLP, robotics, security, etc.) and set their delivery cadence. This data drives everything downstream.
Phase 2 — Content pipeline involves fetching AI news from sources like arXiv, RSS feeds, and news APIs, then filtering by the user's selected categories.
Phase 3 — AI summarization uses Claude (or another LLM) to condense each article and generate a personalized "why this matters" insight tailored to the user's interests.
Phase 4 — Email automation assembles the digest and sends it on the user's chosen schedule via Mailjet.
Phase 5 — Breaking AI alerts flags major AI updates and can notify users right away when a new article matches their selected categories or watchlist.

## Phase 1 App

The first working slice is a route-based Next.js onboarding flow that captures:

- Account creation through Supabase Auth
- AI categories the user wants in their digest
- Delivery cadence: daily, weekly, as it happens, or bi-weekly
- Preferred delivery time and timezone for scheduled digests
- Maximum daily alert cap for as-it-happens delivery
- Email address for future digest delivery

Implemented routes:

1. `/auth` handles signup and sign in.
2. `/onboarding/interests` lets authenticated users choose AI topics.
3. `/onboarding/schedule` lets authenticated users choose cadence and delivery time.
4. `/onboarding/complete` confirms setup.
5. `/dashboard` shows the authenticated user's saved account and preference summary.

Account creation uses Supabase Auth for email/password. The password is never
stored in `public.users`; Supabase stores it securely in `auth.users`. Run
`supabase/schema.sql` in the Supabase SQL Editor to create a `public.users`
profile table and trigger. On every signup, the trigger copies `email`,
`full_name`, and `options` metadata from `auth.users` into `public.users`.
Step 2 and Step 3 selections are stored in `public.user_preferences` when the
user finishes setup.

Protected onboarding and dashboard routes use a client-side auth guard. Users
who are not signed in are redirected to `/auth`.

## Background Job Scheduling

Vercel Hobby plans only allow daily cron jobs, so PulseAI does **not** use
`vercel.json` crons. Schedule jobs with an external service such as
[cron-job.org](https://console.cron-job.org/jobs/create).

Every job route requires:

```text
Authorization: Bearer $CRON_SECRET
```

Suggested production schedule:

| Job | Route | Suggested schedule |
| --- | --- | --- |
| Ingestion | `GET /api/jobs/ingest-content` | Daily at 6:00 AM UTC |
| Summarization | `GET /api/jobs/summarize-content` | Daily at 6:30 AM UTC |
| Breaking alerts | `GET /api/jobs/send-breaking-alerts` | Every 15 minutes |
| Digest delivery | `GET /api/jobs/deliver-digests` | Hourly |

Example cron-job.org setup for breaking alerts:

1. URL: `https://your-vercel-domain.com/api/jobs/send-breaking-alerts`
2. Method: `GET`
3. Header: `Authorization: Bearer YOUR_CRON_SECRET`
4. Schedule: every 15 minutes

Alias route: `GET /api/cron/ingest` re-exports the ingestion job for external
schedulers that expect a `/api/cron/*` path.

## Phase 2 Content Ingestion

Phase 2 adds a protected background ingestion endpoint at
`/api/jobs/ingest-content`. It fetches articles from:

- arXiv categories: `cs.AI`, `cs.CL`, `cs.LG`, `cs.CV`, `stat.ML`
- RSS feeds from OpenAI, Hugging Face, Anthropic, and Google DeepMind
- NewsAPI when `NEWS_API_KEY` is configured

Every source is normalized into a common article shape, deduplicated by
canonical URL hash and DOI hash, then stored in `public.articles`. Schedule the
job daily through cron-job.org or another external scheduler.

Implemented ingestion flow:

1. External scheduler calls `/api/jobs/ingest-content`.
2. The route checks `Authorization: Bearer $CRON_SECRET`.
3. The job fetches articles from arXiv, RSS feeds, and optional NewsAPI.
4. Each source payload is converted into a shared raw article shape.
5. Articles are normalized with clean title, URL, DOI, authors, categories, and publish date.
6. Canonical URL and DOI hashes are generated for deduplication.
7. `public.articles` unique indexes skip already stored articles.
8. The endpoint returns fetched, inserted, skipped, failed, and error counts.

## Phase 3 AI Summarization

Phase 3 will turn raw stored articles into personalized digest items. For each
user, the job should find unread articles that match their selected categories,
then call Claude for:

1. A 3-sentence article summary.
2. A one-paragraph "why this matters for someone interested in [their categories]" insight.

Implementation steps:

1. Add summary tracking tables.
   - `article_summaries` stores Claude outputs: `summary`, `why_this_matters`, `model`, `prompt_version`, token counts, `article_id`, and `user_id`.
   - `user_article_reads` tracks each user's article state so the same article is not repeatedly summarized, delivered, or shown as unread.
2. Add the Claude API key env var.
   - Local: add `ANTHROPIC_API_KEY` to `.env.local`.
   - Production: add the same key to Vercel environment variables.
   - Repo-safe placeholder: keep `ANTHROPIC_API_KEY=` in `.env.example`.
3. Create a server-only Claude client.
   - Implemented file: `lib/summarization/claude.ts`.
   - This file should read `process.env.ANTHROPIC_API_KEY`.
   - Do not import this client into browser components.
4. Create a protected summarization job route.
   - Implemented route: `GET /api/jobs/summarize-content`.
   - Protect it with `Authorization: Bearer $CRON_SECRET`, same as `/api/jobs/ingest-content`.
5. For each user, load their preferences.
   - Read `public.user_preferences.categories`.
   - Skip users with no selected categories.
6. Fetch unread matching articles.
   - Read from `public.articles`.
   - Match article categories against the user's selected categories.
   - Exclude articles already present in `user_article_reads` for that user.
7. Batch the work.
   - Process small chunks, for example 3-5 articles at a time.
   - Keep batch sizes small to avoid Claude rate limits.
8. Call Claude for each matched article.
   - Prompt 1 asks for a clear 3-sentence summary.
   - Prompt 2 asks for one paragraph explaining why the article matters for someone interested in the user's categories.
9. Store the result in Supabase.
   - Insert the Claude output into `public.article_summaries`.
   - Upsert `public.user_article_reads` with status `summarized` or `queued`.
10. Return job counts.
   - Include users scanned, articles matched, summaries created, skipped articles, failures, and errors.

Example prompt shape:

```text
System: You summarize AI research/news for a technical but busy reader.

User:
Article title: {title}
Article abstract/content: {abstract}
User interests: {categories}

Task 1: Write a 3-sentence summary.
Task 2: Write one paragraph explaining why this matters for someone interested in these categories.
```

Suggested API route:

```text
GET /api/jobs/summarize-content
Authorization: Bearer $CRON_SECRET
```

This route should run after ingestion via your external scheduler.

To test summarization locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/summarize-content
```

For safer local testing, set `SUMMARIZATION_MAX_USERS`,
`SUMMARIZATION_MAX_ARTICLES_PER_USER`, and `SUMMARIZATION_BATCH_SIZE` to low
values like `1`, `2`, and `1`.

## Phase 4 Email Delivery

Phase 4 sends personalized digest emails from the summarized articles already
queued for each user.

Implementation steps:

1. Add email delivery state.
   - `public.users.email_unsubscribe_token` stores a stable token for unsubscribe links.
   - `public.users.email_unsubscribed_at` stops future digest delivery.
   - `public.users.last_digest_sent_at` powers cadence checks.
2. Add email provider configuration.
   - `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` are the server-only provider keys.
   - `DIGEST_FROM_EMAIL` is the verified sender address.
   - `APP_URL` is used to build unsubscribe URLs.
3. Create the digest delivery helper.
   - Implemented file: `lib/email/digest.ts`.
   - It loads users and preferences, checks cadence and local delivery time,
     fetches `user_article_reads.status = summarized`, builds HTML/text email,
     sends through Mailjet, then marks rows as `delivered`.
4. Create a protected delivery job route.
   - Implemented route: `GET /api/jobs/deliver-digests`.
   - Protect it with `Authorization: Bearer $CRON_SECRET`.
5. Add unsubscribe support from day one.
   - Implemented page: `GET /unsubscribe?token=...`.
   - API fallback: `GET /api/unsubscribe?token=...`.
   - Every digest email includes this link.
6. Schedule delivery through cron-job.org.
   - Run `/api/jobs/deliver-digests` hourly.
   - The route only sends when a user is due based on cadence, delivery time,
     and unsubscribe status.

### Mailjet deliverability

Emails can land in spam when the sender domain is not authenticated or when
test content looks like bulk marketing.

Before production sends:

1. Verify your sender domain in Mailjet.
2. Add DNS records for SPF, DKIM, and DMARC.
3. Use a real From address such as `PulseAI <digest@your-domain.com>`.
4. Confirm Gmail **Show original** reports `spf=pass`, `dkim=pass`, and
   `dmarc=pass`.

Common spam triggers in this project:

- Unverified Mailjet sender domain
- Alarmist subject lines like `Breaking AI alert: ...`
- Test article URLs such as `example.com`
- New sender reputation with no warm-up period

To test email delivery locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/deliver-digests
```

The response includes a `deliveries` array with Mailjet status and message IDs
for each attempted email.

For safer local testing, set `EMAIL_DELIVERY_MAX_USERS` and
`EMAIL_DIGEST_MAX_ITEMS` to low values like `1` and `2`.

Scheduled digest test flow:

1. Finish onboarding with at least one category selected.
2. Choose **Daily** or **Weekly** and set delivery time to the current hour.
3. Run ingestion, summarization, then delivery:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/ingest-content

curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/summarize-content

curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/deliver-digests
```

Selecting a category alone does not send email. The pipeline must ingest
articles, summarize matching items, and then run the delivery job.

## Phase 5 Breaking AI Alerts

Phase 5 starts by storing alert metadata on each article so the app can
distinguish routine digest content from major updates worth sending right away.

Implemented schema fields on `public.articles`:

1. `importance_score`: integer from `0` to `10`; higher means more important.
2. `is_breaking`: boolean flag for major updates that may trigger immediate alerts.
3. `breaking_reason`: short explanation for why the article is breaking.
4. `matched_entities`: text array for model/company/product names like `Fable 5`, `Claude`, `OpenAI`, `Gemini`, or `Llama`.

Indexes support fast queries for breaking items and entity matching:

1. `articles_breaking_importance_idx`
2. `articles_matched_entities_idx`

Implemented alert preference fields on `public.user_preferences`:

1. `breaking_alerts_enabled`: lets a user opt into immediate alert emails.
2. `alert_threshold`: minimum importance score from `1` to `10`; default is `8`.
3. `delivery_mode`: `scheduled` for digest delivery or `realtime` for as-it-happens alerts.
4. `max_alerts_per_day`: caps realtime alerts so users are not spammed.
5. `watchlist_keywords`: user-specific model, company, and topic keywords like `Fable 5`, `Claude`, `OpenAI`, or `agents`.

Implemented classifier helper:

1. File: `lib/classification/claude.ts`.
2. Function: `classifyArticleForAlerts(article)`.
3. Returns `importanceScore`, `isBreaking`, `breakingReason`, `matchedEntities`, model, and token counts.
4. Uses Claude Haiku by default through `ANTHROPIC_MODEL` / `ANTHROPIC_API_KEY`.

Implemented breaking-alert email job:

1. Route: `GET /api/jobs/send-breaking-alerts`.
2. Protect it with `Authorization: Bearer $CRON_SECRET`.
3. It scans users with `breaking_alerts_enabled = true`.
4. It only sends for `delivery_mode = realtime`.
5. It finds `public.articles.is_breaking = true` where `importance_score >= alert_threshold`.
6. It matches by selected categories, `watchlist_keywords`, `matched_entities`, title, abstract, and breaking reason.
7. It caps sends by `max_alerts_per_day`.
8. It sends one short urgent Mailjet email per matched article.
9. It upserts `public.user_article_reads` as `status = delivered` so the same breaking alert is not sent repeatedly.
10. Schedule this route every 15 minutes through cron-job.org.

Immediate alert requirements:

- `user_preferences.delivery_mode = 'realtime'`
- `user_preferences.breaking_alerts_enabled = true`
- `user_preferences.categories` contains the category id, e.g. `security`
- `articles.is_breaking = true`
- `articles.importance_score >= alert_threshold` (default `8`)
- article `categories` must include the same category id

To test breaking alerts locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/send-breaking-alerts
```

For safer local testing, set `BREAKING_ALERT_MAX_USERS` and
`BREAKING_ALERT_MAX_ARTICLES_PER_USER` to low values like `1` and `1`.

### Test immediate alerts in Supabase

Check your preferences:

```sql
select
  user_id,
  categories,
  cadence,
  delivery_mode,
  breaking_alerts_enabled,
  alert_threshold
from public.user_preferences;
```

Insert a test breaking article for the `security` category:

```sql
insert into public.articles (
  source,
  source_type,
  title,
  url,
  abstract,
  categories,
  importance_score,
  is_breaking,
  breaking_reason,
  matched_entities,
  published_at,
  url_hash
)
values (
  'PulseAI Test Feed',
  'news',
  'Major AI security incident affects enterprise deployments',
  'https://example.com/test-security-breaking-alert',
  'Researchers disclosed a critical AI security vulnerability affecting model serving pipelines.',
  array['security'],
  9,
  true,
  'This is a major AI security update relevant to users following security topics.',
  array['security', 'enterprise ai'],
  now(),
  md5('https://example.com/test-security-breaking-alert')
);
```

If an alert was already sent, clear the read state before retesting:

```sql
delete from public.user_article_reads
where user_id = 'YOUR_USER_ID_HERE'
  and article_id = 'YOUR_ARTICLE_ID_HERE';
```

Category ids must match onboarding ids exactly, such as `security`, `llms`,
`generative-ai`, and `agents`.

Next Phase 5 steps:

1. Add a classification job that fills article alert metadata after ingestion.
2. Wire onboarding/dashboard UI so users can edit breaking alert settings.
3. Add an admin/test view to inspect breaking-alert candidates before sending.

## Work Done So Far

1. Project setup: Next.js app, TypeScript, ESLint, global styling, favicon, and LAN hot reload support.
2. Supabase Auth: email/password signup and sign in are wired through the browser Supabase client.
3. Supabase profile storage: `public.users` mirrors auth user metadata through a database trigger.
4. User preferences: selected topics, cadence, delivery time, and timezone are stored in `public.user_preferences`.
5. Route-based onboarding: the old step-state form was replaced with actual Next routes.
6. Auth guard: onboarding preference routes and dashboard are only available after successful auth.
7. Dashboard: reads profile and preferences for the logged-in user.
8. Phase 2 database schema: `public.articles` stores raw normalized article records.
9. Phase 2 fetchers: arXiv, RSS, and optional NewsAPI fetchers are implemented.
10. Phase 2 dedupe: canonical URL and DOI hashes prevent duplicate article storage.
11. Cron job: `/api/jobs/ingest-content` runs the ingestion job behind `CRON_SECRET`.
12. Phase 3 Claude client: `lib/summarization/claude.ts` is implemented as a server-only wrapper.
13. Phase 3 summarization route: `/api/jobs/summarize-content` matches unread articles, calls Claude in batches, stores summaries, and marks user article state.
14. Phase 4 email delivery: `/api/jobs/deliver-digests` sends due digest emails through Mailjet and marks items as delivered.
15. Phase 4 unsubscribe page: `/unsubscribe` disables future digest and alert emails with a per-user token.
16. Phase 5 alert metadata: `public.articles` now stores importance score, breaking flag, breaking reason, and matched entities.
17. Phase 5 alert preferences: `public.user_preferences` now stores breaking alert opt-in, alert threshold, and watchlist keywords.
18. Phase 5 classifier helper: `lib/classification/claude.ts` can classify articles for breaking-alert metadata.
19. Phase 5 breaking alert route: `/api/jobs/send-breaking-alerts` sends urgent emails for high-importance matching articles.
20. Schedule UX: “As it happens” switches from a time picker to an immediate-alert explainer and max-alerts-per-day control.
21. Dashboard shortcut: users can jump from `/dashboard` to edit interests.
22. External scheduling: background jobs are meant to run through cron-job.org instead of Vercel crons.

## Missing Flow / Next Steps

1. Apply `supabase/schema.sql` in the Supabase SQL Editor after every schema change.
2. Add production environment variables in Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `DIGEST_FROM_EMAIL`, `APP_URL`, and optionally `NEWS_API_KEY`.
3. Configure cron-job.org jobs for ingestion, summarization, breaking alerts, and digest delivery.
4. Verify Mailjet sender domain DNS (SPF, DKIM, DMARC) before production email sends.
5. Manually test each job route once with `curl` and confirm expected database changes.
6. Move preference loading fully from browser `localStorage` to Supabase so all onboarding state is database-backed.
7. Add an articles dashboard or admin view to inspect ingested raw articles from the UI.
8. Implement Phase 5 classification job to populate article alert metadata after ingestion.
9. Add observability for cron runs, including persisted job logs, source failures, and inserted/skipped counts.

## Getting Started

Create a Supabase project and copy your public project settings into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=your-random-cron-secret
NEWS_API_KEY=optional-news-api-key
INGESTION_MAX_RESULTS=optional-local-fetch-limit
ANTHROPIC_API_KEY=phase-3-claude-api-key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
SUMMARIZATION_MAX_USERS=optional-local-user-limit
SUMMARIZATION_MAX_ARTICLES_PER_USER=optional-local-article-limit
SUMMARIZATION_BATCH_SIZE=optional-local-batch-size
MAILJET_API_KEY=phase-4-mailjet-api-key
MAILJET_SECRET_KEY=phase-4-mailjet-secret-key
DIGEST_FROM_EMAIL=PulseAI <digest@your-domain.com>
APP_URL=http://localhost:3000
EMAIL_DELIVERY_MAX_USERS=optional-local-email-user-limit
EMAIL_DIGEST_MAX_ITEMS=optional-local-digest-item-limit
BREAKING_ALERT_MAX_USERS=optional-local-breaking-user-limit
BREAKING_ALERT_MAX_ARTICLES_PER_USER=optional-local-breaking-article-limit
```

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Local job testing

Ingestion:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/ingest-content
```

Summarization:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/summarize-content
```

Digest delivery:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/deliver-digests
```

Breaking alerts:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/send-breaking-alerts
```

In development, ingestion uses smaller source limits by default. Set
`INGESTION_MAX_RESULTS` to a low value like `5` when you want faster local
testing.