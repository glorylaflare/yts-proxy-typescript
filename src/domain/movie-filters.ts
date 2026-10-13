import type { ReleaseYearRange, YtsMovie } from "./types.ts";

/** Timestamp (segundos, UTC) de upload; cai para `date_uploaded` se o unix faltar. */
export function uploadedAt(movie: YtsMovie): number | null {
  if (typeof movie.date_uploaded_unix === "number") return movie.date_uploaded_unix;
  if (movie.date_uploaded) {
    const parsed = Date.parse(`${movie.date_uploaded.replace(" ", "T")}Z`);
    if (!Number.isNaN(parsed)) return parsed / 1000;
  }
  return null;
}

/** Filtro opcional pelo ano de lançamento (campo `year` do filme). */
export function filterByReleaseRange(
  movies: YtsMovie[],
  range: ReleaseYearRange | null,
): YtsMovie[] {
  return range ? movies.filter((m) => m.year >= range.from && m.year <= range.to) : movies;
}

const RELEASE_RANGE_PATTERN = /^(\d{4})(?:-(\d{4}|now))?$/;

/**
 * Converte o parâmetro `release` (já normalizado: aparado e em minúsculas) em uma
 * faixa de anos. Retorna `null` para vazio ou "all" (sem filtro) e `undefined`
 * quando o formato é inválido (ex.: faixa invertida ou texto fora do padrão).
 */
export function parseReleaseRange(normalized: string): ReleaseYearRange | null | undefined {
  if (!normalized || normalized === "all") return null;

  const match = RELEASE_RANGE_PATTERN.exec(normalized);
  if (!match) return undefined;

  const from = Number(match[1]);
  const to =
    match[2] === undefined ? from : match[2] === "now" ? new Date().getFullYear() : Number(match[2]);
  if (from > to) return undefined;

  return { from, to };
}
