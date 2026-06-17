import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export type ArticleClassificationInput = {
  title: string;
  abstract?: string | null;
  url?: string | null;
  source?: string | null;
  categories: string[];
};

export type ArticleClassification = {
  importanceScore: number;
  isBreaking: boolean;
  breakingReason: string | null;
  matchedEntities: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

type ClassificationJson = {
  importance_score?: unknown;
  is_breaking?: unknown;
  breaking_reason?: unknown;
  matched_entities?: unknown;
};

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  return new Anthropic({ apiKey });
}

function extractText(content: Anthropic.Messages.Message["content"]) {
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

function getArticleContext(article: ArticleClassificationInput) {
  return [
    `Title: ${article.title}`,
    article.source ? `Source: ${article.source}` : null,
    article.url ? `URL: ${article.url}` : null,
    article.categories.length > 0
      ? `Article categories: ${article.categories.join(", ")}`
      : null,
    article.abstract ? `Article content: ${article.abstract}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function clampImportanceScore(value: unknown) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(10, Math.max(0, Math.round(score)));
}

function normalizeMatchedEntities(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entity): entity is string => typeof entity === "string")
    .map((entity) => entity.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseClassificationJson(text: string): ClassificationJson {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Claude classification response did not include JSON.");
  }

  return JSON.parse(jsonMatch[0]) as ClassificationJson;
}

export async function classifyArticleForAlerts(
  article: ArticleClassificationInput,
): Promise<ArticleClassification> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const message = await client.messages.create({
    max_tokens: 420,
    messages: [
      {
        role: "user",
        content: `${getArticleContext(article)}

Classify this AI update for a personalized breaking-alert product.

Return only JSON with this shape:
{
  "importance_score": number,
  "is_breaking": boolean,
  "breaking_reason": string | null,
  "matched_entities": string[]
}

Rules:
- importance_score must be 0-10.
- Use 8-10 for major model launches, major AI product releases, important policy changes, significant safety/security incidents, major pricing/API changes, or widely relevant benchmark breakthroughs.
- Use 4-7 for useful but routine research, product updates, tutorials, or funding/news.
- Use 0-3 for narrow, incremental, or low-relevance items.
- is_breaking should only be true when this deserves an immediate alert for users who follow related categories or entities.
- matched_entities should include company, model, product, and topic names mentioned or strongly implied, like "Fable 5", "Claude", "OpenAI", "Gemini", "Llama", "Anthropic", "agents", or "frontier models".`,
      },
    ],
    model,
    system:
      "You classify AI news and research for a user-facing alerting product. Be conservative about breaking alerts and return valid JSON only.",
  });
  const parsed = parseClassificationJson(extractText(message.content));
  const importanceScore = clampImportanceScore(parsed.importance_score);
  const isBreaking = Boolean(parsed.is_breaking) && importanceScore >= 8;
  const rawReason =
    typeof parsed.breaking_reason === "string"
      ? parsed.breaking_reason.trim()
      : null;

  return {
    breakingReason: isBreaking && rawReason ? rawReason : null,
    importanceScore,
    inputTokens: message.usage.input_tokens,
    isBreaking,
    matchedEntities: normalizeMatchedEntities(parsed.matched_entities),
    model,
    outputTokens: message.usage.output_tokens,
  };
}
