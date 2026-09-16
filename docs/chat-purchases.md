# Compras no chat

O fluxo usa a conversa existente: proposta (comprador) → aceite (vendedor) → confirmação do acordo (comprador) → confirmação do acordo (vendedor) → conclusão/receção do produto (comprador) → avaliação do vendedor (comprador). O pagamento e a entrega são combinados entre as pessoas; a API não processa nem confirma pagamentos.

«Confirmar compra» e «Confirmar venda» registam que ambos concordam com os detalhes finais combinados no chat. «Marcar como concluída» só fica disponível depois dessas duas confirmações, para o comprador assinalar que recebeu o produto e tratou diretamente do pagamento.

## Publicar

No diretório `backend`, com o `.env` da base de destino configurado:

```sh
npm run migrate:chat-transactions
npm start
```

Publicar também o mobile atualizado. Executar a migração mesmo que a primeira versão de compras já tenha sido instalada: acrescenta o índice único `one_active_chat_purchase_v2`, que inclui os dois novos estados, e índices para os históricos. É repetível e mantém o índice antigo, evitando uma janela sem proteção contra duplicados. Não altera mensagens nem inventa confirmações para transações antigas. O arranque da API espera pela inicialização do modelo. Não instalar novas dependências nem executar `syncIndexes` para esta alteração.

Compras antigas ainda aceites passam pelas duas novas confirmações. Compras já concluídas podem ser avaliadas pelo comprador sem repetir a conclusão. Reviews antigas vendedor → comprador conservam autores/destinatários originais e ficam no histórico, mas não contam para a classificação de vendedor. Transações antigas já finalizadas continuam finalizadas e contam como uma encomenda/venda; não aceitam uma segunda review.

## Dados e decisões

