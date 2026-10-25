# Vehicle API

API para controlar a utilização dos automóveis de uma empresa: cadastro de automóveis, cadastro de motoristas e registro de quem está usando cada carro.

Tecnologias: Node.js 24, NestJS (sobre Express), TypeScript, Prisma, PostgreSQL 16, Docker e Vitest.

## Regras de negócio

- Um automóvel só pode ser utilizado por um motorista por vez.
- Um motorista que já está utilizando um automóvel não pode utilizar outro ao mesmo tempo.
- As duas regras também valem para datas retroativas: uma utilização não pode se sobrepor a outra do mesmo automóvel ou do mesmo motorista. Além da API, o próprio banco de dados garante isso, mesmo com requisições simultâneas.
- A data de início e a de término não podem estar no futuro, e o término precisa ser depois do início. Se não forem enviadas, a API usa o horário atual.
- Automóvel ou motorista em uso não pode ser excluído. A exclusão é lógica: o registro some das consultas, mas o histórico de utilizações continua completo.
- A placa é única entre os automóveis cadastrados e aceita os formatos `ABC1234` e `ABC1D23` (minúsculas viram maiúsculas; espaços e hífen são removidos).

## Como rodar

**Você precisa de:** Docker (no Windows, o Docker Desktop aberto).

Na pasta do projeto:

```
cp .env.example .env
docker compose --profile app up --build -d
```

O primeiro comando cria o arquivo de configuração (não precisa editar nada). O segundo sobe o banco e a API; as tabelas são criadas automaticamente.

Para carregar dados de exemplo (4 automóveis, 3 motoristas e 2 utilizações), rode também o comando abaixo. Ele apaga os dados atuais antes de inserir os de exemplo:

```
docker compose --profile tools run --rm --build seed
```

**Como saber que funcionou:** abra http://localhost:3000/health. A resposta deve ser `{"status":"ok","database":"up"}`.

| O quê | Endereço |
|---|---|
| API | http://localhost:3000 |
| Documentação interativa (Swagger) | http://localhost:3000/docs |
| PostgreSQL | `localhost:5435` |

**Para desligar:** `docker compose --profile app --profile tools down`. Para apagar também os dados, acrescente `-v`.

Se a porta 3000 ou 5435 já estiver em uso, troque `PORT` ou `POSTGRES_PORT` no `.env` (no caso do banco, ajuste a porta também em `DATABASE_URL` e `TEST_DATABASE_URL`).

### Modo desenvolvimento

Banco no Docker e API no seu computador (precisa de Node.js 24). Se ainda não criou o `.env`, rode antes `cp .env.example .env`. Se a API do Docker estiver no ar, pare-a com `docker compose stop api`, porque as duas usam a porta 3000.

```
npm install
npm run db:generate
npm run docker:db
npm run db:deploy
npm run db:seed
npm run start:dev
```

`npm run db:seed` é opcional e apaga os dados atuais antes de inserir os de exemplo.

## Como testar

```
npm install
npm run db:generate
npm test
```

`npm test` roda os testes de unidade (regras de negócio, serviços, validações e tratamento de erros). Eles não precisam de banco.

Os testes de integração sobem a aplicação inteira e usam um PostgreSQL real. Se ainda não criou o `.env`, rode antes `cp .env.example .env`:

```
npm run docker:db
npm run test:e2e
```

Eles usam o banco `vehicle_api_test`, criado automaticamente, e apagam os dados dele a cada execução.

## Rotas

| Método e rota | O que faz |
|---|---|
| `POST /vehicles` | cadastra um automóvel: `{ "plate", "color", "brand" }` |
| `GET /vehicles` | lista os automóveis; filtros opcionais `?color=` e `?brand=` (valor exato, sem diferenciar maiúsculas) |
| `GET /vehicles/:id` | busca um automóvel |
| `PATCH /vehicles/:id` | altera placa, cor e/ou marca |
| `DELETE /vehicles/:id` | exclui um automóvel |
| `POST /drivers` | cadastra um motorista: `{ "name" }` |
| `GET /drivers` | lista os motoristas; filtro opcional `?name=` (parte do nome, sem diferenciar maiúsculas) |
| `GET /drivers/:id` | busca um motorista |
| `PATCH /drivers/:id` | altera o nome |
| `DELETE /drivers/:id` | exclui um motorista |
| `POST /usages` | inicia uma utilização: `{ "vehicleId", "driverId", "reason", "startedAt" }` (`startedAt` é opcional) |
| `PATCH /usages/:id/finish` | finaliza uma utilização: `{ "endedAt" }` (opcional) |
| `GET /usages` | lista as utilizações, da mais recente para a mais antiga, com o nome do motorista e os dados do automóvel |
| `GET /health` | verifica se a API e o banco estão no ar |

