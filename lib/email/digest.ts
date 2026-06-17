import "server-only";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";

type UserPreferenceRow = {
  user_id: string;
  cadence: "daily" | "weekly" | "breaking" | "biweekly";
  delivery_time: string;
  timezone: string;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  email_unsubscribe_token: string;
  email_unsubscribed_at: string | null;
  last_digest_sent_at: string | null;
};

type ReadStateRow = {
  article_id: string;
  summary_id: string;
};

type SummaryRow = {
  id: string;
  article_id: string;
  summary: string;
  why_this_matters: string;
  interest_categories: string[];
};

type ArticleRow = {
  id: string;
  source: string;
  title: string;
  url: string;
};

type DigestUser = {
  preference: UserPreferenceRow;
  user: UserRow;
};

type DigestItem = {
  article: ArticleRow;
  summary: SummaryRow;
};

export type EmailDeliveryResult = {
  usersScanned: number;
  dueUsers: number;
  emailsSent: number;
  summariesDelivered: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  return new Resend(apiKey);
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function getConfiguredLimit(name: string, defaultLimit: number) {
  const configuredLimit = Number(process.env[name]);

  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }

  return process.env.NODE_ENV === "development"
    ? Math.min(defaultLimit, 3)
    : defaultLimit;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getLocalTime(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return hour * 60 + minute;
}

function parseDeliveryTime(deliveryTime: string) {
  const [hour = "0", minute = "0"] = deliveryTime.split(":");

  return Number(hour) * 60 + Number(minute);
}

function isPastDeliveryTime(preference: UserPreferenceRow) {
  try {
    return getLocalTime(preference.timezone) >= parseDeliveryTime(preference.delivery_time);
  } catch {
    return true;
  }
}

function hasCadenceElapsed(cadence: UserPreferenceRow["cadence"], lastSentAt: string | null) {
  if (cadence === "breaking") {
    return true;
  }

  if (!lastSentAt) {
    return true;
  }

  const elapsedMs = Date.now() - new Date(lastSentAt).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const cadenceDays = {
    biweekly: 14,
    daily: 1,
    weekly: 7,
  }[cadence];

  return elapsedMs >= cadenceDays * dayMs;
}

function isDigestDue(preference: UserPreferenceRow, user: UserRow) {
  if (user.email_unsubscribed_at) {
    return false;
  }

  return (
    hasCadenceElapsed(preference.cadence, user.last_digest_sent_at) &&
    (preference.cadence === "breaking" || isPastDeliveryTime(preference))
  );
}

function getUnsubscribeUrl(user: UserRow) {
  const appUrl = getRequiredEnv("APP_URL").replace(/\/$/, "");
  const token = encodeURIComponent(user.email_unsubscribe_token);

  return `${appUrl}/api/unsubscribe?token=${token}`;
}

function renderDigestHtml(user: UserRow, items: DigestItem[]) {
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const displayName = user.full_name ?? "there";
  const itemHtml = items
    .map(
      ({ article, summary }) => `
        <article style="border-top:1px solid #e5e7eb;padding:24px 0;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">${escapeHtml(
            article.source,
          )}</p>
          <h2 style="margin:0 0 12px;font-size:20px;line-height:1.3;">
            <a href="${escapeHtml(article.url)}" style="color:#111827;text-decoration:none;">${escapeHtml(
              article.title,
            )}</a>
          </h2>
          <p style="margin:0 0 12px;color:#111827;line-height:1.6;">${escapeHtml(
            summary.summary,
          )}</p>
          <p style="margin:0;color:#374151;line-height:1.6;"><strong>Why this matters:</strong> ${escapeHtml(
            summary.why_this_matters,
          )}</p>
        </article>`,
    )
    .join("");

  return `
    <main style="font-family:Inter,Arial,sans-serif;background:#f9fafb;padding:32px;">
      <section style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;">
        <p style="margin:0 0 8px;color:#7c3aed;font-weight:700;">PulseAI</p>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#111827;">Your AI digest</h1>
        <p style="margin:0 0 24px;color:#4b5563;line-height:1.6;">Hi ${escapeHtml(
          displayName,
        )}, here are the most relevant updates based on your interests.</p>
        ${itemHtml}
        <p style="border-top:1px solid #e5e7eb;margin:24px 0 0;padding-top:20px;color:#6b7280;font-size:12px;line-height:1.5;">
          You are receiving this because you signed up for PulseAI digests.
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a>
        </p>
      </section>
    </main>`;
}

function renderDigestText(user: UserRow, items: DigestItem[]) {
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const itemText = items
    .map(
      ({ article, summary }) =>
        `${article.title}\n${article.url}\n\n${summary.summary}\n\nWhy this matters: ${summary.why_this_matters}`,
    )
    .join("\n\n---\n\n");

  return `PulseAI digest for ${user.full_name ?? user.email}\n\n${itemText}\n\nUnsubscribe: ${unsubscribeUrl}`;
}

async function getDueDigestUsers(limit: number) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data: preferences, error: preferencesError } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id,cadence,delivery_time,timezone")
    .limit(limit * 2);

  if (preferencesError) {
    throw new Error(`Could not load user preferences: ${preferencesError.message}`);
  }

  const typedPreferences = (preferences ?? []) as UserPreferenceRow[];
  const userIds = typedPreferences.map((preference) => preference.user_id);

  if (userIds.length === 0) {
    return [];
  }

  const { data: users, error: usersError } = await supabaseAdmin
    .from("users")
    .select(
      "id,email,full_name,email_unsubscribe_token,email_unsubscribed_at,last_digest_sent_at",
    )
    .in("id", userIds)
    .is("email_unsubscribed_at", null);

  if (usersError) {
    throw new Error(`Could not load users: ${usersError.message}`);
  }

  const usersById = new Map((users ?? []).map((user) => [user.id, user as UserRow]));

  return typedPreferences
    .map((preference) => {
      const user = usersById.get(preference.user_id);

      return user ? { preference, user } : null;
    })
    .filter((row): row is DigestUser => Boolean(row))
    .filter(({ preference, user }) => isDigestDue(preference, user))
    .slice(0, limit);
}

