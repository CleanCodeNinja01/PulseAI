import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export type ClaudeArticleInput = {
  title: string;
  abstract?: string | null;
  url?: string | null;
  source?: string | null;
  categories: string[];
  userCategories: string[];
};

export type ClaudeArticleSummary = {
  summary: string;
  whyThisMatters: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  return new Anthropic({ apiKey });
}

function getArticleContext(article: ClaudeArticleInput) {
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

function extractText(content: Anthropic.Messages.Message["content"]) {
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

async function runClaudePrompt(prompt: string, maxTokens: number) {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const message = await client.messages.create({
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    model,
    system:
      "You summarize AI research and news for a technical but busy reader. Be accurate, concise, and avoid hype.",
  });

  return {
    inputTokens: message.usage.input_tokens,
    model,
    outputTokens: message.usage.output_tokens,
    text: extractText(message.content),
  };
}

export async function summarizeArticle(article: ClaudeArticleInput) {
  const articleContext = getArticleContext(article);

  return runClaudePrompt(
    `${articleContext}

Task: Write exactly 3 sentences summarizing the article. Focus on what happened, why it is notable, and any important limitation or context.`,
    220,
  );
}

export async function explainWhyArticleMatters(article: ClaudeArticleInput) {
  const articleContext = getArticleContext(article);
  const userInterests = article.userCategories.join(", ");

  return runClaudePrompt(
    `${articleContext}

User interests: ${userInterests}

Task: Write one concise paragraph explaining why this matters for someone interested in these categories. Make the connection to the user's interests explicit.`,
    260,
  );
}

export async function summarizeArticleForUser(
  article: ClaudeArticleInput,
): Promise<ClaudeArticleSummary> {
  const [summaryResult, insightResult] = await Promise.all([
    summarizeArticle(article),
    explainWhyArticleMatters(article),
  ]);

  return {
    summary: summaryResult.text,
    whyThisMatters: insightResult.text,
    model: summaryResult.model,
    inputTokens: summaryResult.inputTokens + insightResult.inputTokens,
    outputTokens: summaryResult.outputTokens + insightResult.outputTokens,
  };
}
