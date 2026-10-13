import { join } from "node:path";
import process from "node:process";

/** Configuração de uma instância do servidor/proxy. */
export interface AppConfig {
  /** URL base da API do YTS usada como upstream. */
  ytsApiBaseUrl: string;
  /** Porta em que o servidor HTTP escuta. */
  port: number;
  /** Diretório onde os arquivos de cache (`.json`) são gravados. */
  cacheDir: string;
  /** Número máximo de páginas varridas por consulta (trava de segurança). */
  maxPages: number;
  /** Atraso, em milissegundos, entre chamadas consecutivas ao upstream. */
  pageDelayMs: number;
}

/** Quantidade de filmes por página solicitada ao YTS. */
export const PAGE_SIZE = 50;

/** Tempo de vida do cache do período em andamento (mês/ano corrente). */
export const CURRENT_PERIOD_TTL_MS = 30 * 60 * 1000;

/** Configuração padrão usada ao iniciar o servidor em produção. */
export const defaultConfig: AppConfig = {
  ytsApiBaseUrl: "https://movies-api.accel.li/api/v2/list_movies.json",
  port: 8000,
  cacheDir: join(process.cwd(), ".cache"),
  maxPages: 400,
  pageDelayMs: 250,
};
