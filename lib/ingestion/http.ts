const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getIngestionLimit(defaultLimit: number) {
  const configuredLimit = Number(process.env.INGESTION_MAX_RESULTS);

  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }

  return process.env.NODE_ENV === "development"
    ? Math.min(defaultLimit, 10)
    : defaultLimit;
}
