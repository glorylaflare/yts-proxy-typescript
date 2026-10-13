import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- mock da API do YTS ------------------------------------------------------
const NOW = Date.UTC(2026, 9, 12, 12) / 1000;
const SIX_H = 6 * 3600;
const TOTAL = 6000; // ~4 anos de histórico
const all = Array.from({ length: TOTAL }, (_, i) => {
  const ts = NOW - i * SIX_H;
  return {
    id: TOTAL - i,
    title: `Filme ${TOTAL - i}`,
    year: 2020 + (i % 7),
    date_uploaded_unix: ts,
    date_uploaded: new Date(ts * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
  };
});
// pequenos desvios de ordenação, como pode acontecer na API real
[all[49], all[50]] = [all[50], all[49]];
[all[120], all[121]] = [all[121], all[120]];

let upstreamCalls = 0;
const mock = http.createServer((req, res) => {
  upstreamCalls++;
  const u = new URL(req.url!, "http://x");
  const limit = Number(u.searchParams.get("limit") ?? 20);
  const page = Number(u.searchParams.get("page") ?? 1);
  const movies = all.slice((page - 1) * limit, page * limit);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      status: "ok",
      status_message: "Query was successful",
      data: {
        movie_count: all.length,
        limit,
        page_number: page,
        ...(movies.length ? { movies } : {}),
      },
    }),
  );
});
await new Promise<void>((r) => mock.listen(9101, r));

// ---- sobe o proxy apontando para o mock -----------------------------------------
process.env.YTS_API = "http://localhost:9101/api/v2/list_movies.json";
process.env.PORT = "9102";
process.env.PAGE_DELAY_MS = "0";
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), "yts-cache-"));
await import("../src/server.ts");
await new Promise((r) => setTimeout(r, 300));

// ---- asserts -------------------------------------------------------------------
const expected = (y: number, m: number | null) => {
  const s = Date.UTC(y, m ? m - 1 : 0, 1) / 1000;
  const e = m ? Date.UTC(y, m, 1) / 1000 : Date.UTC(y + 1, 0, 1) / 1000;
  return all.filter(
    (x) => x.date_uploaded_unix >= s && x.date_uploaded_unix < e,
  ).length;
};
const get = async (q: string) => {
  const r = await fetch(`http://localhost:9102/movies?${q}`);
  return { status: r.status, body: (await r.json()) as any };
};

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "OK  " : "FALHA"} ${name} ${extra}`);
  if (!ok) failed++;
};

const home = await fetch("http://localhost:9102/");
const homeHtml = await home.text();
check(
  "página inicial /",
  home.status === 200 &&
    homeHtml.includes("<form") &&
    homeHtml.includes("/movies?"),
);

// [ano, mês, teto de chamadas ao upstream]: meses antigos NÃO podem varrer tudo desde a página 1
for (const [y, m, maxCalls] of [
  [2026, 9, 25],
  [2026, 8, 25],
  [2026, 6, 30],
  [2025, 3, 30],
  [2023, 1, 30],
  [2026, null, 40],
  [2021, 12, 15],
] as const) {
  upstreamCalls = 0;
  const { status, body } = await get(`year=${y}${m ? `&month=${m}` : ""}`);
  const exp = expected(y, m);
  check(
    `year=${y} month=${m ?? "-"}`,
    status === 200 && body.count === exp && upstreamCalls <= maxCalls,
    `esperado=${exp} recebido=${body.count} chamadas_upstream=${upstreamCalls} (teto ${maxCalls})`,
  );
  const inRange = body.movies?.every((x: any) => {
    const d = new Date(x.date_uploaded_unix * 1000);
    return (
      d.getUTCFullYear() === y && (m === null || d.getUTCMonth() + 1 === m)
    );
  });
  check(`  todos dentro do período`, inRange === true);
}

// filtro opcional de lançamento (campo `year`), aplicado sobre o período de upload já em cache
const thisYear = new Date().getFullYear();
const expectedRel = (y: number, m: number, from: number, to: number) => {
  const s = Date.UTC(y, m - 1, 1) / 1000;
  const e = Date.UTC(y, m, 1) / 1000;
  return all.filter(
    (x) =>
      x.date_uploaded_unix >= s &&
      x.date_uploaded_unix < e &&
      x.year >= from &&
      x.year <= to,
  ).length;
};
for (const [rel, from, to] of [
  ["2023", 2023, 2023],
  ["2020-now", 2020, thisYear],
  ["2024-2025", 2024, 2025],
  ["2010-2019", 2010, 2019],
  ["all", 0, 9999],
] as const) {
  upstreamCalls = 0;
  const { status, body } = await get(`year=2025&month=3&release=${rel}`);
  const exp = expectedRel(2025, 3, from, to);
  const inRange = body.movies?.every(
    (x: any) => x.year >= from && x.year <= to,
  );
  check(
    `release=${rel} (março/2025)`,
    status === 200 &&
      body.count === exp &&
      body.total_in_period === expected(2025, 3) &&
      inRange === true &&
      upstreamCalls === 0,
    `esperado=${exp} recebido=${body.count} total_no_periodo=${body.total_in_period} chamadas_upstream=${upstreamCalls}`,
  );
}
for (const bad of ["abc", "2024-2022", "20x", "2020-", "1999-now-x"]) {
  check(
    `release inválido "${bad}"`,
    (await get(`year=2025&month=3&release=${bad}`)).status === 400,
  );
}

// cache: período fechado não deve bater de novo no upstream
upstreamCalls = 0;
const again = await get("year=2026&month=8");
check(
  "cache de mês fechado",
  again.body.cached === true && upstreamCalls === 0,
  `chamadas_upstream=${upstreamCalls}`,
);

check(
  "parâmetro inválido (month=13)",
  (await get("year=2026&month=13")).status === 400,
);
check("sem year", (await get("month=3")).status === 400);

mock.close();
console.log(failed ? `\n${failed} falha(s)` : "\nTudo certo");
process.exit(failed ? 1 : 0);
