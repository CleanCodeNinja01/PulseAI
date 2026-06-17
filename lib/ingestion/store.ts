import { supabaseAdmin } from "@/lib/supabase-server";
import { IngestionResult, NormalizedArticle } from "./types";

const UNIQUE_VIOLATION_CODE = "23505";
const BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function getExistingHashes(articles: NormalizedArticle[]) {
  if (!supabaseAdmin || articles.length === 0) {
    return {
      doiHashes: new Set<string>(),
      urlHashes: new Set<string>(),
    };
  }

  const urlHashes = articles.map((article) => article.url_hash);
  const doiHashes = articles
    .map((article) => article.doi_hash)
    .filter(Boolean) as string[];
  const existingUrlHashes = new Set<string>();
  const existingDoiHashes = new Set<string>();

  for (const hashChunk of chunk(urlHashes, BATCH_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("articles")
      .select("url_hash")
      .in("url_hash", hashChunk);

    if (error) {
      throw new Error(`Could not check existing article URLs: ${error.message}`);
    }

    data?.forEach((article) => existingUrlHashes.add(article.url_hash));
  }

  for (const hashChunk of chunk(doiHashes, BATCH_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("articles")
      .select("doi_hash")
      .in("doi_hash", hashChunk);

    if (error) {
      throw new Error(`Could not check existing article DOIs: ${error.message}`);
    }

    data?.forEach((article) => {
      if (article.doi_hash) {
        existingDoiHashes.add(article.doi_hash);
      }
    });
  }

  return {
    doiHashes: existingDoiHashes,
    urlHashes: existingUrlHashes,
  };
}

async function insertArticleFallback(article: NormalizedArticle) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { error } = await supabaseAdmin.from("articles").insert(article);

  if (!error) {
    return "inserted" as const;
  }

  if (error.code === UNIQUE_VIOLATION_CODE) {
    return "skipped" as const;
  }

  throw error;
}

export async function storeArticles(
  articles: NormalizedArticle[],
): Promise<Pick<IngestionResult, "inserted" | "skipped" | "failed" | "errors">> {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const result = {
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };
  const existingHashes = await getExistingHashes(articles);
  const newArticles = articles.filter((article) => {
    const isDuplicateByUrl = existingHashes.urlHashes.has(article.url_hash);
    const isDuplicateByDoi = article.doi_hash
      ? existingHashes.doiHashes.has(article.doi_hash)
      : false;

    return !isDuplicateByUrl && !isDuplicateByDoi;
  });

  result.skipped += articles.length - newArticles.length;

  for (const articleBatch of chunk(newArticles, BATCH_SIZE)) {
    const { error } = await supabaseAdmin.from("articles").insert(articleBatch);

    if (!error) {
      result.inserted += articleBatch.length;
      continue;
    }

    if (error.code !== UNIQUE_VIOLATION_CODE) {
      result.failed += articleBatch.length;
      result.errors.push(error.message);
      continue;
    }

    for (const article of articleBatch) {
      try {
        const status = await insertArticleFallback(article);
        result[status] += 1;
      } catch (fallbackError) {
        result.failed += 1;
        result.errors.push(
          `${article.source}: ${article.title} - ${
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError)
          }`,
        );
      }
    }
  }

  return result;
}
