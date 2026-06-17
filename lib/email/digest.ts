import "server-only";
import Mailjet from "node-mailjet";
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

type MailjetRecipient = {
  Email?: string;
  MessageID?: number | string;
  MessageUUID?: string;
};

type MailjetMessage = {
  Errors?: { ErrorMessage?: string; ErrorRelatedTo?: string[] }[];
  Status?: string;
  To?: MailjetRecipient[];
};

type MailjetSendResponse = {
  body?: {
    Messages?: MailjetMessage[];
  };
};

export type EmailDeliveryAttempt = {
  itemCount: number;
  mailjetMessageIds: string[];
  mailjetMessageUuids: string[];
  recipient: string;
  status: string;
  userId: string;
};

export type EmailDeliveryResult = {
  usersScanned: number;
  dueUsers: number;
  emailsSent: number;
  summariesDelivered: number;
  skipped: number;
  failed: number;
  errors: string[];
  deliveries: EmailDeliveryAttempt[];
};

function getMailjetClient() {
  const apiKey = process.env.MAILJET_API_KEY;
  const secretKey = process.env.MAILJET_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("MAILJET_API_KEY or MAILJET_SECRET_KEY is not configured.");
  }

  return Mailjet.apiConnect(apiKey, secretKey);
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

function cleanDigestText(value: string) {
  return value
    .replace(/^#+\s*(summary|why this matters)\s*:?\s*/gim, "")
    .replace(/^(summary|why this matters)\s*:?\s*/gim, "")
    .replace(/\*\*(summary|why this matters)\*\*\s*:?\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const preheader = `${items.length} AI updates selected for your interests.`;
  const itemHtml = items
    .map(
      ({ article, summary }, index) => {
        const cleanSummary = cleanDigestText(summary.summary);
        const cleanInsight = cleanDigestText(summary.why_this_matters);

        return `
          <article style="background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;margin:0 0 18px;padding:24px;">
            <div style="margin:0 0 14px;">
              <span style="background:#f3e8ff;border-radius:999px;color:#7c3aed;display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;padding:6px 10px;text-transform:uppercase;">${escapeHtml(
                article.source,
              )}</span>
              <span style="color:#9ca3af;font-size:12px;margin-left:8px;">Update ${index + 1} of ${
                items.length
              }</span>
            </div>
            <h2 style="color:#111827;font-size:22px;line-height:1.25;margin:0 0 12px;">
              <a href="${escapeHtml(article.url)}" style="color:#111827;text-decoration:none;">${escapeHtml(
                article.title,
              )}</a>
            </h2>
            <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">${escapeHtml(
              cleanSummary,
            )}</p>
            <div style="background:#f9fafb;border-left:4px solid #8b5cf6;border-radius:14px;padding:14px 16px;">
              <p style="color:#111827;font-size:13px;font-weight:700;letter-spacing:.03em;margin:0 0 6px;text-transform:uppercase;">Why this matters</p>
              <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:0;">${escapeHtml(
                cleanInsight,
              )}</p>
            </div>
            <p style="margin:18px 0 0;">
              <a href="${escapeHtml(
                article.url,
              )}" style="background:#111827;border-radius:999px;color:#ffffff;display:inline-block;font-size:14px;font-weight:700;padding:10px 16px;text-decoration:none;">Read source</a>
            </p>
          </article>`;
      },
    )
    .join("");

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
      preheader,
    )}</div>
    <main style="background:#f5f3ff;font-family:Inter,Arial,sans-serif;margin:0;padding:32px 16px;">
      <section style="margin:0 auto;max-width:700px;">
        <div style="background:linear-gradient(135deg,#111827,#4c1d95);border-radius:28px 28px 0 0;padding:34px 32px;">
          <p style="color:#c4b5fd;font-size:13px;font-weight:800;letter-spacing:.12em;margin:0 0 10px;text-transform:uppercase;">PulseAI digest</p>
          <h1 style="color:#ffffff;font-size:32px;line-height:1.15;margin:0 0 12px;">Your AI updates are ready</h1>
          <p style="color:#ddd6fe;font-size:16px;line-height:1.6;margin:0;">Hi ${escapeHtml(
            displayName,
          )}, here are ${items.length} relevant AI updates selected for your interests.</p>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:0;padding:24px;">
          ${itemHtml}
        </div>
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:0 0 28px 28px;border-top:0;padding:22px 28px;text-align:center;">
          <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0 0 8px;">
            You are receiving this because you signed up for PulseAI digests.
          </p>
          <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0;">
            <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6d28d9;text-decoration:underline;">Unsubscribe</a>
          </p>
        </div>
      </section>
    </main>`;
}

function renderDigestText(user: UserRow, items: DigestItem[]) {
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const itemText = items
    .map(
      ({ article, summary }) =>
        `${article.title}\n${article.url}\n\n${cleanDigestText(
          summary.summary,
        )}\n\nWhy this matters: ${cleanDigestText(summary.why_this_matters)}`,
    )
    .join("\n\n---\n\n");

  return `PulseAI digest for ${user.full_name ?? user.email}\n\n${itemText}\n\nUnsubscribe: ${unsubscribeUrl}`;
}

function parseEmailAddress(value: string) {
  const match = value.match(/^(.+?)\s*<([^>]+)>$/);

  if (!match) {
    return {
      email: value,
      name: "PulseAI",
    };
  }

  return {
    email: match[2].trim(),
    name: match[1].replace(/^"|"$/g, "").trim(),
  };
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

async function sendDigest(
  user: UserRow,
  items: DigestItem[],
): Promise<EmailDeliveryAttempt> {
  const mailjet = getMailjetClient();
  const from = parseEmailAddress(getRequiredEnv("DIGEST_FROM_EMAIL"));
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const subject =
    items.length === 1
      ? "Your PulseAI digest: 1 update"
      : `Your PulseAI digest: ${items.length} updates`;

  const response = (await mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: {
          Email: from.email,
          Name: from.name,
        },
        CustomCampaign: "pulseai-digest",
        DeduplicateCampaign: false,
        Headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        HTMLPart: renderDigestHtml(user, items),
        Subject: subject,
        TextPart: renderDigestText(user, items),
        To: [
          {
            Email: user.email,
            Name: user.full_name ?? user.email,
          },
        ],
      },
    ],
  })) as MailjetSendResponse;
  const message = response.body?.Messages?.[0];
  const status = message?.Status ?? "unknown";
  const errors = message?.Errors ?? [];

  if (errors.length > 0 || !["success", "queued"].includes(status.toLowerCase())) {
    const errorMessages = errors
      .map((error) => error.ErrorMessage)
      .filter(Boolean)
      .join("; ");

    throw new Error(
      `Mailjet send failed with status "${status}"${
        errorMessages ? `: ${errorMessages}` : ""
      }`,
    );
  }

  return {
    itemCount: items.length,
    mailjetMessageIds:
      message?.To?.map((recipient) => recipient.MessageID)
        .filter((id): id is number | string => Boolean(id))
        .map(String) ?? [],
    mailjetMessageUuids:
      message?.To?.map((recipient) => recipient.MessageUUID)
        .filter((id): id is string => Boolean(id)) ?? [],
    recipient: user.email,
    status,
    userId: user.id,
  };
}

export async function deliverDueDigests(): Promise<EmailDeliveryResult> {
  const result: EmailDeliveryResult = {
    dueUsers: 0,
    emailsSent: 0,
    errors: [],
    deliveries: [],
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

      const delivery = await sendDigest(user, items);
      await markDigestDelivered(user.id, items);

      result.deliveries.push(delivery);
      result.emailsSent += 1;
      result.summariesDelivered += items.length;
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
