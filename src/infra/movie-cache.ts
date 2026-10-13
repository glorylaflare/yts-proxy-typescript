import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { YtsMovie } from "../domain/types.ts";

interface CacheEntry {
  at: number;
  movies: YtsMovie[];
}

/** Cache de filmes por período, persistido em disco como um arquivo JSON por chave. */
export class MovieCache {
  constructor(
    private readonly cacheDir: string,
    private readonly currentPeriodTtlMs: number,
  ) {}

  async read(key: string, isPeriodFinalized: boolean): Promise<YtsMovie[] | null> {
    try {
      const entry = JSON.parse(await readFile(this.pathFor(key), "utf8")) as CacheEntry;
      const isFresh = isPeriodFinalized || Date.now() - entry.at < this.currentPeriodTtlMs;
      return isFresh ? entry.movies : null;
    } catch {
      return null;
    }
  }

  async write(key: string, movies: YtsMovie[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const entry: CacheEntry = { at: Date.now(), movies };
    await writeFile(this.pathFor(key), JSON.stringify(entry));
  }

  private pathFor(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }
}
