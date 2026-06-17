import { XMLParser } from "fast-xml-parser";
import { fetchWithTimeout, getIngestionLimit } from "./http";
import { RawArticle } from "./types";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const DEFAULT_ARXIV_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.CV", "stat.ML"];

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
});

type ArxivAuthor = {
  name?: string;
};

type ArxivCategory = {
  term?: string;
};

type ArxivLink = {
  href?: string;
  rel?: string;
  title?: string;
  type?: string;
};

type ArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  category?: ArxivCategory | ArxivCategory[];
  link?: ArxivLink | ArxivLink[];
  "arxiv:doi"?: string;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getEntryUrl(entry: ArxivEntry) {
  const links = toArray(entry.link);
  const htmlLink = links.find((link) => link.type === "text/html");

  return htmlLink?.href ?? entry.id ?? "";
}

export async function fetchArxivArticles() {
  const maxResults = getIngestionLimit(25);
  const searchQuery = DEFAULT_ARXIV_CATEGORIES.map((category) => `cat:${category}`).join(
    " OR ",
  );
  const url = new URL(ARXIV_API_URL);

  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  url.searchParams.set("max_results", String(maxResults));

  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "PulseAI/1.0 (content-ingestion)",
    },
  });

  if (!response.ok) {
    throw new Error(`arXiv request failed with ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
  const entries = toArray(parsed.feed?.entry);

  return entries
    .map<RawArticle | null>((entry) => {
      const url = getEntryUrl(entry);

      if (!entry.title || !url) {
        return null;
      }

      return {
        source: "arXiv",
        sourceType: "arxiv",
        title: entry.title,
        url,
        doi: entry["arxiv:doi"],
        abstract: entry.summary,
        authors: toArray(entry.author)
          .map((author) => author.name)
          .filter(Boolean) as string[],
        categories: toArray(entry.category)
          .map((category) => category.term)
          .filter(Boolean) as string[],
        publishedAt: entry.published,
        rawPayload: entry,
      };
    })
    .filter(Boolean) as RawArticle[];
}
