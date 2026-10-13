import { sleep } from "../shared/async-utils.ts";
import { PAGE_SIZE } from "../config/app-config.ts";
import { log } from "../shared/logger.ts";
import { uploadedAt } from "../domain/movie-filters.ts";
import type { YtsClient } from "../infra/yts-client.ts";
import type { CollectResult, YtsMovie } from "../domain/types.ts";

interface PeriodCollectorOptions {
  maxPages: number;
  pageDelayMs: number;
}

/**
 * Coleta os filmes de um período de upload a partir da API do YTS.
 *
 * A listagem vem do mais novo para o mais antigo (sort_by=date_added desc). Em vez
 * de varrer desde a página 1, faz uma busca binária para achar a primeira página
 * que já tem filmes mais antigos que o fim do período e só então varre para frente.
 * Só para quando uma página INTEIRA é anterior ao início do período, porque a API
 * pode ter pequenos desvios de ordem entre itens vizinhos.
 */
export class PeriodCollector {
  private readonly pagesCache = new Map<number, YtsMovie[]>();
  private callCount = 0;

  constructor(
    private readonly client: YtsClient,
    private readonly options: PeriodCollectorOptions,
    private readonly quality?: string,
  ) {}

  async collect(start: number, end: number): Promise<CollectResult> {
    const totalPages = await this.fetchFirstPageAndCountTotal();
    const periodStartPage = await this.findPeriodStartPage(totalPages, end);
    log(`  período começa perto da página ${periodStartPage} (${this.callCount} chamadas até aqui)`);

    const movies = await this.scanForward(periodStartPage, start, end);
    return { movies, pagesFetched: this.callCount };
  }

  private async fetchFirstPageAndCountTotal(): Promise<number> {
    const { movies, total } = await this.client.fetchPage(1, this.quality);
    this.callCount++;
    this.pagesCache.set(1, movies);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    log(`  ${total} filmes no total (${totalPages} páginas)`);
    return totalPages;
  }

  private async getPage(page: number): Promise<YtsMovie[]> {
    const cached = this.pagesCache.get(page);
    if (cached) return cached;

    if (this.callCount > 0) await sleep(this.options.pageDelayMs);
    const { movies } = await this.client.fetchPage(page, this.quality);
    this.callCount++;
    this.pagesCache.set(page, movies);
    return movies;
  }

  /** Menor página cujo último item já é mais antigo que o fim do período. */
  private async findPeriodStartPage(totalPages: number, end: number): Promise<number> {
    let low = 1;
    let high = totalPages;
    while (low < high) {
      const mid = (low + high) >> 1;
      const batch = await this.getPage(mid);
      const lastTimestamp = lastUploadedAt(batch);
      const isPastPeriod = batch.length === 0 || (lastTimestamp !== null && lastTimestamp < end);
      if (isPastPeriod) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  private async scanForward(fromPage: number, start: number, end: number): Promise<YtsMovie[]> {
    const movies: YtsMovie[] = [];
    const seenIds = new Set<number>();

    let scanned = 0;
    for (let page = Math.max(1, fromPage - 1); scanned < this.options.maxPages; page++, scanned++) {
      const batch = await this.getPage(page);
      if (batch.length === 0) break;

      let isBatchEntirelyBeforeStart = true;
      for (const movie of batch) {
        const timestamp = uploadedAt(movie);
        if (timestamp === null) continue;
        if (timestamp >= start) isBatchEntirelyBeforeStart = false;
        if (timestamp >= start && timestamp < end && !seenIds.has(movie.id)) {
          seenIds.add(movie.id);
          movies.push(movie);
        }
      }

      if (isBatchEntirelyBeforeStart) break;
      if (batch.length < PAGE_SIZE) break; // última página
    }
    return movies;
  }
}

function lastUploadedAt(batch: YtsMovie[]): number | null {
  for (let i = batch.length - 1; i >= 0; i--) {
    const timestamp = uploadedAt(batch[i]);
    if (timestamp !== null) return timestamp;
  }
  return null;
}
