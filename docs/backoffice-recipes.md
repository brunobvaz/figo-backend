# Receitas no backoffice

Gestão administrativa de receitas na collection MongoDB `recipes`, na base configurada por `MONGODB_URI` e `MONGODB_DB_NAME`. O modelo é registado no arranque do backend; não é necessário executar uma migração nem copiar documentos da app. Não existem receitas de demonstração inseridas automaticamente.

O contrato segue `mobile/src/data/mockRecipes.js`: `id`, `title`, `description`, `image`, `preparationMinutes`, `difficulty`, `categories`, `ingredients` e `seasonal`. Acrescenta `steps` (modo de preparação opcional e ordenado), `createdAt` e `updatedAt`. A base guarda também `createdBy` e `updatedBy`, referências a administradores, definidas pelo servidor e omitidas nas respostas.

## Campos

| Campo | Regra |
|---|---|
| `title` | Texto de 2 a 120 caracteres |
| `description` | Texto de 10 a 2000 caracteres |
| `image` | URL HTTPS sem credenciais, até 2048 caracteres; opcional, `null` por omissão |
| `preparationMinutes` | Inteiro entre 1 e 1440 |
| `difficulty` | `Fácil`, `Média` ou `Difícil` |
| `categories` | 1 a 10 textos distintos, até 40 caracteres cada; exemplos: Sopas, Vegetarianas, Doces |
| `ingredients` | 1 a 40 textos ordenados, até 160 caracteres cada; podem incluir quantidades |
| `seasonal` | Booleano, `false` por omissão; seleção editorial manual |
| `steps` | 0 a 20 passos ordenados, até 500 caracteres cada; `[]` por omissão |

Textos são aparados antes de gravar. Nomes de campos desconhecidos são rejeitados. Pedidos JSON de receitas admitem até 128 KB para acomodar ingredientes e passos em UTF-8. URLs externas são referências; o servidor não as transfere.

### Upload de fotografia

`POST` e `PATCH` também aceitam `multipart/form-data`, com um campo `data` contendo o JSON da receita e um ficheiro `image`. JPEG, PNG e WebP são aceites até 5 MB. O backend valida o conteúdo, rejeita imagens animadas, limita a resolução de entrada a 40 milhões de píxeis e converte para WebP até 1600 × 1600, respeitando as proporções e a orientação, sem metadados. A fotografia é gravada como binário na própria receita, sem depender do disco local do servidor.

As respostas incluem `hasUploadedImage`. Quando existe upload, `image` contém a rota administrativa `/api/v1/admin/recipes/:id/image?v=…`; o binário não é incluído nas respostas JSON. Um PATCH sem imagem preserva a fotografia. `image: null` remove-a; um novo ficheiro ou URL HTTPS substitui-a. Não é permitido enviar simultaneamente um ficheiro e um URL. Eliminar a receita elimina também o seu binário. No formulário, selecionar ou remover uma fotografia só persiste ao guardar; cancelar descarta a alteração.

## API administrativa

