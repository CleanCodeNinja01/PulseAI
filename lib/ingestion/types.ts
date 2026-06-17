export type SourceType = "arxiv" | "rss" | "news";

export type RawArticle = {
  source: string;
  sourceType: SourceType;
  title: string;
  url: string;
  doi?: string;
  abstract?: string;
  authors?: string[];
  categories?: string[];
  publishedAt?: string;
  rawPayload: unknown;
};

export type NormalizedArticle = {
  source: string;
  source_type: SourceType;
  title: string;
  url: string;
  doi: string | null;
  abstract: string | null;
  authors: string[];
  categories: string[];
  published_at: string | null;
  raw_payload: unknown;
  url_hash: string;
  doi_hash: string | null;
};

export type IngestionResult = {
  fetched: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
};
