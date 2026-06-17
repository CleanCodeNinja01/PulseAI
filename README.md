# PulseAI
Your personal AI research digest - curated, summarized, and delivered on your schedule.

Phase 1 — User onboarding & preferences is where users select AI categories (NLP, robotics, security, etc.) and set their delivery cadence. This data drives everything downstream.
Phase 2 — Content pipeline involves fetching AI news from sources like arXiv, RSS feeds, and news APIs, then filtering by the user's selected categories.
Phase 3 — AI summarization uses Claude (or another LLM) to condense each article and generate a personalized "why this matters" insight tailored to the user's interests.
Phase 4 — Email automation assembles the digest and sends it on the user's chosen schedule via a service like SendGrid or Resend.
Phase 5 — Scalability means using job queues and background workers so thousands of users can get personalized digests without bottlenecks.

## Phase 1 App

The first working slice is a route-based Next.js onboarding flow that captures:

- Account creation through Supabase Auth
- AI categories the user wants in their digest
- Delivery cadence: daily, weekly, as it happens, or bi-weekly
- Preferred delivery time and timezone
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

## Phase 2 Content Ingestion

Phase 2 adds a protected background ingestion endpoint at
`/api/jobs/ingest-content`. It fetches articles from:

- arXiv categories: `cs.AI`, `cs.CL`, `cs.LG`, `cs.CV`, `stat.ML`
- RSS feeds from OpenAI, Hugging Face, Anthropic, and Google DeepMind
- NewsAPI when `NEWS_API_KEY` is configured

Every source is normalized into a common article shape, deduplicated by
canonical URL hash and DOI hash, then stored in `public.articles`. The Vercel
cron in `vercel.json` runs the job daily at 6 AM UTC.

Implemented ingestion flow:

1. Vercel cron calls `/api/jobs/ingest-content`.
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

This route should run after ingestion. In production it can be a second Vercel
cron or part of a queue-based worker later.

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
   - `RESEND_API_KEY` is the server-only provider key.
   - `DIGEST_FROM_EMAIL` is the verified sender address.
   - `APP_URL` is used to build unsubscribe URLs.
3. Create the digest delivery helper.
   - Implemented file: `lib/email/digest.ts`.
   - It loads users and preferences, checks cadence and local delivery time,
     fetches `user_article_reads.status = summarized`, builds HTML/text email,
     sends through Resend, then marks rows as `delivered`.
4. Create a protected delivery job route.
   - Implemented route: `GET /api/jobs/deliver-digests`.
   - Protect it with `Authorization: Bearer $CRON_SECRET`.
5. Add unsubscribe support from day one.
   - Implemented route: `GET /api/unsubscribe?token=...`.
   - Every digest email includes this link.
6. Schedule delivery.
   - `vercel.json` runs ingestion daily, summarization after ingestion, and
     delivery hourly.
   - The hourly delivery route only sends when a user is due based on cadence,
     delivery time, and unsubscribe status.

To test email delivery locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/deliver-digests
```

For safer local testing, set `EMAIL_DELIVERY_MAX_USERS` and
`EMAIL_DIGEST_MAX_ITEMS` to low values like `1` and `2`.

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
12. Phase 3 plan: summarization flow is documented but not implemented yet.
13. Phase 3 Claude client: `lib/summarization/claude.ts` is implemented as a server-only wrapper.
14. Phase 3 summarization route: `/api/jobs/summarize-content` matches unread articles, calls Claude in batches, stores summaries, and marks user article state.
15. Phase 4 email delivery: `/api/jobs/deliver-digests` sends due digest emails through Resend and marks items as delivered.
16. Phase 4 unsubscribe route: `/api/unsubscribe` disables future digest emails with a per-user token.

## Missing Flow / Next Steps

1. Apply `supabase/schema.sql` in the Supabase SQL Editor after every schema change.
2. Add production environment variables in Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `APP_URL`, and optionally `NEWS_API_KEY`.
3. Manually test the cron route once with `curl` and confirm rows are inserted into `public.articles`.
4. Move preference loading fully from browser `localStorage` to Supabase so all onboarding state is database-backed.
5. Add an articles dashboard or admin view to inspect ingested raw articles from the UI.
6. Add category matching between `public.articles.categories` and `public.user_preferences.categories`.
7. Add Phase 3 tables for summaries and per-user article delivery/read tracking.
8. Test Phase 3 summarization with a real `ANTHROPIC_API_KEY` and low local limits.
9. Test Phase 4 email delivery with a verified Resend sender and low local limits.
10. Add observability for cron runs, including persisted job logs, source failures, and inserted/skipped counts.

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
RESEND_API_KEY=phase-4-email-provider-key
DIGEST_FROM_EMAIL=PulseAI <digest@your-domain.com>
APP_URL=http://localhost:3000
EMAIL_DELIVERY_MAX_USERS=optional-local-email-user-limit
EMAIL_DIGEST_MAX_ITEMS=optional-local-digest-item-limit
```

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

To test ingestion locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/ingest-content
```

In development, ingestion uses smaller source limits by default. Set
`INGESTION_MAX_RESULTS` to a low value like `5` when you want faster local
testing.