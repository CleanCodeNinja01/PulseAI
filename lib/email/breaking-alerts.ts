import "server-only";
import Mailjet from "node-mailjet";
import { supabaseAdmin } from "@/lib/supabase-server";

type AlertPreferenceRow = {
  user_id: string;
  alert_threshold: number;
  categories: string[];
  max_alerts_per_day: number;
  watchlist_keywords: string[];
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  email_unsubscribe_token: string;
  email_unsubscribed_at: string | null;
};

type BreakingArticleRow = {
  id: string;
  abstract: string | null;
  breaking_reason: string | null;
  categories: string[];
  importance_score: number;
  matched_entities: string[];
  published_at: string | null;
  source: string;
  title: string;
  url: string;
};

type AlertUser = {
  preference: AlertPreferenceRow;
  user: UserRow;
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

export type BreakingAlertDeliveryAttempt = {
  articleId: string;
  importanceScore: number;
  mailjetMessageIds: string[];
  mailjetMessageUuids: string[];
  recipient: string;
  status: string;
  title: string;
  userId: string;
};

export type BreakingAlertResult = {
  usersScanned: number;
  alertsMatched: number;
  emailsSent: number;
  alertsDelivered: number;
  skipped: number;
  failed: number;
  errors: string[];
  deliveries: BreakingAlertDeliveryAttempt[];
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

function truncateText(value: string | null, maxLength: number) {
  if (!value) {
    return "";
  }

  const cleanedValue = value.replace(/\s+/g, " ").trim();

  if (cleanedValue.length <= maxLength) {
    return cleanedValue;
  }

  return `${cleanedValue.slice(0, maxLength - 1).trim()}...`;
}

function normalizeMatchValue(value: string) {
  return value.trim().toLowerCase();
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

function getUnsubscribeUrl(user: UserRow) {
  const appUrl = getRequiredEnv("APP_URL").replace(/\/$/, "");
  const token = encodeURIComponent(user.email_unsubscribe_token);

  return `${appUrl}/unsubscribe?token=${token}`;
}

function articleMatchesPreference(
  article: BreakingArticleRow,
  preference: AlertPreferenceRow,
) {
  const categories = new Set(preference.categories.map(normalizeMatchValue));
  const watchlist = preference.watchlist_keywords
    .map(normalizeMatchValue)
    .filter(Boolean);
  const articleCategories = article.categories.map(normalizeMatchValue);
  const articleEntities = article.matched_entities.map(normalizeMatchValue);
  const searchableText = normalizeMatchValue(
    [article.title, article.abstract, article.breaking_reason].filter(Boolean).join(" "),
  );

  if (categories.size === 0 && watchlist.length === 0) {
    return false;
  }

  if (articleCategories.some((category) => categories.has(category))) {
    return true;
  }

  return watchlist.some(
    (keyword) =>
      articleEntities.includes(keyword) || searchableText.includes(keyword),
  );
}

function renderBreakingAlertHtml(user: UserRow, article: BreakingArticleRow) {
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const displayName = user.full_name ?? "there";
  const reason =
    article.breaking_reason ??
    "This update was flagged as highly relevant for your AI alert preferences.";
  const abstract = truncateText(article.abstract, 520);
  const entities = article.matched_entities.slice(0, 6);

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Breaking AI alert: ${escapeHtml(
      article.title,
    )}</div>
    <main style="background:#111827;font-family:Inter,Arial,sans-serif;margin:0;padding:28px 14px;">
      <section style="background:#ffffff;border-radius:24px;margin:0 auto;max-width:660px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#991b1b,#4c1d95);padding:30px;">
          <p style="color:#fecaca;font-size:12px;font-weight:800;letter-spacing:.14em;margin:0 0 10px;text-transform:uppercase;">Breaking AI alert</p>
          <h1 style="color:#ffffff;font-size:30px;line-height:1.15;margin:0;">${escapeHtml(
            article.title,
          )}</h1>
        </div>
        <div style="padding:28px 30px;">
          <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 18px;">Hi ${escapeHtml(
            displayName,
          )}, this update crossed your breaking-alert threshold.</p>
          <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:14px;margin:0 0 20px;padding:14px 16px;">
            <p style="color:#991b1b;font-size:13px;font-weight:800;letter-spacing:.04em;margin:0 0 6px;text-transform:uppercase;">Why it matters now</p>
            <p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">${escapeHtml(
              reason,
            )}</p>
          </div>
          ${
            abstract
              ? `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 18px;">${escapeHtml(
                  abstract,
                )}</p>`
              : ""
          }
          <div style="margin:0 0 20px;">
            <span style="background:#f3e8ff;border-radius:999px;color:#7c3aed;display:inline-block;font-size:12px;font-weight:800;letter-spacing:.04em;padding:6px 10px;text-transform:uppercase;">${escapeHtml(
              article.source,
            )}</span>
            <span style="background:#fee2e2;border-radius:999px;color:#991b1b;display:inline-block;font-size:12px;font-weight:800;margin-left:8px;padding:6px 10px;">Importance ${article.importance_score}/10</span>
          </div>
          ${
            entities.length > 0
              ? `<p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 20px;">Matched: ${entities
                  .map(escapeHtml)
                  .join(", ")}</p>`
              : ""
          }
          <p style="margin:0;">
            <a href="${escapeHtml(
              article.url,
            )}" style="background:#111827;border-radius:999px;color:#ffffff;display:inline-block;font-size:14px;font-weight:800;padding:12px 18px;text-decoration:none;">Read the update</a>
          </p>
        </div>
        <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 30px;text-align:center;">
          <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0 0 8px;">You received this because breaking alerts are enabled in PulseAI.</p>
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6d28d9;font-size:12px;text-decoration:underline;">Unsubscribe</a>
        </div>
      </section>
    </main>`;
}

function renderBreakingAlertText(user: UserRow, article: BreakingArticleRow) {
  const reason =
    article.breaking_reason ??
    "This update was flagged as highly relevant for your AI alert preferences.";

  return `Breaking AI alert for ${user.full_name ?? user.email}

