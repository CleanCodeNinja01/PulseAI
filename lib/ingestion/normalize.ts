import { canonicalizeUrl, hashValue, normalizeDoi } from "./dedupe";
import { NormalizedArticle, RawArticle } from "./types";

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parsePublishedAt(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeArticle(article: RawArticle): NormalizedArticle | null {
  const title = cleanText(article.title);
  const canonicalUrl = canonicalizeUrl(article.url);

  if (!title || !canonicalUrl) {
    return null;
  }

  const doi = normalizeDoi(article.doi);

  return {
    source: article.source,
    source_type: article.sourceType,
    title,
    url: canonicalUrl,
    doi,
    abstract: article.abstract ? cleanText(article.abstract) : null,
    authors: article.authors?.map(cleanText).filter(Boolean) ?? [],
    categories: article.categories?.map(cleanText).filter(Boolean) ?? [],
    published_at: parsePublishedAt(article.publishedAt),
    raw_payload: article.rawPayload,
    url_hash: hashValue(canonicalUrl),
    doi_hash: doi ? hashValue(doi) : null,
  };
}

export function normalizeArticles(articles: RawArticle[]) {
  const seenUrlHashes = new Set<string>();
  const seenDoiHashes = new Set<string>();
  const normalizedArticles: NormalizedArticle[] = [];

  for (const article of articles) {
    const normalizedArticle = normalizeArticle(article);

    if (!normalizedArticle) {
      continue;
    }

    if (seenUrlHashes.has(normalizedArticle.url_hash)) {
      continue;
    }

    if (
      normalizedArticle.doi_hash &&
      seenDoiHashes.has(normalizedArticle.doi_hash)
    ) {
      continue;
    }

    seenUrlHashes.add(normalizedArticle.url_hash);

    if (normalizedArticle.doi_hash) {
      seenDoiHashes.add(normalizedArticle.doi_hash);
    }

    normalizedArticles.push(normalizedArticle);
  }

  return normalizedArticles;
}
