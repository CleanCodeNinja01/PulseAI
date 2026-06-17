import { fetchWithTimeout, getIngestionLimit } from "./http";
import { RawArticle } from "./types";

type NewsApiArticle = {
  source?: {
    name?: string;
  };
  author?: string;
  title?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  content?: string;
};

type NewsApiResponse = {
  status: string;
  articles?: NewsApiArticle[];
  message?: string;
};

export async function fetchNewsArticles() {
  const apiKey = process.env.NEWS_API_KEY;

  if (!apiKey) {
    return [];
  }

  const url = new URL("https://newsapi.org/v2/everything");

  url.searchParams.set("q", '"artificial intelligence" OR "machine learning"');
  url.searchParams.set("language", "en");
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("pageSize", String(getIngestionLimit(25)));
  url.searchParams.set("apiKey", apiKey);

  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "PulseAI/1.0 (content-ingestion)",
    },
  });

  if (!response.ok) {
    throw new Error(`News API request failed with ${response.status}`);
  }

  const payload = (await response.json()) as NewsApiResponse;

  if (payload.status !== "ok") {
    throw new Error(payload.message ?? "News API returned a non-ok response");
  }

  return (payload.articles ?? [])
    .map<RawArticle | null>((article) => {
      if (!article.title || !article.url) {
        return null;
      }

      return {
        source: article.source?.name ?? "News API",
        sourceType: "news",
        title: article.title,
        url: article.url,
        abstract: article.description ?? article.content,
        authors: [article.author].filter(Boolean) as string[],
        categories: ["news"],
        publishedAt: article.publishedAt,
        rawPayload: article,
      };
    })
    .filter(Boolean) as RawArticle[];
}
