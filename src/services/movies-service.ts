import { log } from "../shared/logger.ts";
import { MovieCache } from "../infra/movie-cache.ts";
import { filterByReleaseRange } from "../domain/movie-filters.ts";
import { cacheKeyFor, isPeriodFinalized, periodRangeFor } from "../domain/period.ts";
import { PeriodCollector } from "./period-collector.ts";
import type { YtsClient } from "../infra/yts-client.ts";
import type { ReleaseYearRange, YtsMovie } from "../domain/types.ts";

export interface MoviesQueryInput {
  year: number;
  month: number | null;
  quality?: string;
  release: ReleaseYearRange | null;
}

export interface MoviesQueryResponse {
  count: number;
  totalInPeriod: number;
  cached: boolean;
  /** Ausente quando a resposta veio do cache. */
  pagesFetched?: number;
  movies: YtsMovie[];
}

interface MoviesServiceOptions {
  maxPages: number;
  pageDelayMs: number;
}

/** Orquestra cache, busca no upstream e filtros para atender consultas de `/movies`. */
export class MoviesService {
  private readonly inflightRequests = new Map<
    string,
    Promise<{ movies: YtsMovie[]; pagesFetched: number }>
  >();

  constructor(
    private readonly client: YtsClient,
    private readonly cache: MovieCache,
    private readonly options: MoviesServiceOptions,
  ) {}

  async query(input: MoviesQueryInput): Promise<MoviesQueryResponse> {
    const period = periodRangeFor(input.year, input.month);
    const key = cacheKeyFor(input.year, input.month, input.quality);
    const finalized = isPeriodFinalized(period);

    const cachedMovies = await this.cache.read(key, finalized);
    if (cachedMovies) return this.buildResponse(key, cachedMovies, input.release, true);

    const { movies, pagesFetched } = await this.collectAndCache(key, period, input.quality);
    return this.buildResponse(key, movies, input.release, false, pagesFetched);
  }

  private buildResponse(
    key: string,
    movies: YtsMovie[],
    release: ReleaseYearRange | null,
    cached: boolean,
    pagesFetched?: number,
  ): MoviesQueryResponse {
    const filtered = filterByReleaseRange(movies, release);
    const origin = cached ? "cache" : `${pagesFetched} chamadas`;
    log(`${key}: ${movies.length} filmes, ${filtered.length} após filtro de lançamento (${origin})`);
    return {
      count: filtered.length,
      totalInPeriod: movies.length,
      cached,
      ...(pagesFetched !== undefined ? { pagesFetched } : {}),
      movies: filtered,
    };
  }

  /** Reaproveita a busca em andamento quando já existe uma para a mesma chave (ex.: requisições concorrentes). */
  private async collectAndCache(
    key: string,
    period: { start: number; end: number },
    quality?: string,
  ): Promise<{ movies: YtsMovie[]; pagesFetched: number }> {
    let job = this.inflightRequests.get(key);
    if (!job) {
      log(`${key}: buscando na API…`);
      const collector = new PeriodCollector(this.client, this.options, quality);
      job = collector
        .collect(period.start, period.end)
        .then(async ({ movies, pagesFetched }) => {
          await this.cache.write(key, movies);
          return { movies, pagesFetched };
        })
        .finally(() => this.inflightRequests.delete(key));
      this.inflightRequests.set(key, job);
    }
    return job;
  }
}
