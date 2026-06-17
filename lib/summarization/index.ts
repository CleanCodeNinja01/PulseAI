import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { summarizeArticleForUser } from "./claude";

type UserPreferenceRow = {
  user_id: string;
  categories: string[];
};

type ArticleRow = {
  id: string;
  source: string;
  title: string;
  url: string;
  abstract: string | null;
  categories: string[];
  published_at: string | null;
};

type SummaryWriteRow = {
  id: string;
};

export type SummarizationResult = {
  usersScanned: number;
  articlesMatched: number;
  summariesCreated: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  agents: [
    "agents",
    "ai agents",
    "agentic ai",
    "automation",
    "multi-agent",
    "cs.ai",
  ],
  "ai-safety": [
    "ai safety",
    "alignment",
    "interpretability",
    "explainability",
    "mechanistic interpretability",
    "hallucinations",
  ],
  "autonomous-vehicles": [
    "autonomous vehicles",
    "self-driving",
    "autonomous driving",
    "mobility",
  ],
  climate: ["climate", "climate tech", "energy", "sustainability", "environment"],
  "computer-vision": [
    "computer vision",
    "vision",
    "cv",
    "image recognition",
    "object detection",
    "cs.cv",
  ],
  "data-engineering": [
    "data engineering",
    "data pipelines",
    "datasets",
    "data quality",
    "synthetic data",
    "data labeling",
  ],
  "developer-tools": [
    "developer tools",
    "coding assistants",
    "ai coding",
    "code generation",
    "devtools",
    "software engineering",
  ],
  "edge-ai": [
    "edge ai",
    "on-device ai",
    "mobile ai",
    "embedded ai",
    "tinyml",
    "local inference",
  ],
  "education-ai": [
    "education",
    "edtech",
    "ai tutoring",
    "personalized learning",
    "learning technology",
  ],
  "enterprise-ai": [
    "enterprise ai",
    "business ai",
    "workflow automation",
    "productivity",
    "enterprise software",
  ],
  evaluation: [
    "evaluation",
    "evals",
    "benchmarks",
    "model testing",
    "leaderboards",
    "performance evaluation",
  ],
  finance: [
    "finance",
    "fintech",
    "trading",
    "banking",
    "fraud detection",
    "financial ai",
  ],
  "generative-ai": [
    "generative ai",
    "genai",
    "text generation",
    "image generation",
    "video generation",
    "audio generation",
    "multimodal generation",
  ],
  hardware: [
    "hardware",
    "chips",
    "semiconductors",
    "gpus",
    "accelerators",
    "compute",
  ],
  healthcare: [
    "healthcare",
    "health tech",
    "biotech",
    "medical",
    "drug discovery",
    "clinical ai",
  ],
  "knowledge-graphs": [
    "knowledge graphs",
    "graph learning",
    "graph neural networks",
    "gnn",
    "cs.si",
  ],
  legal: ["legal", "legal tech", "law", "contract analysis", "compliance"],
  llms: [
    "llms",
    "large language models",
    "language models",
    "nlp",
    "natural language processing",
    "cs.cl",
  ],
  mlops: [
    "mlops",
    "infrastructure",
    "deployment",
    "model serving",
    "monitoring",
    "pipelines",
  ],
  "model-training": [
    "model training",
    "pretraining",
    "fine-tuning",
    "finetuning",
    "post-training",
    "distillation",
    "alignment",
  ],
  multimodal: [
    "multimodal",
    "vision language models",
    "vlm",
    "text image",
    "text audio",
    "multimodal models",
  ],
  "open-source": [
    "open source",
    "open-source ai",
    "open models",
    "models",
    "tools",
  ],
  policy: [
    "policy",
    "regulation",
    "governance",
    "ethics",
    "responsible ai",
    "compliance",
  ],
  "quantum-ai": ["quantum ai", "quantum machine learning", "quantum computing"],
  "rag-search": [
    "rag",
    "retrieval augmented generation",
    "semantic search",
    "vector search",
    "embeddings",
    "information retrieval",
    "cs.ir",
  ],
  "recommendation-systems": [
    "recommendation systems",
    "recommender systems",
    "personalization",
    "ranking",
  ],
  "reinforcement-learning": [
    "reinforcement learning",
    "rl",
    "deep reinforcement learning",
    "reward models",
    "cs.lg",
  ],
  robotics: ["robotics", "robots", "autonomous systems", "embodied ai", "cs.ro"],
  security: [
    "security",
    "ai security",
    "cybersecurity",
    "safety",
    "red teaming",
    "adversarial ai",
  ],
  "speech-audio": [
    "speech",
    "audio",
    "speech recognition",
    "text to speech",
    "tts",
    "voice ai",
    "cs.sd",
  ],
};

function getConfiguredLimit(name: string, defaultLimit: number) {
  const configuredLimit = Number(process.env[name]);

  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }

  return process.env.NODE_ENV === "development"
    ? Math.min(defaultLimit, 3)
    : defaultLimit;
}

