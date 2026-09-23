# Eventos no backoffice

CRUD administrativo na collection MongoDB `events`, na base configurada no backend. A app lê os mesmos documentos através da API pública de eventos, tanto na listagem como no detalhe e nas fotografias. Não são importados mocks nem criados eventos automaticamente.

## Campos

| Campo | Regra |
|---|---|
| `title` | Obrigatório, 2–120 caracteres |
| `description` | Opcional, até 2000 caracteres; valor inicial vazio |
| `type` | `Feira`, `Mercado` ou `Evento` |
| `date` | Dia de calendário real em `YYYY-MM-DD`; guardado como string, sem conversão de fuso horário |
| `startTime` | Hora local obrigatória em `HH:mm` |
| `endTime` | Hora local opcional, posterior ao início no mesmo dia; `null` por omissão |
| `location` | Localidade de escrita livre, obrigatória, 2–160 caracteres; preservada sem acrescentar concelho/freguesia ao texto |
| `municipalityCode` | Código CAOP do concelho (4 dígitos), obrigatório na criação |
| `parishCode` | Código CAOP da freguesia (6 caracteres), obrigatório na criação; deve pertencer ao concelho selecionado |
| `distanceKm` | Referência opcional entre 0 e 20000 km; `null` por omissão. Não representa um cálculo por utilizador |
| `free` | Booleano, `false` por omissão. `true` significa entrada gratuita; `false` não implica entrada paga |
| `image` | URL HTTPS sem credenciais, até 2048 caracteres, ou `null`; pode ser substituída por upload |

O servidor acrescenta `id`, `createdAt`, `updatedAt` e `hasUploadedImage` nas respostas. `createdBy` e `updatedBy` são definidos pela sessão administrativa e não são expostos. Campos desconhecidos são rejeitados. O PATCH conserva os campos omitidos e valida o intervalo de horas considerando também os dados existentes. Datas passadas são permitidas para manter o histórico. Eventos que terminam noutro dia requerem uma futura extensão do contrato.

## Localização e coordenadas

O formulário carrega o mesmo catálogo CAOP usado pela app na criação de anúncios. A escolha do concelho limita as freguesias disponíveis; mudar o concelho limpa a freguesia, preservando a localidade de escrita livre. Há estados de carregamento, erro com repetição e indicação de localização aproximada.

O backend valida os códigos contra a versão ativa de `referenceDatasets`/`municipalities`/`parishes` e reutiliza `resolveLocation`. Guarda:

- `address`: `municipalityCode`, `parishCode`, os nomes canónicos `municipality` e `parish`, `locality` (igual ao texto de `location`) e `version` do catálogo.
- `geo`: GeoJSON `{ type: 'Point', coordinates: [longitude, latitude] }`, com índice `2dsphere`.
- `locationSource: 'parish'`: ponto aproximado da freguesia, não a posição exata do recinto.

Estes campos são devolvidos nas APIs administrativa e pública, mas não podem ser enviados pelo cliente. O backend calcula-os; coordenadas fornecidas pelo cliente são rejeitadas. Se a freguesia não pertencer ao concelho ou não tiver um ponto válido, devolve 422 sem gravar. Se faltar o catálogo, devolve 503 `LOCATIONS_NOT_READY`; o ambiente deve ter o mesmo catálogo CAOP necessário aos anúncios (ver `npm run import:caop`).

Num PATCH, os dois códigos devem ser enviados juntos quando se altera a seleção. Editar apenas `location` atualiza também `address.locality` e preserva as coordenadas. Omitir a seleção preserva os dados geográficos existentes. O formulário envia sempre a seleção completa ao guardar.

Eventos anteriores continuam acessíveis, com `address`, `geo` e `locationSource` a `null` nas respostas até serem localizados. Ao abrir a edição, o administrador deve selecionar concelho/freguesia para guardar. Não se inferem coordenadas a partir de texto antigo nem é necessário reimportar eventos. A API continua a aceitar edições parciais de outros campos nesses eventos.

## API administrativa

