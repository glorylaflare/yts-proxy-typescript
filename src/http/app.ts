import express, { type Express } from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CURRENT_PERIOD_TTL_MS, type AppConfig } from "../config/app-config.ts";
import { cacheKeyFor } from "../domain/period.ts";
import { MovieCache } from "../infra/movie-cache.ts";
import { YtsClient } from "../infra/yts-client.ts";
import { MoviesService } from "../services/movies-service.ts";
import { log } from "../shared/logger.ts";
import { parseMoviesQuery } from "./query-validation.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL("../public/index.html", import.meta.url));

/** Monta o servidor Express (rotas `/`, `/movies` e `/health`, e estáticos de `src/public`) a partir de uma configuração. */
export function createApp(config: AppConfig): Express {
  const client = new YtsClient(config.ytsApiBaseUrl);
  const cache = new MovieCache(config.cacheDir, CURRENT_PERIOD_TTL_MS);
  const moviesService = new MoviesService(client, cache, {
    maxPages: config.maxPages,
    pageDelayMs: config.pageDelayMs,
  });

  const app = express();

  // Serve CSS, imagens, etc. de src/public (o HTML da raiz é tratado abaixo, à parte).
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.get("/", async (_req, res) => {
    try {
      res.type("html").send(await readFile(INDEX_HTML_PATH, "utf8"));
    } catch {
      res
        .status(500)
        .type("text")
        .send("Arquivo index.html não encontrado em src/public/.");
    }
  });

  app.get("/movies", async (req, res) => {
    const parsed = parseMoviesQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const { year, month, quality, release, releaseRaw } = parsed.query;
    try {
      const result = await moviesService.query({ year, month, quality, release });
      res.json({
        count: result.count,
        total_in_period: result.totalInPeriod,
        release: releaseRaw || null,
        cached: result.cached,
        ...(result.pagesFetched !== undefined ? { pages_fetched: result.pagesFetched } : {}),
        movies: result.movies,
      });
    } catch (error) {
      const key = cacheKeyFor(year, month, quality);
      log(`${key}: ERRO ${(error as Error).message}`);
      res.status(502).json({ error: (error as Error).message });
    }
  });

  app.get("/health", (_req, res) => res.json({ ok: true, upstream: config.ytsApiBaseUrl }));

  return app;
}
