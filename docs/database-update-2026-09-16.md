# Atualização de development e bench — 16/09/2026

## Resultado

As duas bases foram verificadas e adaptadas às alterações atuais de compras no chat, perfis, avaliações e fotografias de anúncios. A ligação configurada foi reutilizada com o nome de cada base explícito, sem alterar o `.env`.

| Base | Migração aplicada | Resultado |
| --- | --- | --- |
| development | `migrate-unified-profile.js` | Removido o campo obsoleto `roles` de uma conta. Guardada previamente uma cópia local apenas de `_id` e `roles`, fora do repositório. |
| development | `migrate-chat-transactions.js` | Coleção e índices confirmados; os índices atuais já existiam. |
| bench | `migrate-chat-transactions.js` | Criada a coleção `transactions` com os seis índices definidos pelo modelo, além de `_id`. |

O índice único `one_active_chat_purchase_v2` protege os estados `pending`, `accepted`, `buyer_confirmed`, `seller_confirmed` e `completed` nas duas bases. Os restantes índices suportam idempotência, histórico, avaliações, encomendas e vendas. Nenhum índice anterior foi removido.

As migrações de telefone opcional, ativação de anúncios e múltiplas fotografias já estavam aplicadas nas duas bases: índice `phone_optional_unique` presente e nenhum anúncio sem `is_active`, `images` ou `imagesRevision`. Não foi necessário reescrever esses documentos.

## Verificação dos dados

As contagens seguintes eram iguais antes e depois da execução:

| Base | Contas | Anúncios | Conversas | Mensagens | Transações |
| --- | ---: | ---: | ---: | ---: | ---: |
| development | 6 | 4 | 4 | 8 | 4 |
| bench | 18 | 33 | 26 | 88 | 0 |

- Todos os índices do modelo `Transaction` estão presentes e correspondem às definições atuais.
- Nenhuma conversa tem compras ativas duplicadas; nenhuma conta conserva `roles`.
- Development mantém quatro compras finalizadas e as quatro avaliações originais: duas comprador → vendedor e duas avaliações antigas no sentido inverso. Estas últimas permanecem no histórico e não contam para a reputação do vendedor.
- Não foram criadas compras, avaliações, mensagens ou confirmações artificiais. Os novos timestamps de confirmação só são preenchidos pelas ações reais dos participantes.
- Reputação e contadores de encomendas/vendas são calculados por agregação das transações; não exigem campos adicionais nos perfis. As alterações visuais não exigem migrações.

## Testes

116 testes passaram em MongoDB temporário, sem usar development ou bench:

```sh
npm test -- tests/chatTransactions.test.js tests/productPhotos.test.js tests/productActivation.test.js tests/auth.test.js
```

Incluem repetição das migrações, preservação de históricos, concorrência, confirmações de comprador/vendedor, avaliações e compatibilidade de contas e anúncios.

Esta operação atualizou as bases de dados. A publicação da versão correspondente da API e da aplicação é uma operação separada.
