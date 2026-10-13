/** Filme conforme retornado pela API de listagem do YTS. */
export interface YtsMovie {
  id: number;
  title: string;
  year: number;
  imdb_code?: string;
  date_uploaded?: string; // "2025-03-14 21:05:11"
  date_uploaded_unix?: number;
  [key: string]: unknown;
}

/** Faixa de anos de lançamento usada pelo filtro opcional `release`. */
export interface ReleaseYearRange {
  from: number;
  to: number;
}

/** Período de upload, em segundos UTC: início inclusivo, fim exclusivo. */
export interface MoviesPeriod {
  start: number;
  end: number;
}

/** Resultado de uma coleta de filmes de um período no upstream. */
export interface CollectResult {
  movies: YtsMovie[];
  pagesFetched: number;
}