Datas usam o formato ISO 8601 com fuso horário, por exemplo `2026-10-25T08:00:00-03:00`.

### Exemplo

No Git Bash ou no Prompt de Comando (cmd). No PowerShell estes comandos não funcionam como estão; nesse caso, use a documentação interativa em http://localhost:3000/docs.

```
curl -X POST localhost:3000/vehicles -H "content-type: application/json" -d "{\"plate\":\"ABC1D23\",\"color\":\"Prata\",\"brand\":\"Fiat\"}"
curl -X POST localhost:3000/drivers -H "content-type: application/json" -d "{\"name\":\"Ana Souza\"}"
curl -X POST localhost:3000/usages -H "content-type: application/json" -d "{\"vehicleId\":\"<id do automóvel>\",\"driverId\":\"<id do motorista>\",\"reason\":\"Visita a cliente\"}"
curl -X PATCH localhost:3000/usages/<id da utilização>/finish
curl localhost:3000/usages
```

Tentar iniciar outra utilização do mesmo automóvel antes de finalizar a primeira devolve `409` com a mensagem "O automóvel já está em uso por um motorista."

### Respostas de erro

Os erros das rotas da API têm sempre o mesmo formato (só o `/health` responde `{"status":"error","database":"down"}` quando o banco está fora):

```json
{ "statusCode": 409, "error": "Conflict", "message": "O automóvel já está em uso por um motorista.", "errors": [{ "field": "vehicleId", "message": "O automóvel já está em uso por um motorista." }] }
```

| Código | Quando |
|---|---|
| `400` | dados em formato inválido (placa fora do padrão, campo vazio, data sem fuso, identificador inválido) |
| `404` | automóvel, motorista ou utilização não encontrado |
| `409` | regra de negócio violada: automóvel em uso, motorista já utilizando outro automóvel, placa repetida, utilização já finalizada |
| `422` | automóvel ou motorista inexistente ao iniciar uma utilização, data no futuro ou término antes do início |

## Estrutura

```
prisma/
  schema.prisma         tabelas
  migrations/           SQL versionado, incluindo as regras garantidas pelo banco
  seed-data.ts          dados de exemplo
src/
  main.ts               sobe a aplicação
  config/ database/     variáveis de ambiente e conexão com o banco
  common/               validação, formato de erros, segurança e health
  modules/
    vehicles/           automóveis
    drivers/            motoristas
    usages/             utilizações e as regras de uso (domain/)
test/                   testes de unidade (*.spec.ts) e de integração (*.e2e-spec.ts)
openapi.json            contrato da API
```

Cada módulo tem `controller` (recebe as requisições HTTP), `service` (regras e casos de uso), `repository` (consultas ao banco) e `dto/` (formato de entrada e de saída).

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL` | obrigatória | conexão com o PostgreSQL |
| `PORT` | `3000` | porta da API |
| `CORS_ORIGIN` | vazia (libera todas) | origens permitidas, separadas por vírgula |
| `API_KEY` | vazia | quando preenchida, toda rota exige o cabeçalho `x-api-key` (exceto `/health` e `/docs`) |
| `THROTTLE_LIMIT` e `THROTTLE_TTL_SECONDS` | `120` e `60` | limite de requisições por IP em cada janela de segundos |
| `TEST_DATABASE_URL` | vazia | banco usado pelos testes de integração |
| `SHADOW_DATABASE_URL` | vazia | banco auxiliar usado só pelo `prisma migrate dev` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | ver `.env.example` | criam o banco no Docker |