function getBatchSize() {
  return Math.min(getConfiguredLimit("SUMMARIZATION_BATCH_SIZE", 3), 5);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeCategory(value: string) {
  return value.trim().toLowerCase();
}

function expandUserCategories(categories: string[]) {
  const expandedCategories = new Set<string>();

  for (const category of categories) {
    const normalizedCategory = normalizeCategory(category);

    expandedCategories.add(normalizedCategory);

    for (const alias of CATEGORY_ALIASES[normalizedCategory] ?? []) {
      expandedCategories.add(normalizeCategory(alias));
    }
  }

  return expandedCategories;
}

function articleMatchesUser(article: ArticleRow, userCategories: string[]) {
  const expandedUserCategories = expandUserCategories(userCategories);
  const articleCategories = article.categories.map(normalizeCategory);

  return articleCategories.some((category) => expandedUserCategories.has(category));
}

async function getUsersWithPreferences(limit: number) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data, error } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id,categories")
    .not("categories", "eq", "{}")
    .limit(limit);

  if (error) {
    throw new Error(`Could not load user preferences: ${error.message}`);
  }

  return (data ?? []) as UserPreferenceRow[];
}

async function getUnreadMatchingArticles(
  userId: string,
  userCategories: string[],
  limit: number,
) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data: readRows, error: readError } = await supabaseAdmin
    .from("user_article_reads")
    .select("article_id")
    .eq("user_id", userId);

  if (readError) {
    throw new Error(`Could not load read state: ${readError.message}`);
  }

  const seenArticleIds = new Set((readRows ?? []).map((row) => row.article_id));
  const { data: articles, error: articlesError } = await supabaseAdmin
    .from("articles")
    .select("id,source,title,url,abstract,categories,published_at")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit * 4);

  if (articlesError) {
    throw new Error(`Could not load articles: ${articlesError.message}`);
  }

  return ((articles ?? []) as ArticleRow[])
    .filter((article) => !seenArticleIds.has(article.id))
    .filter((article) => articleMatchesUser(article, userCategories))
    .slice(0, limit);
}

async function storeSummary(
  userId: string,
  article: ArticleRow,
  userCategories: string[],
) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const summary = await summarizeArticleForUser({
    abstract: article.abstract,
    categories: article.categories,
    source: article.source,
    title: article.title,
    url: article.url,
    userCategories,
  });
  const summaryPayload = {
    article_id: article.id,
    input_tokens: summary.inputTokens,
    interest_categories: userCategories,
    model: summary.model,
    output_tokens: summary.outputTokens,
    summary: summary.summary,
    user_id: userId,
    why_this_matters: summary.whyThisMatters,
  };
  const { data: existingSummary, error: existingSummaryError } = await supabaseAdmin
    .from("article_summaries")
    .select("id")
    .eq("user_id", userId)
    .eq("article_id", article.id)
    .maybeSingle();

  if (existingSummaryError) {
    throw new Error(
      `Could not check existing summary: ${existingSummaryError.message}`,
    );
  }

  const summaryWrite = existingSummary
    ? supabaseAdmin
        .from("article_summaries")
        .update(summaryPayload)
        .eq("id", existingSummary.id)
        .select("id")
        .single()
    : supabaseAdmin
        .from("article_summaries")
        .insert(summaryPayload)
        .select("id")
        .single();
  const { data: summaryRow, error: summaryError } = (await summaryWrite) as {
    data: SummaryWriteRow | null;
    error: { message: string } | null;
  };

  if (summaryError) {
    throw new Error(`Could not store summary: ${summaryError.message}`);
  }

  if (!summaryRow) {
    throw new Error("Could not store summary: no summary row returned.");
  }

  const { error: readError } = await supabaseAdmin
    .from("user_article_reads")
    .upsert(
      {
        article_id: article.id,
        status: "summarized",
        summarized_at: new Date().toISOString(),
        summary_id: summaryRow.id,
        user_id: userId,
      },
      {
        onConflict: "user_id,article_id",
      },
    );

  if (readError) {
    throw new Error(`Could not mark article summarized: ${readError.message}`);
  }
}

export async function summarizeUnreadArticles(): Promise<SummarizationResult> {
  const result: SummarizationResult = {
    articlesMatched: 0,
    errors: [],
    failed: 0,
    skipped: 0,
    summariesCreated: 0,
    usersScanned: 0,
  };
  const users = await getUsersWithPreferences(
    getConfiguredLimit("SUMMARIZATION_MAX_USERS", 25),
  );
  const articlesPerUser = getConfiguredLimit("SUMMARIZATION_MAX_ARTICLES_PER_USER", 10);
  const batchSize = getBatchSize();

  result.usersScanned = users.length;

  for (const user of users) {
    if (user.categories.length === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      const articles = await getUnreadMatchingArticles(
        user.user_id,
        user.categories,
        articlesPerUser,
      );

      result.articlesMatched += articles.length;

      for (const articleBatch of chunk(articles, batchSize)) {
        const settledSummaries = await Promise.allSettled(
          articleBatch.map((article) =>
            storeSummary(user.user_id, article, user.categories),
          ),
        );

        for (const settledSummary of settledSummaries) {
          if (settledSummary.status === "fulfilled") {
            result.summariesCreated += 1;
            continue;
          }

          result.failed += 1;
          result.errors.push(
            settledSummary.reason instanceof Error
              ? settledSummary.reason.message
              : String(settledSummary.reason),
          );
        }
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
