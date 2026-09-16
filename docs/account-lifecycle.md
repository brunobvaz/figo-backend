# Ciclo de vida da conta

## Comportamento

- `active`: acesso normal.
- `deactivated`: pausa voluntária; mantém dados e mensagens, oculta perfil/anúncios, impede contactos e novas notificações. Todas as sessões e tokens de recuperação anteriores são invalidados.
- `suspended`: sanção da plataforma; não permite reativação autónoma.
- `deletion_pending`: pedido definitivo aceite, indisponível imediatamente; limpeza repetida pelo servidor se necessário.
- `deleted`: dados pessoais removidos da base operacional, imagens e anúncios removidos. Registo genérico com ID técnico para manter mensagens escritas pelos outros participantes.

Reativar exige email, palavra-passe e confirmação explícita. Também invalida sessões antigas, cobrindo falhas parciais da desativação. Todos os anúncios existentes ficam `is_active: false`; o estado esgotado/removido mantém-se. É possível recuperar a palavra-passe ou eliminar uma conta desativada sem a reativar.

Os ecrãs de encomendas e vendas usam as transações reais do chat descritas em [chat-purchases.md](chat-purchases.md): não processam pagamentos e não bloqueiam a eliminação da conta. Durante indisponibilidade, as ações da compra ficam suspensas. A eliminação remove texto livre das avaliações sobre/por essa conta e o título de produto do vendedor; conserva apenas os dados técnicos da transação e classificações. O perfil público fica indisponível e os históricos privados da outra parte mantêm as referências técnicas com identidade genérica.

## API

Todos os pedidos estão em `/api/v1/auth/account`, com limitação de tentativas. As ações recebem `{ email, password, confirm: true }`; a palavra-passe é verificada no servidor, sem depender da sessão corrente.

- `POST /deactivate`
- `POST /reactivate`: devolve nova sessão apenas após reativação explícita.
- `POST /deletion-receipt`: emite comprovativo limitado à consulta, antes de pedir a remoção. Não altera a conta.
- `POST /delete`: devolve `deleted` (200) ou `deletion_pending` (202), ID da conta e comprovativo.
- `POST /deletion-status`: recebe `{ receipt }`; só devolve estado. Não dá acesso à conta. Validade de 30 dias.

O mobile guarda o comprovativo em SecureStore antes da eliminação, para recuperar de respostas perdidas. Permite consultar o estado e continuar para o início durante a limpeza. O comprovativo é removido do dispositivo quando o utilizador fecha o resultado concluído.

## Limpeza e concorrência

O servidor inicia `startAccountDeletionWorker` no arranque. O worker procura pedidos incompletos a cada 10 segundos, com repetição após 30 segundos em caso de falha. Também recupera contas marcadas como pendentes cujo job não chegou a ser gravado.

A limpeza é idempotente: invalida sessões, tokens e dispositivos push; elimina jobs de notificações; substitui apenas os textos enviados por “Mensagem removida”; remove originais e variantes das imagens; elimina todos os anúncios, incluindo soft deletes; substitui o documento User completo, incluindo campos legados. Falhas em ficheiros impedem a marcação como concluído. Os registos operacionais concluídos expiram após 30 dias.

Leases no MongoDB (`AccountLock`) ordenam escritas de contas, conversas e autenticação entre processos. Não exigem replica set. O bloqueio tem expiração, renovação e tempo de espera limitado. Não escrever diretamente nestas coleções fora dos serviços protegidos. Uma interrupção prolongada da ligação ao MongoDB continua a exigir monitorização operacional; as leases não são transações distribuídas.

As consultas públicas filtram proprietários ativos antes de paginar/contar. URLs das imagens também verificam o estado do proprietário. Conversas de contas indisponíveis são apenas de leitura. O mobile redige igualmente páginas antigas que já estejam em memória.

## Limites operacionais

A limpeza descrita abrange os dados na base em utilização e os ficheiros no armazenamento configurado da API. Não apaga cópias já descarregadas, capturas, emails e notificações já entregues, backups nem registos externos. Definir e aplicar os prazos destes sistemas antes da publicação; num restauro de backup, reaplicar eliminações antes de voltar a servir dados. A minuta de privacidade mantém esta distinção explícita.

Os favoritos são locais por conta. A eliminação espera pelas gravações anteriores e impede novas gravações da conta eliminada. Noutros dispositivos, a limpeza ocorre quando recebem a indicação de eliminação; dispositivos offline não podem ser limpos à distância.

Os índices novos são criados pelo Mongoose como os restantes modelos do projeto (`AccountLock`, `AccountDeletion`). Publicar backend e mobile em conjunto; o backend antigo não tem estas operações. Não foi feita qualquer eliminação em contas reais durante o desenvolvimento.

## Verificação

`npm test` no backend executa testes numa MongoDB temporária. `tests/accountLifecycle.test.js` cobre credenciais, estados, acesso público, sessões antigas, preservação de mensagens alheias, originais/variantes, repetição após falha, recuperação de jobs e envios concorrentes. Testes do cliente cobrem filas de favoritos e redação do histórico em memória.

No mobile: `CI=1 EXPO_OFFLINE=1 npx expo export --platform ios --platform android --output-dir /tmp/figo-account-lifecycle --max-workers 2`.
