import { fetchArxivArticles } from "./arxiv";
import { fetchNewsArticles } from "./news";
import { normalizeArticles } from "./normalize";
import { fetchRssArticles } from "./rss";
import { storeArticles } from "./store";
import { IngestionResult, RawArticle } from "./types";

type SourceFetcher = {
  name: string;
  fetch: () => Promise<RawArticle[]>;
};

const SOURCE_FETCHERS: SourceFetcher[] = [
  {
    name: "arXiv",
    fetch: fetchArxivArticles,
  },
  {
    name: "RSS",
    fetch: fetchRssArticles,
  },
  {
    name: "News API",
    fetch: fetchNewsArticles,
  },
];

export async function ingestArticles(): Promise<IngestionResult> {
  const errors: string[] = [];
  const sourceResults = await Promise.allSettled(
    SOURCE_FETCHERS.map(async (source) => ({
      source: source.name,
      articles: await source.fetch(),
    })),
  );
  const rawArticles = sourceResults.flatMap((result) => {
    if (result.status === "fulfilled") {
      return result.value.articles;
    }

    errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    return [];
  });
  const normalizedArticles = normalizeArticles(rawArticles);
  const storeResult = await storeArticles(normalizedArticles);

  return {
    fetched: rawArticles.length,
    inserted: storeResult.inserted,
    skipped: rawArticles.length - normalizedArticles.length + storeResult.skipped,
    failed: storeResult.failed,
    errors: [...errors, ...storeResult.errors],
  };
}
