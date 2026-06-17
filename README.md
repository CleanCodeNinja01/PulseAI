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

## Missing Flow / Next Steps

1. Apply `supabase/schema.sql` in the Supabase SQL Editor after every schema change.
2. Add production environment variables in Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and optionally `NEWS_API_KEY`.
3. Manually test the cron route once with `curl` and confirm rows are inserted into `public.articles`.
4. Move preference loading fully from browser `localStorage` to Supabase so all onboarding state is database-backed.
5. Add an articles dashboard or admin view to inspect ingested raw articles from the UI.
6. Add category matching between `public.articles.categories` and `public.user_preferences.categories`.
7. Implement Phase 3 summarization: summarize stored articles and generate personalized "why this matters" notes.
8. Implement Phase 4 email delivery: assemble each user's digest and send it on their cadence.
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