Todos os endpoints exigem uma sessão válida de `admins`, cookie `figo_admin`, header `X-Figo-Backoffice: 1` e origem autorizada em `BACKOFFICE_ORIGIN`. Utilizadores da app e os seus tokens não dão acesso. Respostas JSON usam o envelope habitual `{ success, data }`; o endpoint da fotografia devolve o binário.

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/admin/recipes` | Listagem paginada, categorias existentes e filtros |
| `GET /api/v1/admin/recipes/:id` | Receita completa |
| `GET /api/v1/admin/recipes/:id/image` | Fotografia WebP, apenas para administradores, com `Cache-Control: no-store`; 404 se não existir |
| `POST /api/v1/admin/recipes` | Criação, resposta 201 com a receita |
| `PATCH /api/v1/admin/recipes/:id` | Edição parcial; campos omitidos mantêm-se |
| `DELETE /api/v1/admin/recipes/:id` | Eliminação permanente; resposta 200 com `data: null` |

A listagem aceita `page` (default 1), `limit` (default 12, máximo 100), `search` (até 120 caracteres; título, descrição ou ingrediente), `category`, `difficulty`, `seasonal=true|false` e `quick=true|false`. `quick=true` seleciona receitas até 30 minutos, tal como o filtro “Rápidas” da app. A ordem é criação mais recente e depois `_id`, para estabilizar a paginação. `data` contém `items`, `pagination: { page, limit, total, pages }` e `categories` (categorias existentes em toda a coleção).

Validação inválida devolve 422 com `error.details` por campo. Receita inexistente ou eliminada devolve 404 `RECIPE_NOT_FOUND`. Na interface, eliminar exige confirmação e falhas de gravação preservam os valores preenchidos.

## Leitura pela app

`SeasonalRecipesScreen` consome a collection `recipes` através de uma API pública apenas de leitura, sem cookies administrativos. Todas as receitas criadas no backoffice ficam disponíveis; não existe um estado de rascunho/publicação. `seasonal` controla apenas o distintivo “Da época”, não a inclusão na lista “Todos”.

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/recipes` | `data: { items, pagination: { page, limit, total, pages } }` |
| `GET /api/v1/recipes/:id` | Receita completa com os mesmos campos públicos da listagem; 404 `RECIPE_NOT_FOUND` se já não existir; 422 se o identificador for inválido |
| `GET /api/v1/recipes/:id/image?v=…` | Fotografia WebP; 404 se a receita/fotografia foi eliminada ou a versão já foi substituída |

A listagem aceita `page` (default 1, máximo 100000), `limit` (default 20, máximo 100), `category` (correspondência exata sem distinguir maiúsculas) e `quick=true|false` (`true` limita a 30 minutos). Os filtros são aplicados antes da paginação. A ordem é criação mais recente e depois `_id`. As respostas incluem apenas os campos editoriais: `id`, `title`, `description`, `image`, `preparationMinutes`, `difficulty`, `categories`, `ingredients`, `seasonal` e `steps`; não incluem referências a administradores, binários nem metadados internos.

Para uploads, `image` aponta para `/api/v1/recipes/:id/image?v=…`. A app resolve esse caminho contra a origem de `EXPO_PUBLIC_API_BASE_URL`, permitindo usar o mesmo backend no simulador, dispositivo físico ou Render. URLs HTTPS externas mantêm-se. A listagem não é guardada em cache; a fotografia exige revalidação e admite ETag/304. O endpoint administrativo da fotografia mantém a proteção original.

O ecrã carrega 20 receitas de cada vez, mantém os filtros Todos/Rápidas/Vegetarianas/Doces/Sopas e atualiza ao regressar ao ecrã, voltar à app ou puxar para atualizar. Erros apresentam uma opção de repetir e não recorrem a mocks. As receitas carregadas mantêm-se se falhar a paginação ou uma atualização manual. `mockRecipes.js` deixou de alimentar a app; não são copiados dados de demonstração para MongoDB.

Os cards mostram fotografia, título, tempo, dificuldade e distintivo sazonal. O detalhe consulta a receita pelo identificador (com `Cache-Control: no-store`) e mostra descrição completa, categorias, ingredientes e passos numerados. A app trata receitas entretanto eliminadas e permite repetir falhas de ligação, sem apresentar uma cópia desatualizada recebida pela navegação.

Para usar num ambiente publicado, é necessário publicar este backend e atualizar a app com o respetivo `EXPO_PUBLIC_API_BASE_URL`.

## Verificação

No backend: `npm test -- tests/adminRecipes.test.js tests/publicRecipes.test.js tests/recipeServiceClient.test.js tests/recipesScreenClient.test.js tests/editorialClient.test.js`. A suíte pública verifica o CRUD administrativo refletido na leitura, paginação/filtros, fotografias e a rejeição de escrita pública. Os testes do cliente verificam pedidos, estados de erro, atualização, paginação e respostas fora de ordem.

No backoffice: `npm run test:e2e -- tests/recipes.spec.js` e `npm run build`. Os testes usam exclusivamente MongoDB temporário e contas fictícias. Para testar através do Worker: `npm run test:e2e:cloudflare -- tests/recipes.spec.js`.