- Uma transaction referencia conversation/product/buyer/seller e guarda quantidade, título, unidade e snapshots de preço. Preços são números em euros, tal como os produtos; o total é arredondado a cêntimos. Alterar, desativar ou eliminar um produto não altera uma compra existente. Novas propostas exigem produto ativo e contas ativas.
- `pending`, `accepted`, `buyer_confirmed`, `seller_confirmed` e `completed` ocupam a compra ativa da conversa. O índice parcial único impede duas compras ativas, mesmo com pedidos concorrentes de instâncias diferentes. Recusa ou avaliação permite nova proposta.
- Só existem comandos explícitos: `pending → accepted/declined`, `accepted → buyer_confirmed → seller_confirmed → completed → reviewed`. `cancelled` fica reservado no modelo, sem ação pública nesta fase.
- `buyerAgreementConfirmedAt` e `sellerAgreementConfirmedAt` guardam as confirmações do acordo separadamente. `completedAt` e o campo compatível `buyerConfirmedAt` continuam a identificar a conclusão/receção pelo comprador.
- A review é um subdocumento de `Transaction.reviews`, com ID, reviewer, reviewedUser, rating, comment, clientId e createdAt. A resposta inclui também transactionId. Isto publica review/estado/timestamp numa única gravação MongoDB, sem exigir replica set nem criar outro sistema de avaliações. Novas avaliações são exclusivamente buyer → seller, depois de completed.
- Escritas usam os bloqueios de conta existentes e filtros condicionais de estado/autor no MongoDB. Cada proposta tem uma chave idempotente; reviews só repetem a mesma operação com a mesma chave e conteúdo. Aceitar/concluir repetidamente preserva timestamps. Não há endpoint de alteração arbitrária de estado.
- O mobile guarda propostas por confirmar no AsyncStorage por conta/conversa. Reutiliza a chave após timeout, erro 5xx ou restart, e reconcilia com a resposta da API. Se o preço mudar antes do envio, exige novo toque após mostrar o preço atualizado.
- Cada compra tem um único cartão, com chave estável e numeração por ordem de criação, colocado na data da sua última etapa. Os detalhes ficam recolhidos e mostram o percurso com as datas reais e a avaliação ao expandir. A ação necessária na compra ativa permanece visível, com indicação de quem deve agir. Pendente/avaliação pendente usa âmbar, acordo em curso roxo, finalizada verde e recusada/cancelada cinzento, sempre com texto e ícone. Não são criadas mensagens artificiais. A revisão numérica impede polls antigos de reverter o estado. A paginação revela os cartões antigos sem alterar a numeração; o último cartão permanece acessível mesmo quando há muitas mensagens posteriores.
- «Comprar novamente» aparece apenas ao comprador na última compra finalizada e avaliada, quando a API permite uma nova proposta. Abre uma proposta na mesma conversa, pré-preenchida com a quantidade anterior e o preço atual do produto, para rever antes de enviar. Não repete automaticamente a compra. Uma proposta com envio incerto continua a recuperar o seu pedido original, preservando preço, quantidade e chave. A ação substitui «Propor compra», sem duplicar botões. O produto e as contas têm de continuar ativos e não pode existir uma compra por terminar, incluindo avaliação pendente.
- A lista de conversas inclui a última atividade de compra. A sincronização reutiliza o polling atual; não foram acrescentadas notificações push para eventos de compra.
- A reputação do vendedor é calculada por agregação das reviews válidas buyer → seller, sem contadores duplicados que possam divergir. Aparece no perfil próprio, no perfil público do vendedor, nos cards de produtores e ao comprador no chat. «Ver avaliações» nos dois perfis abre uma lista paginada, com estrelas, avatar, nome do comprador, data e comentário opcional, ordenada da mais recente para a mais antiga. O avatar e o nome abrem o perfil público do autor, preservando o regresso ao perfil anterior. A resposta inclui ID público e avatar apenas para autores ativos; sem fotografia, mostram-se as iniciais. A lista usa o mesmo filtro da classificação e não publica IDs da compra/conversa, valores ou contactos. Contas indisponíveis têm nome genérico; desde `deletion_pending`, também se oculta o comentário, sem alterar a classificação.
- A página inicial atualiza a listagem ao ganhar foco e ao regressar do background, partilhando pedidos simultâneos. Os cards apresentam classificação, número de avaliações e vendas finalizadas. Usam a última listagem pública separada da cache de pesquisa/detalhes, para não recuperar informação antiga de outro anúncio do mesmo vendedor. Uma falha mantém a última listagem e permite tentar novamente.
- Cada transação concluída e avaliada (`reviewed`, com completedAt/reviewedAt) conta uma encomenda para o comprador e uma venda para o vendedor, independentemente da quantidade. A conclusão sem avaliação ainda não aumenta estes contadores. Repetir uma avaliação não aumenta contagens.
- «As minhas encomendas» e «As minhas vendas» apresentam os dados reais da conta autenticada, incluindo operações em curso e recusadas, com paginação e acesso ao chat. O perfil público mostra reputação, avaliações e total agregado de vendas; históricos de compras/vendas são privados. O perfil do vendedor continua disponível mesmo sem anúncios ativos.
- O perfil público apresenta fotografia, localidade, data de entrada e um cartão com classificação, estrelas e vendas finalizadas. A faixa informativa usa «Avaliações de compradores», sem atribuir certificações de qualidade. Mostra até três anúncios recentes; «Ver todos» abre a pesquisa filtrada pelo vendedor numa página própria, com paginação e regresso ao perfil. O menu do perfil permite consultar avaliações ou todos os produtos.
- Conversas com contas indisponíveis mantêm a política existente de leitura. A eliminação de conta remove o texto livre das reviews sobre/por essa conta e o título do vendedor, preservando IDs técnicos, valores e classificação; a API redige esses campos desde `deletion_pending`.

## API

As operações de compra e os históricos pessoais exigem autenticação. A conversa e a transaction são verificadas em conjunto. O perfil do vendedor e as avaliações recebidas são públicos para contas ativas.

| Método | Caminho (prefixo `/api/v1`) | Autor |
| --- | --- | --- |
| POST | `/conversations/:id/transactions` | Comprador |
| POST | `/conversations/:id/transactions/:transactionId/accept` | Vendedor |
| POST | `/conversations/:id/transactions/:transactionId/decline` | Vendedor |
| POST | `/conversations/:id/transactions/:transactionId/confirm-buyer` | Comprador, após accepted |
| POST | `/conversations/:id/transactions/:transactionId/confirm-seller` | Vendedor, após buyer_confirmed |
| POST | `/conversations/:id/transactions/:transactionId/complete` | Comprador |
| POST | `/conversations/:id/transactions/:transactionId/review` | Comprador, após completed |
| GET | `/users/me/reputation` | Utilizador autenticado |
| GET | `/users/me/commerce` | Utilizador autenticado; reputação, encomendas e vendas finalizadas |
| GET | `/users/me/transactions?role=buyer\|seller&page=1&limit=20` | Histórico da conta autenticada |
| GET | `/users/:id/profile` | Perfil público de uma conta ativa; reputação e vendas |
| GET | `/users/:id/reviews?page=1&limit=20` | Avaliações públicas buyer → seller de compras finalizadas; limite máximo 50 |

