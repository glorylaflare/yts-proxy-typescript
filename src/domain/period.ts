import type { MoviesPeriod } from "./types.ts";

/** Intervalo `[início, fim)` em segundos UTC para um ano (e mês opcional) de upload. */
export function periodRangeFor(year: number, month: number | null): MoviesPeriod {
  const start = Date.UTC(year, month ? month - 1 : 0, 1) / 1000;
  const end = (month ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1)) / 1000;
  return { start, end };
}

/** Um período já encerrado (totalmente no passado) nunca muda, podendo ficar em cache para sempre. */
export function isPeriodFinalized(period: MoviesPeriod): boolean {
  return period.end * 1000 < Date.now();
}

/** Chave de cache/deduplicação para um período de upload com uma qualidade específica. */
export function cacheKeyFor(year: number, month: number | null, quality?: string): string {
  return `${year}-${month ?? "all"}-${quality ?? "any"}`;
}
