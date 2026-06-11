# PulseAI
Your personal AI research digest - curated, summarized, and delivered on your schedule.

Phase 1 — User onboarding & preferences is where users select AI categories (NLP, robotics, security, etc.) and set their delivery cadence. This data drives everything downstream.
Phase 2 — Content pipeline involves fetching AI news from sources like arXiv, RSS feeds, and news APIs, then filtering by the user's selected categories.
Phase 3 — AI summarization uses Claude (or another LLM) to condense each article and generate a personalized "why this matters" insight tailored to the user's interests.
Phase 4 — Email automation assembles the digest and sends it on the user's chosen schedule via a service like SendGrid or Resend.
Phase 5 — Scalability means using job queues and background workers so thousands of users can get personalized digests without bottlenecks.

## Phase 1 App

The first working slice is a Next.js onboarding screen that captures:

- AI categories the user wants in their digest
- Delivery cadence: daily, weekdays, or weekly
- Preferred delivery time and timezone
- Email address for future digest delivery

For now, preferences are stored in browser `localStorage` as `pulseai.preferences.v1`.
That gives later phases a stable payload shape before a database is introduced.

## Getting Started

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).