Todas as rotas exigem a sessão de um administrador ativo, cookie `figo_admin`, header `X-Figo-Backoffice: 1` e origem autorizada. Tokens de utilizadores da app não permitem acesso. As respostas usam `Cache-Control: no-store`.

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/admin/events` | Lista paginada, ordenada por data, hora de início e ID |
| `POST /api/v1/admin/events` | Cria um evento; resposta 201 |
| `GET /api/v1/admin/events/:id` | Consulta um evento |
| `PATCH /api/v1/admin/events/:id` | Atualização parcial |
| `DELETE /api/v1/admin/events/:id` | Eliminação definitiva, incluindo a fotografia; `data: null` |
| `GET /api/v1/admin/events/:id/image` | Fotografia WebP protegida, ou 404 quando ausente |
| `GET /api/v1/admin/locations/municipalities` | Concelhos do catálogo ativo, por nome |
| `GET /api/v1/admin/locations/parishes?municipalityCode=0407` | Freguesias do concelho indicado, por nome |

A listagem aceita `search` (até 120 caracteres, pesquisa literal por título/descrição/local/concelho/freguesia), `type`, `from` e `to` (datas inclusivas), `free=true|false`, `page` (inicial 1) e `limit` (inicial 12, máximo 100). Responde com `{ success: true, data: { items, pagination: { page, limit, total, pages } } }`.

Validações inválidas devolvem 422 com `error.details`, identificando o campo e a mensagem. IDs malformados devolvem 422; eventos inexistentes devolvem 404. Edições simultâneas incompatíveis devolvem 409, para evitar gravar um intervalo horário com valores desatualizados.

## Fotografias

POST/PATCH aceitam JSON ou `multipart/form-data` com `data` (JSON) e `image` (um ficheiro). O upload partilha a validação e otimização das receitas: JPEG, PNG ou WebP até 5 MB, máximo 40 milhões de píxeis na origem, orientação EXIF corrigida e convertido em WebP de **1080 × 1350 px (4:5)**, com recorte central sem deformação, qualidade 82 e esforço de compressão 5, sem metadados e sem animação. Imagens pequenas são ampliadas para as dimensões exatas. É guardado no documento MongoDB, sem depender do disco do Render. O formulário antecipa o recorte antes de guardar. Esta regra aplica-se a novos uploads e substituições; as imagens já guardadas e URLs externos mantêm-se.

Quando há upload, `image` na resposta é uma rota administrativa versionada e `hasUploadedImage` é `true`; o binário nunca entra na listagem JSON. Omitir a imagem num PATCH preserva-a; `image: null` remove-a; uma nova fotografia ou URL substitui-a. Enviar URL e ficheiro juntos é rejeitado. Falhas de validação não alteram o documento. Cancelar a edição não grava alterações.

## API pública e aplicação mobile

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/events` | Lista paginada, ordenada por data, hora de início e ID |
| `GET /api/v1/events/:id` | Detalhe atual, ou 404 se o evento foi eliminado |
| `GET /api/v1/events/:id/image?v=<versão>` | Fotografia WebP carregada no backoffice, sem sessão administrativa |

A listagem aceita `type`, `from` e `to` (dias inclusivos), `free=true|false`, `page` (inicial 1) e `limit` (inicial 20, máximo 100). Os filtros são aplicados antes da paginação. Responde com `{ success: true, data: { items, pagination: { page, limit, total, pages } } }`. A lista sem filtros inclui todos os eventos guardados, incluindo o histórico. Parâmetros e identificadores inválidos devolvem 422; intervalos invertidos também são rejeitados.

Lista e detalhe expõem `id`, título, descrição, tipo, data, horário, local, `address`, `geo`, `locationSource`, distância de referência, entrada gratuita e URL da imagem. Não incluem auditoria, campos internos ou o binário da fotografia. Não há rotas públicas de escrita. As rotas administrativas mantêm as suas proteções.

Lista e detalhe usam `Cache-Control: no-store`. Fotografias usam a rota pública versionada e `Cache-Control: public, max-age=0, must-revalidate`, com ETag. Uma versão substituída, fotografia removida ou evento eliminado devolve 404. URLs externos HTTPS mantêm-se como foram configurados.

`FairsEventsScreen` usa `editorialService` → `eventService` → API, com páginas de 20 eventos, carregamento, estado vazio, erro recuperável, atualização manual e nova consulta ao regressar ao ecrã/primeiro plano. Todos, Esta semana (segunda a domingo), Este mês, Feiras e Mercados são traduzidos em filtros da API, preservando os dias do calendário local sem conversão para UTC. Ao tocar num card, `EventDetailScreen` recebe `eventId` e consulta o detalhe atual; eventos eliminados apresentam “Evento indisponível”.

Os mocks ficam apenas como fixtures de teste; uma falha de ligação nunca é substituída por eventos fictícios. `distanceKm` continua a ser o valor editorial do backoffice, apresentado como “Distância de referência”. As coordenadas guardadas ficam disponíveis para uma futura implementação de cálculo de distância por utilizador; essa funcionalidade ainda não é aplicada na app.

Para disponibilizar a integração num ambiente publicado, atualizar primeiro o backend e depois a app, configurando `EXPO_PUBLIC_API_BASE_URL` para o mesmo backend utilizado pelo backoffice. Não é necessária migração nem reintroduzir eventos existentes.

## Organização da interface

`src/pages/Events/` contém a página principal, `EventsToolbar`, `EventsTable`, `EventsEditor`, `EventsForm`, `DeleteEvent` e `eventConstants`. O formulário entrega `onSubmit(values, photo)`; o editor faz a gravação e controla `pending`.

Receitas e eventos utilizam os componentes comuns `Table`, `Toolbar`, `RowActions`, `PhotoField`, `EditorialImage` e `DeleteConfirmation`. `AddressFields` controla a seleção dependente de concelho/freguesia dos eventos, cancelando pedidos de freguesias de seleções anteriores. Colunas, filtros, campos e endpoints continuam definidos nos componentes de cada contexto.

## Validação

- Backend e mobile: `npm test -- tests/publicEvents.test.js tests/adminEvents.test.js tests/eventServiceClient.test.js tests/eventsScreenClient.test.js tests/editorialClient.test.js`.
- Interface local: `npm run test:e2e`.
- Worker local HTTPS: `npm run test:e2e:cloudflare -- tests/events.spec.js tests/recipes.spec.js`.
- Build: `npm run build`.

Os testes usam exclusivamente bases temporárias, contas e fotografias de teste. Nenhum destes comandos publica o backoffice ou escreve na base da aplicação.