async function getPendingDigestItems(userId: string, limit: number) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data: readRows, error: readError } = await supabaseAdmin
    .from("user_article_reads")
    .select("article_id,summary_id")
    .eq("user_id", userId)
    .eq("status", "summarized")
    .not("summary_id", "is", null)
    .order("summarized_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (readError) {
    throw new Error(`Could not load pending digest items: ${readError.message}`);
  }

  const pendingRows = (readRows ?? []) as ReadStateRow[];

  if (pendingRows.length === 0) {
    return [];
  }

  const summaryIds = pendingRows.map((row) => row.summary_id);
  const articleIds = pendingRows.map((row) => row.article_id);
  const [summariesResult, articlesResult] = await Promise.all([
    supabaseAdmin
      .from("article_summaries")
      .select("id,article_id,summary,why_this_matters,interest_categories")
      .in("id", summaryIds),
    supabaseAdmin.from("articles").select("id,source,title,url").in("id", articleIds),
  ]);

  if (summariesResult.error) {
    throw new Error(`Could not load summaries: ${summariesResult.error.message}`);
  }

  if (articlesResult.error) {
    throw new Error(`Could not load articles: ${articlesResult.error.message}`);
  }

  const summariesById = new Map(
    ((summariesResult.data ?? []) as SummaryRow[]).map((summary) => [
      summary.id,
      summary,
    ]),
  );
  const articlesById = new Map(
    ((articlesResult.data ?? []) as ArticleRow[]).map((article) => [
      article.id,
      article,
    ]),
  );

  return pendingRows
    .map((row) => {
      const summary = summariesById.get(row.summary_id);
      const article = articlesById.get(row.article_id);

      return summary && article ? { article, summary } : null;
    })
    .filter((item): item is DigestItem => Boolean(item));
}

async function markDigestDelivered(userId: string, items: DigestItem[]) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const deliveredAt = new Date().toISOString();
  const articleIds = items.map((item) => item.article.id);

  const { error: readsError } = await supabaseAdmin
    .from("user_article_reads")
    .update({
      delivered_at: deliveredAt,
      status: "delivered",
    })
    .eq("user_id", userId)
    .in("article_id", articleIds);

  if (readsError) {
    throw new Error(`Could not mark digest delivered: ${readsError.message}`);
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ last_digest_sent_at: deliveredAt })
    .eq("id", userId);

  if (userError) {
    throw new Error(`Could not update digest timestamp: ${userError.message}`);
  }
}

async function sendDigest(user: UserRow, items: DigestItem[]) {
  const resend = getResendClient();
  const from = getRequiredEnv("DIGEST_FROM_EMAIL");
  const subject =
    items.length === 1
      ? "Your PulseAI digest: 1 update"
      : `Your PulseAI digest: ${items.length} updates`;

  const { error } = await resend.emails.send({
    from,
    html: renderDigestHtml(user, items),
    subject,
    text: renderDigestText(user, items),
    to: user.email,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function deliverDueDigests(): Promise<EmailDeliveryResult> {
  const result: EmailDeliveryResult = {
    dueUsers: 0,
    emailsSent: 0,
    errors: [],
    failed: 0,
    skipped: 0,
    summariesDelivered: 0,
    usersScanned: 0,
  };
  const users = await getDueDigestUsers(getConfiguredLimit("EMAIL_DELIVERY_MAX_USERS", 50));
  const digestItemLimit = getConfiguredLimit("EMAIL_DIGEST_MAX_ITEMS", 10);

  result.usersScanned = users.length;
  result.dueUsers = users.length;

  for (const { user } of users) {
    try {
      const items = await getPendingDigestItems(user.id, digestItemLimit);

      if (items.length === 0) {
        result.skipped += 1;
        continue;
      }

      await sendDigest(user, items);
      await markDigestDelivered(user.id, items);

      result.emailsSent += 1;
      result.summariesDelivered += items.length;
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
