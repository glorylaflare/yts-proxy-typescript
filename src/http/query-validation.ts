import { parseReleaseRange } from "../domain/movie-filters.ts";
import type { ReleaseYearRange } from "../domain/types.ts";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Parâmetros de `/movies` já validados e normalizados. */
export interface MoviesQuery {
  year: number;
  month: number | null;
  quality?: string;
  /** Valor normalizado (aparado e em minúsculas) de `release`, ou `""` quando ausente. */
  releaseRaw: string;
  release: ReleaseYearRange | null;
}

export type MoviesQueryResult =
  | { ok: true; query: MoviesQuery }
  | { ok: false; error: string };

/** Valida e normaliza os parâmetros de consulta de `GET /movies`. */
export function parseMoviesQuery(query: Record<string, unknown>): MoviesQueryResult {
  const year = Number(query.year);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return { ok: false, error: "Informe year, ex.: /movies?year=2025&month=3" };
  }

  const monthRaw = query.month;
  const month = monthRaw === undefined || monthRaw === "" ? null : Number(monthRaw);
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { ok: false, error: "month deve ser de 1 a 12 (ou omitido para o ano todo)" };
  }

  const quality = typeof query.quality === "string" && query.quality ? query.quality : undefined;

  const releaseRaw = typeof query.release === "string" ? query.release.trim().toLowerCase() : "";
  const release = parseReleaseRange(releaseRaw);
  if (release === undefined) {
    return {
      ok: false,
      error: "release inválido. Use um ano (2025) ou faixa (2020-now, 2010-2019)",
    };
  }

  return { ok: true, query: { year, month, quality, releaseRaw, release } };
}
