# Eventos no backoffice

CRUD administrativo na collection MongoDB `events`, na base configurada no backend. Os campos seguem `mobile/src/data/mockEvents.js`, usado por `FairsEventsScreen` e `EventCard`. Não são importados mocks nem criados eventos automaticamente. A app continua a usar os dados de demonstração; este trabalho não altera o mobile nem cria endpoints públicos.

## Campos

| Campo | Regra |
|---|---|
| `title` | Obrigatório, 2–120 caracteres |
| `description` | Opcional, até 2000 caracteres; valor inicial vazio |
| `type` | `Feira`, `Mercado` ou `Evento` |
| `date` | Dia de calendário real em `YYYY-MM-DD`; guardado como string, sem conversão de fuso horário |
| `startTime` | Hora local obrigatória em `HH:mm` |
| `endTime` | Hora local opcional, posterior ao início no mesmo dia; `null` por omissão |
| `location` | Obrigatório, 2–160 caracteres |
| `distanceKm` | Referência opcional entre 0 e 20000 km; `null` por omissão. Não representa um cálculo por utilizador |
| `free` | Booleano, `false` por omissão. `true` significa entrada gratuita; `false` não implica entrada paga |
| `image` | URL HTTPS sem credenciais, até 2048 caracteres, ou `null`; pode ser substituída por upload |

O servidor acrescenta `id`, `createdAt`, `updatedAt` e `hasUploadedImage` nas respostas. `createdBy` e `updatedBy` são definidos pela sessão administrativa e não são expostos. Campos desconhecidos são rejeitados. O PATCH conserva os campos omitidos e valida o intervalo de horas considerando também os dados existentes. Datas passadas são permitidas para manter o histórico. Eventos que terminam noutro dia requerem uma futura extensão do contrato.

## API

Todas as rotas exigem a sessão de um administrador ativo, cookie `figo_admin`, header `X-Figo-Backoffice: 1` e origem autorizada. Tokens de utilizadores da app não permitem acesso. As respostas usam `Cache-Control: no-store`.

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/admin/events` | Lista paginada, ordenada por data, hora de início e ID |
| `POST /api/v1/admin/events` | Cria um evento; resposta 201 |
| `GET /api/v1/admin/events/:id` | Consulta um evento |
| `PATCH /api/v1/admin/events/:id` | Atualização parcial |
| `DELETE /api/v1/admin/events/:id` | Eliminação definitiva, incluindo a fotografia; `data: null` |
| `GET /api/v1/admin/events/:id/image` | Fotografia WebP protegida, ou 404 quando ausente |

A listagem aceita `search` (até 120 caracteres, pesquisa literal por título/descrição/local), `type`, `from` e `to` (datas inclusivas), `free=true|false`, `page` (inicial 1) e `limit` (inicial 12, máximo 100). Responde com `{ success: true, data: { items, pagination: { page, limit, total, pages } } }`.

Validações inválidas devolvem 422 com `error.details`, identificando o campo e a mensagem. IDs malformados devolvem 422; eventos inexistentes devolvem 404. Edições simultâneas incompatíveis devolvem 409, para evitar gravar um intervalo horário com valores desatualizados.

## Fotografias

POST/PATCH aceitam JSON ou `multipart/form-data` com `data` (JSON) e `image` (um ficheiro). O upload partilha a validação e otimização das receitas: JPEG, PNG ou WebP até 5 MB, máximo 40 milhões de píxeis na origem, convertido em WebP até 1600 × 1600 sem metadados e sem animação. É guardado no documento MongoDB, sem depender do disco do Render.

Quando há upload, `image` na resposta é uma rota administrativa versionada e `hasUploadedImage` é `true`; o binário nunca entra na listagem JSON. Omitir a imagem num PATCH preserva-a; `image: null` remove-a; uma nova fotografia ou URL substitui-a. Enviar URL e ficheiro juntos é rejeitado. Falhas de validação não alteram o documento. Cancelar a edição não grava alterações.

No futuro, a integração móvel deverá disponibilizar um contrato público próprio e decidir como calcular a distância a partir da localização. Não deve usar cookies ou rotas administrativas.

## Organização da interface

`src/pages/Events/` contém a página principal, `EventsToolbar`, `EventsTable`, `EventsEditor`, `EventsForm`, `DeleteEvent` e `eventConstants`. O formulário entrega `onSubmit(values, photo)`; o editor faz a gravação e controla `pending`.

Receitas e eventos utilizam os componentes comuns `Table`, `Toolbar`, `RowActions`, `PhotoField`, `EditorialImage` e `DeleteConfirmation`. Colunas, filtros, campos e endpoints continuam definidos nos componentes de cada contexto.

## Validação

- Backend: `npm test -- tests/adminEvents.test.js tests/adminRecipes.test.js tests/admin.test.js`.
- Interface local: `npm run test:e2e`.
- Worker local HTTPS: `npm run test:e2e:cloudflare -- tests/events.spec.js tests/recipes.spec.js`.
- Build: `npm run build`.

Os testes usam exclusivamente bases temporárias, contas e fotografias de teste. Nenhum destes comandos publica o backoffice ou escreve na base da aplicação.
