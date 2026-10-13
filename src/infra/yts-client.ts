import { sleep } from "../shared/async-utils.ts";
import { PAGE_SIZE } from "../config/app-config.ts";
import { log } from "../shared/logger.ts";
import type { YtsMovie } from "../domain/types.ts";

interface YtsPageResponse {
  status?: string;
  status_message?: string;
  data?: { movie_count?: number; movies?: YtsMovie[] };
}

interface FetchPageResult {
  movies: YtsMovie[];
  total: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS = 2;

/** Cliente HTTP para a API de listagem de filmes do YTS, com uma retentativa em caso de falha. */
export class YtsClient {
  constructor(private readonly baseUrl: string) {}

  async fetchPage(page: number, quality?: string): Promise<FetchPageResult> {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
      sort_by: "date_added",
      order_by: "desc",
    });
    if (quality) params.set("quality", quality);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestPage(params);
      } catch (error) {
        lastError = error;
        this.logAttemptFailure(page, attempt, error);
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
    }
    throw new Error(
      `Não consegui falar com a API do YTS em ${this.baseUrl} (${(lastError as Error)?.message ?? lastError}). ` +
        `Teste no terminal: curl -m 15 "${this.baseUrl}?limit=1"`,
    );
  }

  private async requestPage(params: URLSearchParams): Promise<FetchPageResult> {
    const response = await fetch(`${this.baseUrl}?${params}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "yts-proxy-local/1.0",
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`YTS respondeu HTTP ${response.status}`);

    const json = (await response.json()) as YtsPageResponse;
    if (json.status && json.status !== "ok") {
      throw new Error(`YTS: ${json.status_message ?? json.status}`);
    }
    return {
      movies: json.data?.movies ?? [],
      total: json.data?.movie_count ?? 0,
    };
  }

  private logAttemptFailure(page: number, attempt: number, error: unknown): void {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    log(
      `  página ${page}: tentativa ${attempt} falhou (${(error as Error).message}${cause ? ` / ${cause}` : ""})`,
    );
  }
}
