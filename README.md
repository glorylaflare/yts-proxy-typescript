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
2. A partir desse ponto, as páginas são varridas sequencialmente para frente, coletando os filmes dentro do intervalo `[início, fim)` do período, até encontrar uma página inteiramente anterior ao início do período (ou atingir o limite de segurança `MAX_PAGES`).
3. Pequenos desvios de ordenação entre itens vizinhos (que podem ocorrer na API real) são tolerados, pois o corte só acontece quando uma página inteira já está fora do intervalo.

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

O servidor é configurado inteiramente por variáveis de ambiente, todas opcionais:

| Variável        | Padrão                                                | Descrição                                                            |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `YTS_API`       | `https://movies-api.accel.li/api/v2/list_movies.json` | URL base da API do YTS usada como upstream.                          |
| `PORT`          | `8000`                                                | Porta em que o servidor HTTP escuta.                                 |
| `CACHE_DIR`     | `./.cache`                                            | Diretório onde os arquivos de cache (`.json`) são gravados.          |
| `MAX_PAGES`     | `400`                                                 | Número máximo de páginas varridas por consulta (trava de segurança). |
| `PAGE_DELAY_MS` | `250`                                                 | Atraso, em milissegundos, entre chamadas consecutivas ao upstream.   |

Exemplo de execução com configuração customizada:

```bash
# PowerShell
$env:PORT = "8080"; $env:CACHE_DIR = "./meu-cache"; npm start
```

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

Serve a página HTML do painel de consulta (`src/index.html`), que monta a URL de `/movies` a partir dos filtros selecionados.

## Cache

- Cada combinação de `year`, `month` e `quality` gera um arquivo próprio em `CACHE_DIR` (ex.: `2025-3-any.json`).
- Períodos encerrados (totalmente no passado) são tratados como definitivos e permanecem em cache indefinidamente.
- O período corrente (mês ou ano em andamento) é mantido em cache por 30 minutos, após os quais uma nova consulta ao upstream é disparada.
- O filtro de `release` **não** afeta a chave de cache: ele é aplicado em memória sobre os filmes já armazenados, permitindo reaproveitar o mesmo cache para diferentes faixas de lançamento.
- Requisições concorrentes para o mesmo período (por exemplo, duas abas abertas ao mesmo tempo) compartilham a mesma busca em andamento, evitando chamadas duplicadas ao upstream.

Para limpar o cache, remova o diretório configurado em `CACHE_DIR` (por padrão, `.cache/` na raiz do projeto).

## Testes

O projeto inclui um teste de integração (`test/run.ts`) que sobe um servidor HTTP simulando a API do YTS, inicia o proxy apontando para esse mock e valida:

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

```
.
├── src/
│   ├── server.ts      # Servidor Express: busca, cache e rotas da API
│   └── index.html     # Painel web para consultas
├── test/
│   └── run.ts         # Teste de integração com upstream simulado
├── .cache/            # Cache em disco (gerado em tempo de execução)
└── package.json
```

## Limitações conhecidas

- Depende da disponibilidade e do comportamento da API pública do YTS (ou de um espelho compatível configurado em `YTS_API`), que não é mantida por este projeto.
- A busca binária assume que o upstream mantém a ordenação por data de adição; grandes inconsistências de ordenação podem afetar o resultado.
- O cache é local, em arquivos; não há compartilhamento entre múltiplas instâncias do servidor.

## Licença

ISC. Veja o campo `license` em [package.json](package.json).
