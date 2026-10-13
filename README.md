<img src="assets\images\image.webp" width="200" alt="Logo do YTS">

# yts-proxy

Proxy e painel web para consultar o catálogo da API pública do [YTS](https://yts.gg/api), permitindo filtrar filmes por **mês/ano de upload**, **ano (ou faixa de anos) de lançamento** e **qualidade**, com cache em disco para evitar varreduras repetidas no upstream.

## Sumário

- [yts-proxy](#yts-proxy)
  - [Sumário](#sumário)
  - [Visão geral](#visão-geral)
  - [Como funciona](#como-funciona)
  - [Requisitos](#requisitos)
  - [Instalação](#instalação)
  - [Configuração](#configuração)
  - [Uso](#uso)
  - [Referência da API](#referência-da-api)
    - [`GET /movies`](#get-movies)
    - [`GET /health`](#get-health)
    - [`GET /`](#get-)
  - [Cache](#cache)
  - [Testes](#testes)
  - [Estrutura do projeto](#estrutura-do-projeto)
  - [Limitações conhecidas](#limitações-conhecidas)
  - [Licença](#licença)

## Visão geral

A API pública do YTS não oferece um filtro direto por data de upload, apenas paginação ordenada por data de adição. Este projeto resolve esse problema mantendo um servidor Express que:

- Recebe pedidos de filmes de um período (ano ou ano+mês) de upload.
- Localiza o início do período na API do YTS com busca binária sobre as páginas, evitando varrer o catálogo inteiro desde a primeira página.
- Armazena o resultado de cada período em cache local (arquivo JSON), reaproveitando-o em requisições futuras.
- Expõe um filtro adicional, opcional, pelo ano (ou faixa de anos) de lançamento do filme, aplicado sobre os dados já armazenados em cache.
- Disponibiliza uma página HTML simples para realizar as consultas pelo navegador.

## Como funciona

A API do YTS retorna os filmes ordenados do mais recente para o mais antigo (`sort_by=date_added&order_by=desc`). Para localizar os filmes de um período sem precisar ler todas as páginas desde o início:

1. É feita uma busca binária sobre as páginas para encontrar a primeira página cujo último item já é mais antigo que o fim do período solicitado.
2. A partir desse ponto, as páginas são varridas sequencialmente para frente, coletando os filmes dentro do intervalo `[início, fim)` do período, até encontrar uma página inteiramente anterior ao início do período (ou atingir o limite de segurança `maxPages`, configurado em [src/config/app-config.ts](src/config/app-config.ts)).
3. Pequenos desvios de ordenação entre itens vizinhos (que podem ocorrer na API real) são tolerados, pois o corte só acontece quando uma página inteira já está fora do intervalo.

Essa lógica está isolada em [src/services/period-collector.ts](src/services/period-collector.ts) e é orquestrada, junto com o cache, por [src/services/movies-service.ts](src/services/movies-service.ts).

Períodos já encerrados (meses/anos completamente no passado) são definitivos e ficam em cache por tempo indeterminado. O período em andamento (mês ou ano corrente) usa um cache de curta duração (30 minutos), já que novos filmes podem ser adicionados a qualquer momento.

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- npm (instalado junto com o Node.js)

## Instalação

```bash
git clone <url-do-repositorio>
cd yts-filter-ts
npm install
```

## Configuração

O servidor não depende de variáveis de ambiente: toda a configuração é um objeto `AppConfig` explícito, definido em [src/config/app-config.ts](src/config/app-config.ts) e passado para `createApp()` ([src/http/app.ts](src/http/app.ts)).

| Campo         | Padrão                                                | Descrição                                                            |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `ytsApiBaseUrl` | `https://movies-api.accel.li/api/v2/list_movies.json` | URL base da API do YTS usada como upstream.                          |
| `port`          | `8000`                                                | Porta em que o servidor HTTP escuta.                                 |
| `cacheDir`      | `./.cache`                                            | Diretório onde os arquivos de cache (`.json`) são gravados.          |
| `maxPages`      | `400`                                                 | Número máximo de páginas varridas por consulta (trava de segurança). |
| `pageDelayMs`   | `250`                                                 | Atraso, em milissegundos, entre chamadas consecutivas ao upstream.   |

Para rodar com valores diferentes, edite `defaultConfig` em `src/config/app-config.ts`, ou, ao usar o projeto como módulo, monte a aplicação com uma configuração própria:

```ts
import { createApp } from "./src/http/app.ts";

const app = createApp({
  ytsApiBaseUrl: "https://movies-api.accel.li/api/v2/list_movies.json",
  port: 8080,
  cacheDir: "./meu-cache",
  maxPages: 400,
  pageDelayMs: 250,
});

app.listen(8080);
```

É exatamente esse mecanismo (injeção de configuração via `createApp`) que o teste de integração usa para apontar o servidor para uma API simulada, sem precisar de variáveis de ambiente.

## Uso

Inicie o servidor:

```bash
npm start
```

A saída no terminal indica os endereços disponíveis, por exemplo:

```
yts-proxy: abra http://localhost:8000/
API:       http://localhost:8000/movies?year=2025&month=3
upstream:  https://movies-api.accel.li/api/v2/list_movies.json
```

Abra `http://localhost:8000/` no navegador para usar o painel web, ou consulte a API diretamente (veja a seção seguinte).

## Referência da API

### `GET /movies`

Retorna os filmes de um período de upload, com filtro opcional de ano de lançamento e qualidade.

**Parâmetros de consulta**

| Parâmetro | Obrigatório | Formato                                                   | Descrição                                                              |
| --------- | ----------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `year`    | Sim         | Inteiro entre 2000 e 2100                                 | Ano de upload do filme.                                                |
| `month`   | Não         | Inteiro de 1 a 12                                         | Mês de upload. Quando omitido, considera o ano inteiro.                |
| `release` | Não         | Ano (`2025`) ou faixa (`2020-now`, `2010-2019`)           | Filtra pelo ano de lançamento do filme (campo `year` do catálogo YTS). |
| `quality` | Não         | Ex.: `480p`, `720p`, `1080p`, `1080p.x265`, `2160p`, `3D` | Filtra pela qualidade do release.                                      |

**Exemplos**

```
GET /movies?year=2025&month=3
GET /movies?year=2025&month=3&release=2020-now
GET /movies?year=2025&quality=1080p
```

**Resposta (200)**

```json
{
  "count": 42,
  "total_in_period": 58,
  "release": "2020-now",
  "cached": false,
  "pages_fetched": 12,
  "movies": [ ]
}
```

| Campo             | Descrição                                                                     |
| ----------------- | ----------------------------------------------------------------------------- |
| `count`           | Quantidade de filmes após aplicar o filtro de `release` (se informado).       |
| `total_in_period` | Quantidade de filmes no período de upload, antes do filtro de `release`.      |
| `release`         | Valor de `release` recebido, ou `null` quando não informado.                  |
| `cached`          | `true` quando o resultado veio do cache em disco.                             |
| `pages_fetched`   | Número de páginas consultadas no upstream (ausente quando `cached` é `true`). |
| `movies`          | Lista de filmes retornados pela API do YTS, já filtrada.                      |

**Erros (400)**

- `year` ausente ou fora do intervalo permitido.
- `month` fora do intervalo de 1 a 12.
- `release` em formato inválido.

**Erros (502)**

- Falha ao se comunicar com a API do YTS (indisponibilidade, timeout, resposta inesperada).

### `GET /health`

Verificação simples de disponibilidade.

```json
{ "ok": true, "upstream": "https://movies-api.accel.li/api/v2/list_movies.json" }
```

### `GET /`

Serve a página HTML do painel de consulta ([src/public/index.html](src/public/index.html)), que monta a URL de `/movies` a partir dos filtros selecionados. Os estáticos de [src/public](src/public) (CSS, imagens, etc.) ficam disponíveis diretamente pela raiz (ex.: `/styles.css`).

## Cache

- Cada combinação de `year`, `month` e `quality` gera um arquivo próprio em `cacheDir` (ex.: `2025-3-any.json`).
- Períodos encerrados (totalmente no passado) são tratados como definitivos e permanecem em cache indefinidamente.
- O período corrente (mês ou ano em andamento) é mantido em cache por 30 minutos, após os quais uma nova consulta ao upstream é disparada.
- O filtro de `release` **não** afeta a chave de cache: ele é aplicado em memória sobre os filmes já armazenados, permitindo reaproveitar o mesmo cache para diferentes faixas de lançamento.
- Requisições concorrentes para o mesmo período (por exemplo, duas abas abertas ao mesmo tempo) compartilham a mesma busca em andamento, evitando chamadas duplicadas ao upstream.

Para limpar o cache, remova o diretório configurado em `cacheDir` (por padrão, `.cache/` na raiz do projeto). A leitura/escrita do cache está isolada em [src/infra/movie-cache.ts](src/infra/movie-cache.ts).

## Testes

O projeto inclui um teste de integração (`test/run.ts`) que sobe um servidor HTTP simulando a API do YTS, monta a aplicação com `createApp()` apontando para esse mock (sem variáveis de ambiente) e valida:

- A página inicial responde e contém o formulário de busca.
- Consultas por ano/mês retornam a quantidade correta de filmes e respeitam o teto de chamadas ao upstream (validando a busca binária).
- Os filmes retornados pertencem de fato ao período solicitado.
- O filtro de `release` (ano/faixa de lançamento) funciona corretamente e não gera novas chamadas ao upstream quando os dados já estão em cache.
- Entradas inválidas (`release`, `month`, `year` ausente) retornam HTTP 400.
- Períodos já encerrados são servidos a partir do cache.

Para executar os testes:

```bash
npm test
```

## Estrutura do projeto

O código em `src/` é organizado por camada, para evitar concentrar todos os módulos TypeScript em uma única pasta:

```
.
├── src/
│   ├── server.ts              # Ponto de entrada: cria a app com a config padrão e escuta a porta
│   ├── config/
│   │   └── app-config.ts      # AppConfig e configuração padrão (sem variáveis de ambiente)
│   ├── domain/                # Tipos e regras de negócio puras, sem I/O
│   │   ├── types.ts           # Tipos compartilhados (YtsMovie, ReleaseYearRange, etc.)
│   │   ├── movie-filters.ts   # Filtro de lançamento e leitura de data de upload
│   │   └── period.ts          # Cálculo do intervalo e da chave de cache de um período
│   ├── infra/                 # Integrações externas (HTTP e disco)
│   │   ├── yts-client.ts      # Cliente HTTP da API do YTS, com retentativa
│   │   └── movie-cache.ts     # Cache em disco por período
│   ├── services/              # Orquestração dos casos de uso
│   │   ├── movies-service.ts     # Combina cache + coleta + filtro de lançamento
│   │   └── period-collector.ts   # Busca binária sobre as páginas do upstream
│   ├── http/                  # Camada HTTP (Express)
│   │   ├── app.ts              # Monta as rotas (/, /movies, /health) e os estáticos
│   │   └── query-validation.ts # Validação dos parâmetros de `/movies`
│   ├── shared/                 # Utilitários genéricos, sem regra de negócio
│   │   ├── logger.ts           # Log com horário local
│   │   └── async-utils.ts      # Utilitário `sleep`
│   └── public/                 # Estáticos servidos ao navegador
│       ├── index.html          # Painel web para consultas
│       └── styles.css          # Estilos do painel
├── test/
│   └── run.ts                  # Teste de integração com upstream simulado
├── .cache/                     # Cache em disco (gerado em tempo de execução)
└── package.json
```

## Limitações conhecidas

- Depende da disponibilidade e do comportamento da API pública do YTS (ou de um espelho compatível configurado em `YTS_API`), que não é mantida por este projeto.
- A busca binária assume que o upstream mantém a ordenação por data de adição; grandes inconsistências de ordenação podem afetar o resultado.
- O cache é local, em arquivos; não há compartilhamento entre múltiplas instâncias do servidor.

## Licença

ISC. Veja o campo `license` em [package.json](package.json).