Proposta: `{ quantity, expectedUnitPrice, clientId }`. Review: `{ rating, comment?, clientId }`. As restantes ações recebem `{}`. As respostas de detalhe/mensagens da conversa incluem transactions, buyerId/sellerId, sellerReputation e disponibilidade para propor.

## Verificação

```sh
# backend: inclui MongoDB temporário, sem utilizar a base configurada no .env
npm test

# mobile: valida JSX, módulos e bundles nativos
CI=1 EXPO_NO_TELEMETRY=1 npx --no-install expo export --platform ios --platform android --output-dir /tmp/figo-chat-purchase-export
```

Não existem scripts de lint ou typecheck neste projeto JavaScript. Os testes cobrem permissões, estados, idempotência/concorrência, preço alterado, produto indisponível/eliminado, reputação, reconstrução do histórico e controlos dos cards/sheets.

Validação manual em dois utilizadores: propor 2 unidades; aceitar como vendedor; escolher «Ainda não» e verificar que nada mudou; confirmar compra como comprador; confirmar venda como vendedor; concluir como comprador; avaliar o vendedor como comprador. Reabrir ambos os chats e verificar os mesmos eventos sem CTAs repetidos. Confirmar uma encomenda e uma venda nos perfis, a classificação pública do vendedor e os históricos privados. Confirmar também teclado, tamanho de letra ampliado e leitor de ecrã num dispositivo.

Na apresentação agrupada: expandir/recolher uma compra finalizada e consultar etapas e comentário; abrir «Comprar novamente», ajustar a quantidade e cancelar, confirmando que não foi criada uma compra. Depois de enviar e finalizar uma nova compra num ambiente de teste, verificar a numeração, os dois percursos independentes e o botão de repetição apenas na última compra. Carregar mensagens anteriores sem mudar a numeração nem duplicar cartões. Confirmar que produto indisponível, contas inativas e avaliação pendente impedem uma nova proposta.

## Ficheiros desta implementação

Backend:

- `src/models/Transaction.js`: dados, snapshots, reviews e índices.
- `src/models/Product.js`: inclui os totais calculados do vendedor na resposta pública sem os persistir no produto.
- `src/services/transactionService.js`: comandos, autorização, idempotência e reputação.
- `src/services/chatService.js`: estado de compra no histórico e resumos.
- `src/services/productService.js`, `src/services/userService.js`: perfis e vendedores com avaliações/vendas reais.
- `src/services/accountService.js`: limpeza dos novos campos na eliminação de conta.
- `src/routes/chatRoutes.js`, `src/routes/userRoutes.js`: endpoints autenticados.
- `src/server.js`: espera pela inicialização dos índices antes de servir pedidos.
- `scripts/migrate-chat-transactions.js`, `package.json`: migração repetível.
- `tests/chatTransactions.test.js`, `tests/chatTransactionsClient.test.js`, `tests/chatPurchaseComponents.test.js`: integração, histórico e controlos JSX.
- `README.md`, `docs/account-lifecycle.md`, `docs/chat-purchases.md`: operação e decisões.

Mobile:

- `src/screens/chat/ChatScreen.js`: cards no histórico e ações por participante.
- `src/components/chat/TransactionCard.js`, `src/components/chat/PurchaseSheet.js`: estados visuais, confirmação, quantidade e estrelas.
- `src/hooks/useChatPurchase.js`: pedidos, bloqueio de double tap e recuperação de propostas.
- `src/utils/chatTransactions.js`: reconstrução do histórico e proteção contra respostas antigas.
- `src/services/chatService.js`: chamadas à API de compras/reputação.
- `src/screens/profile/ProfileScreen.js`: reputação de vendedor, contadores e acessos aos históricos.
- `src/screens/seller/SellerProfileScreen.js`: classificação e vendas públicas, mesmo sem anúncios.
- `src/screens/orders/OrdersScreen.js`, `src/services/orderService.js`, `src/navigation/MainNavigator.js`: históricos reais de encomendas/vendas.
- `src/components/product/ProducerCard.js`, `src/components/product/ProductList.js`: reputação real e estado vazio do perfil.
- `src/context/ProductsContext.js`, `src/screens/home/HomeScreen.js`: atualização da listagem pública e dos cards de produtores ao regressar à página inicial.
- `src/components/reviews/ReviewsSheet.js`: consulta paginada de avaliações nos perfis, com carregamento, repetição de pedidos falhados e estado vazio.