${article.title}
Importance: ${article.importance_score}/10

Why it matters now:
${reason}

${truncateText(article.abstract, 520)}

Read the update:
${article.url}

Unsubscribe:
${getUnsubscribeUrl(user)}`;
}

async function getEligibleAlertUsers(limit: number) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data: preferences, error: preferencesError } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id,categories,alert_threshold,max_alerts_per_day,watchlist_keywords")
    .eq("breaking_alerts_enabled", true)
    .eq("delivery_mode", "realtime")
    .limit(limit * 2);

  if (preferencesError) {
    throw new Error(`Could not load alert preferences: ${preferencesError.message}`);
  }

  const typedPreferences = (preferences ?? []) as AlertPreferenceRow[];
  const userIds = typedPreferences.map((preference) => preference.user_id);

  if (userIds.length === 0) {
    return [];
  }

  const { data: users, error: usersError } = await supabaseAdmin
    .from("users")
    .select("id,email,full_name,email_unsubscribe_token,email_unsubscribed_at")
    .in("id", userIds)
    .is("email_unsubscribed_at", null);

  if (usersError) {
    throw new Error(`Could not load alert users: ${usersError.message}`);
  }

  const usersById = new Map((users ?? []).map((user) => [user.id, user as UserRow]));

  return typedPreferences
    .map((preference) => {
      const user = usersById.get(preference.user_id);

      return user ? { preference, user } : null;
    })
    .filter((row): row is AlertUser => Boolean(row))
    .slice(0, limit);
}

async function getMatchingBreakingArticles(
  userId: string,
  preference: AlertPreferenceRow,
  limit: number,
) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: readRows, error: readError } = await supabaseAdmin
    .from("user_article_reads")
    .select("article_id,delivered_at")
    .eq("user_id", userId);

  if (readError) {
    throw new Error(`Could not load alert read state: ${readError.message}`);
  }

  const seenArticleIds = new Set((readRows ?? []).map((row) => row.article_id));
  const alertsSentToday = (readRows ?? []).filter(
    (row) => row.delivered_at && row.delivered_at >= oneDayAgo,
  ).length;
  const remainingAlertSlots = Math.max(
    0,
    preference.max_alerts_per_day - alertsSentToday,
  );

  if (remainingAlertSlots === 0) {
    return [];
  }
  const { data: articles, error: articlesError } = await supabaseAdmin
    .from("articles")
    .select(
      "id,abstract,breaking_reason,categories,importance_score,matched_entities,published_at,source,title,url",
    )
    .eq("is_breaking", true)
    .gte("importance_score", preference.alert_threshold)
    .order("importance_score", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(limit, remainingAlertSlots) * 5);

  if (articlesError) {
    throw new Error(`Could not load breaking articles: ${articlesError.message}`);
  }

  return ((articles ?? []) as BreakingArticleRow[])
    .filter((article) => !seenArticleIds.has(article.id))
    .filter((article) => articleMatchesPreference(article, preference))
    .slice(0, Math.min(limit, remainingAlertSlots));
}

async function sendBreakingAlert(
  user: UserRow,
  article: BreakingArticleRow,
): Promise<BreakingAlertDeliveryAttempt> {
  const mailjet = getMailjetClient();
  const from = parseEmailAddress(getRequiredEnv("DIGEST_FROM_EMAIL"));
  const unsubscribeUrl = getUnsubscribeUrl(user);
  const subject = `Breaking AI alert: ${article.title}`;
  const response = (await mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: {
          Email: from.email,
          Name: from.name,
        },
        CustomCampaign: "pulseai-breaking-alert",
        DeduplicateCampaign: false,
        Headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        HTMLPart: renderBreakingAlertHtml(user, article),
        Subject: subject,
        TextPart: renderBreakingAlertText(user, article),
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
      `Mailjet breaking alert failed with status "${status}"${
        errorMessages ? `: ${errorMessages}` : ""
      }`,
    );
  }

  return {
    articleId: article.id,
    importanceScore: article.importance_score,
    mailjetMessageIds:
      message?.To?.map((recipient) => recipient.MessageID)
        .filter((id): id is number | string => Boolean(id))
        .map(String) ?? [],
    mailjetMessageUuids:
      message?.To?.map((recipient) => recipient.MessageUUID)
        .filter((id): id is string => Boolean(id)) ?? [],
    recipient: user.email,
    status,
    title: article.title,
    userId: user.id,
  };
}

async function markBreakingAlertDelivered(userId: string, articleId: string) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const deliveredAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from("user_article_reads").upsert(
    {
      article_id: articleId,
      delivered_at: deliveredAt,
      first_seen_at: deliveredAt,
      status: "delivered",
      user_id: userId,
    },
    {
      onConflict: "user_id,article_id",
    },
  );

  if (error) {
    throw new Error(`Could not mark breaking alert delivered: ${error.message}`);
  }
}

export async function sendBreakingAlerts(): Promise<BreakingAlertResult> {
  const result: BreakingAlertResult = {
    alertsDelivered: 0,
    alertsMatched: 0,
    deliveries: [],
    emailsSent: 0,
    errors: [],
    failed: 0,
    skipped: 0,
    usersScanned: 0,
  };
  const users = await getEligibleAlertUsers(
    getConfiguredLimit("BREAKING_ALERT_MAX_USERS", 25),
  );
  const articlesPerUser = getConfiguredLimit("BREAKING_ALERT_MAX_ARTICLES_PER_USER", 3);

  result.usersScanned = users.length;

  for (const { preference, user } of users) {
    try {
      const articles = await getMatchingBreakingArticles(
        user.id,
        preference,
        articlesPerUser,
      );

      result.alertsMatched += articles.length;

      if (articles.length === 0) {
        result.skipped += 1;
        continue;
      }

      for (const article of articles) {
        const delivery = await sendBreakingAlert(user, article);

        await markBreakingAlertDelivered(user.id, article.id);

        result.deliveries.push(delivery);
        result.emailsSent += 1;
        result.alertsDelivered += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
