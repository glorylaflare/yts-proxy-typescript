import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const YTS_API =
  process.env.YTS_API ?? "https://movies-api.accel.li/api/v2/list_movies.json";
const PORT = Number(process.env.PORT ?? 8000);
const CACHE_DIR = process.env.CACHE_DIR ?? join(process.cwd(), ".cache");
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 400); // trava de segurança
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? 250); // educado com a API
const CURRENT_TTL_MS = 30 * 60 * 1000; // mês em andamento: cache curto
const PAGE_SIZE = 50;

interface YtsMovie {
  id: number;
  title: string;
  year: number;
  imdb_code?: string;
  date_uploaded?: string; // "2025-03-14 21:05:11"
  date_uploaded_unix?: number;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) =>
  console.log(new Date().toLocaleTimeString("pt-BR"), ...a);

/** Timestamp (segundos, UTC) de upload; cai para date_uploaded se o unix faltar. */
function uploadedAt(m: YtsMovie): number | null {
  if (typeof m.date_uploaded_unix === "number") return m.date_uploaded_unix;
  if (m.date_uploaded) {
    const t = Date.parse(m.date_uploaded.replace(" ", "T") + "Z");
    if (!Number.isNaN(t)) return t / 1000;
  }
  return null;
}

async function fetchPage(
  page: number,
  quality?: string,
): Promise<{ movies: YtsMovie[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    page: String(page),
    sort_by: "date_added",
    order_by: "desc",
  });
  if (quality) params.set("quality", quality);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${YTS_API}?${params}`, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": "yts-proxy-local/1.0",
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`YTS respondeu HTTP ${res.status}`);
      const json = (await res.json()) as {
        status?: string;
        status_message?: string;
        data?: { movie_count?: number; movies?: YtsMovie[] };
      };
      if (json.status && json.status !== "ok") {
        throw new Error(`YTS: ${json.status_message ?? json.status}`);
      }
      return {
        movies: json.data?.movies ?? [],
        total: json.data?.movie_count ?? 0,
      };
    } catch (err) {
      lastErr = err;
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      log(
        `  página ${page}: tentativa ${attempt} falhou (${(err as Error).message}${cause ? ` / ${cause}` : ""})`,
      );
      if (attempt < 2) await sleep(500);
    }
  }
  throw new Error(
    `Não consegui falar com a API do YTS em ${YTS_API} (${(lastErr as Error)?.message ?? lastErr}). ` +
      `Teste no terminal: curl -m 15 "${YTS_API}?limit=1"`,
  );
}

/**
 * A lista vem do mais novo para o mais antigo (sort_by=date_added desc). Em vez de
 * varrer desde a página 1, faz uma busca binária para achar a primeira página que
 * já tem filmes mais antigos que o fim do período e só então varre para frente.
 * Só para quando uma página INTEIRA é anterior ao início do período, porque a API
 * pode ter pequenos desvios de ordem entre itens vizinhos.
 */
async function collect(start: number, end: number, quality?: string) {
  const pages = new Map<number, YtsMovie[]>();
  let calls = 0;

  const getPage = async (p: number) => {
    const hit = pages.get(p);
    if (hit) return hit;
    if (calls > 0) await sleep(PAGE_DELAY_MS);
    const { movies } = await fetchPage(p, quality);
    calls++;
    pages.set(p, movies);
    return movies;
  };

  const first = await fetchPage(1, quality);
  calls++;
  pages.set(1, first.movies);
  const totalPages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  log(`  ${first.total} filmes no total (${totalPages} páginas)`);

  const lastTs = (b: YtsMovie[]) => {
    for (let i = b.length - 1; i >= 0; i--) {
      const t = uploadedAt(b[i]);
      if (t !== null) return t;
    }
    return null;
  };

  // menor página cujo último item é mais antigo que `end`
  let lo = 1;
  let hi = totalPages;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = await getPage(mid);
    const t = lastTs(b);
    if (b.length === 0 || (t !== null && t < end)) hi = mid;
    else lo = mid + 1;
  }
  log(`  período começa perto da página ${lo} (${calls} chamadas até aqui)`);

  const movies: YtsMovie[] = [];
  const seen = new Set<number>();
  let scanned = 0;
  for (let p = Math.max(1, lo - 1); scanned < MAX_PAGES; p++, scanned++) {
    const batch = await getPage(p);
    if (batch.length === 0) break;

    let allBeforeStart = true;
    for (const m of batch) {
      const ts = uploadedAt(m);
      if (ts === null) continue;
      if (ts >= start) allBeforeStart = false;
      if (ts >= start && ts < end && !seen.has(m.id)) {
        seen.add(m.id);
        movies.push(m);
      }
    }
    if (allBeforeStart) break;
    if (batch.length < PAGE_SIZE) break; // última página
  }
  return { movies, pages: calls };
}

// ---- cache em disco ---------------------------------------------------------

async function readCache(key: string, finalized: boolean) {
  try {
    const raw = JSON.parse(
      await readFile(join(CACHE_DIR, `${key}.json`), "utf8"),
    ) as {
      at: number;
      movies: YtsMovie[];
    };
    if (finalized || Date.now() - raw.at < CURRENT_TTL_MS) return raw.movies;
  } catch {
    /* sem cache */
  }
  return null;
}

async function writeCache(key: string, movies: YtsMovie[]) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    join(CACHE_DIR, `${key}.json`),
    JSON.stringify({ at: Date.now(), movies }),
  );
}

// ---- servidor ---------------------------------------------------------------

/** Filtro opcional pelo ano de lançamento (campo `year` do filme). */
function byRelease(movies: YtsMovie[], r: { from: number; to: number } | null) {
  return r ? movies.filter((m) => m.year >= r.from && m.year <= r.to) : movies;
}

const app = express();
const inflight = new Map<
  string,
  Promise<{ movies: YtsMovie[]; pages: number }>
>();

app.get("/", async (_req, res) => {
  try {
    res
      .type("html")
      .send(await readFile(new URL("./index.html", import.meta.url), "utf8"));
  } catch {
    res
      .status(500)
      .type("text")
      .send(
        "Arquivo index.html não encontrado. Coloque-o na mesma pasta do server.ts (src/).",
      );
  }
});

app.get("/movies", async (req, res) => {
  const year = Number(req.query.year);
  const monthRaw = req.query.month;
  const month =
    monthRaw === undefined || monthRaw === "" ? null : Number(monthRaw);
  const quality =
    typeof req.query.quality === "string" && req.query.quality
      ? req.query.quality
      : undefined;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res
      .status(400)
      .json({ error: "Informe year, ex.: /movies?year=2025&month=3" });
  }
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return res
      .status(400)
      .json({ error: "month deve ser de 1 a 12 (ou omitido para o ano todo)" });
  }

  // release (opcional): "2025", "2020-now", "2010-2019"... vazio ou "all" = sem filtro
  const releaseRaw =
    typeof req.query.release === "string"
      ? req.query.release.trim().toLowerCase()
      : "";
  let release: { from: number; to: number } | null = null;
  if (releaseRaw && releaseRaw !== "all") {
    const m = /^(\d{4})(?:-(\d{4}|now))?$/.exec(releaseRaw);
    const from = m ? Number(m[1]) : NaN;
    const to = !m
      ? NaN
      : m[2] === undefined
        ? from
        : m[2] === "now"
          ? new Date().getFullYear()
          : Number(m[2]);
    if (!m || from > to) {
      return res
        .status(400)
        .json({
          error:
            "release inválido. Use um ano (2025) ou faixa (2020-now, 2010-2019)",
        });
    }
    release = { from, to };
  }

  // Intervalo em UTC: [início do mês, início do mês seguinte). Sem month = ano inteiro.
  const start = Date.UTC(year, month ? month - 1 : 0, 1) / 1000;
  const end =
    (month ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1)) / 1000;

  const key = `${year}-${month ?? "all"}-${quality ?? "any"}`;
  const finalized = end * 1000 < Date.now(); // período já fechado nunca muda
  const cached = await readCache(key, finalized);
  if (cached) {
    const out = byRelease(cached, release);
    log(
      `${key}: cache (${cached.length} filmes, ${out.length} após filtro de lançamento)`,
    );
    return res.json({
      count: out.length,
      total_in_period: cached.length,
      release: releaseRaw || null,
      cached: true,
      movies: out,
    });
  }

  try {
    // se a mesma busca já está rodando (ex.: F5 na página), reaproveita
    let job = inflight.get(key);
    if (!job) {
      log(`${key}: buscando na API…`);
      job = collect(start, end, quality).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const { movies, pages } = await job;
    await writeCache(key, movies);
    const out = byRelease(movies, release);
    log(
      `${key}: ${movies.length} filmes, ${out.length} após filtro de lançamento, ${pages} chamadas`,
    );
    res.json({
      count: out.length,
      total_in_period: movies.length,
      release: releaseRaw || null,
      cached: false,
      pages_fetched: pages,
      movies: out,
    });
  } catch (err) {
    log(`${key}: ERRO ${(err as Error).message}`);
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, upstream: YTS_API }));

app.listen(PORT, () => {
  console.log(`yts-proxy: abra http://localhost:${PORT}/`);
  console.log(`API:       http://localhost:${PORT}/movies?year=2025&month=3`);
  console.log(`upstream:  ${YTS_API}`);
});
