import { XMLParser } from "fast-xml-parser";
import { fetchWithTimeout, getIngestionLimit } from "./http";
import { RawArticle } from "./types";

const RSS_FEEDS = [
  {
    source: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
  },
  {
    source: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
  },
  {
    source: "Anthropic News",
    url: "https://www.anthropic.com/news/rss.xml",
  },
  {
    source: "Google DeepMind Blog",
    url: "https://deepmind.google/blog/rss.xml",
  },
];

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
});

type RssItem = {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  description?: string;
  pubDate?: string;
  category?: string | string[];
  creator?: string;
  "dc:creator"?: string;
};

type AtomEntry = {
  title?: string;
  link?: string | { href?: string; rel?: string } | Array<{ href?: string; rel?: string }>;
  id?: string;
  summary?: string;
  content?: string;
  published?: string;
  updated?: string;
  author?: { name?: string } | Array<{ name?: string }>;
  category?: { term?: string } | Array<{ term?: string }>;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripHtml(value?: string) {
  return value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getAtomLink(entry: AtomEntry) {
  if (typeof entry.link === "string") {
    return entry.link;
  }

  const links = toArray(entry.link);
  const alternateLink = links.find((link) => !link.rel || link.rel === "alternate");

  return alternateLink?.href ?? entry.id ?? "";
}

async function fetchFeed(feed: (typeof RSS_FEEDS)[number]) {
  const response = await fetchWithTimeout(
    feed.url,
    {
    headers: {
      "User-Agent": "PulseAI/1.0 (content-ingestion)",
    },
    },
    5_000,
  );

  if (!response.ok) {
    throw new Error(`${feed.source} RSS request failed with ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
    feed?: { entry?: AtomEntry | AtomEntry[] };
  };

  if (parsed.rss?.channel?.item) {
    return toArray(parsed.rss.channel.item)
      .slice(0, getIngestionLimit(20))
      .map<RawArticle | null>((item) => {
        const url =
          item.link ??
          (typeof item.guid === "string" ? item.guid : item.guid?.["#text"]) ??
          "";

        if (!item.title || !url) {
          return null;
        }

        return {
          source: feed.source,
          sourceType: "rss",
          title: item.title,
          url,
          abstract: stripHtml(item.description),
          authors: [item["dc:creator"] ?? item.creator].filter(Boolean) as string[],
          categories: toArray(item.category),
          publishedAt: item.pubDate,
          rawPayload: item,
        };
      })
      .filter(Boolean) as RawArticle[];
  }

  return toArray(parsed.feed?.entry)
    .slice(0, getIngestionLimit(20))
    .map<RawArticle | null>((entry) => {
      const url = getAtomLink(entry);

      if (!entry.title || !url) {
        return null;
      }

      return {
        source: feed.source,
        sourceType: "rss",
        title: entry.title,
        url,
        abstract: stripHtml(entry.summary ?? entry.content),
        authors: toArray(entry.author)
          .map((author) => author.name)
          .filter(Boolean) as string[],
        categories: toArray(entry.category)
          .map((category) => category.term)
          .filter(Boolean) as string[],
        publishedAt: entry.published ?? entry.updated,
        rawPayload: entry,
      };
    })
    .filter(Boolean) as RawArticle[];
}

export async function fetchRssArticles() {
  const settledFeeds = await Promise.allSettled(RSS_FEEDS.map(fetchFeed));

  return settledFeeds.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}
