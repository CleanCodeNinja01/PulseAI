# PulseAI
Your personal AI research digest - curated, summarized, and delivered on your schedule.

Phase 1 — User onboarding & preferences is where users select AI categories (NLP, robotics, security, etc.) and set their delivery cadence. This data drives everything downstream.
Phase 2 — Content pipeline involves fetching AI news from sources like arXiv, RSS feeds, and news APIs, then filtering by the user's selected categories.
Phase 3 — AI summarization uses Claude (or another LLM) to condense each article and generate a personalized "why this matters" insight tailored to the user's interests.
Phase 4 — Email automation assembles the digest and sends it on the user's chosen schedule via a service like SendGrid or Resend.
Phase 5 — Scalability means using job queues and background workers so thousands of users can get personalized digests without bottlenecks.

## Phase 1 App

The first working slice is a Next.js onboarding screen that captures:

- Account creation through Supabase Auth
- AI categories the user wants in their digest
- Delivery cadence: daily, weekly, as it happens, or bi-weekly
- Preferred delivery time and timezone
- Email address for future digest delivery

For now, preferences are stored in browser `localStorage` as `pulseai.preferences.v1`.
That gives later phases a stable payload shape before a database is introduced.

Account creation uses Supabase Auth for email/password. The password is never
stored in `public.users`; Supabase stores it securely in `auth.users`. Run
`supabase/schema.sql` in the Supabase SQL Editor to create a `public.users`
profile table and trigger. On every signup, the trigger copies `email`,
`full_name`, and `options` metadata from `auth.users` into `public.users`.
Step 2 and Step 3 selections are stored in `public.user_preferences` when the
user finishes setup.

## Getting Started

Create a Supabase project and copy your public project settings into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).