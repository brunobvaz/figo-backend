# DaTerra API — fase 1

Backend de autenticação e autorização da aplicação DaTerra, construído com Node.js, Express, MongoDB/Mongoose e ES Modules.

## Estrutura

```text
src/
  config/       ambiente e ligação MongoDB
  controllers/  camada HTTP
  middleware/   autenticação, autorização, validação, limites e erros
  models/       User, Session, EmailOtp e OneTimeToken
  routes/       endpoints versionados
  services/     regras de autenticação, tokens e email
  validators/   schemas Zod
  utils/        erros, normalização e criptografia auxiliar
  app.js        configuração Express sem abrir uma porta
  server.js     ligação à base de dados e arranque HTTP
tests/          testes de integração numa base MongoDB em memória
uploads/avatars fotografias de perfil (apenas o nome fica no MongoDB)
uploads/products imagens de produtos (apenas o nome fica no MongoDB)
```

## Instalação

Requer Node.js 20 ou superior.

```bash
cd backend
npm install
cp .env.example .env
```

Preenche `MONGODB_URI` com a connection string do Atlas, terminando em `/development`. Cria segredos independentes e aleatórios para os dois JWTs; por exemplo, com `openssl rand -hex 32`. O ficheiro `.env` está ignorado pelo Git.

## Configuração

| Variável | Descrição | Exemplo |
|---|---|---|
| `NODE_ENV` | Ambiente | `development` |
| `PORT` | Porta HTTP | `3000` |
| `MONGODB_URI` | Ligação MongoDB e base | `mongodb+srv://.../development` |
| `MONGODB_DB_NAME` | Nome explícito da base MongoDB | `development` |
| `JWT_ACCESS_SECRET` | Segredo do access token, mínimo 32 caracteres | segredo aleatório |
| `JWT_ACCESS_EXPIRES_IN` | Duração do access token | `15m` |
| `JWT_REFRESH_SECRET` | Segredo independente do refresh token | segredo aleatório |
| `JWT_REFRESH_EXPIRES_IN` | Duração do refresh token | `30d` |
| `CORS_ORIGIN` | Origens permitidas, separadas por vírgula | `http://localhost:8081` |
| `JSON_BODY_LIMIT` | Limite do JSON | `20kb` |
| `*_RATE_LIMIT_*` | Janelas e limites de pedidos | ver `.env.example` |
| `PASSWORD_RESET_EXPIRES_IN_MINUTES` | Validade do reset | `30` |
| `EMAIL_VERIFICATION_EXPIRES_IN_MINUTES` | Validade da verificação | `1440` |
| `EMAIL_OTP_SECRET` | Segredo independente para HMAC dos códigos | segredo aleatório |
| `EMAIL_OTP_EXPIRES_IN_MINUTES` | Validade do OTP | `10` |
| `EMAIL_OTP_MAX_ATTEMPTS` | Tentativas por desafio | `5` |
| `EMAIL_OTP_RESEND_COOLDOWN_SECONDS` | Espera antes de reenviar | `60` |
| `APP_URL` | URL usada nos links de desenvolvimento | `http://localhost:8081` |

## Execução

```bash
npm run dev
npm start
npm test
```

Em desenvolvimento, os links de reset e verificação são escritos na consola pela abstração `EmailService`. Em produção, substitui essa implementação por um provider de email.

## Endpoints

| Método | Endpoint | Autenticação |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Não |
| `POST` | `/api/v1/auth/login` | Não |
| `POST` | `/api/v1/auth/refresh` | Refresh token no body |
| `POST` | `/api/v1/auth/logout` | Refresh token no body |
| `POST` | `/api/v1/auth/logout-all` | Bearer access token |
| `GET` | `/api/v1/auth/me` | Bearer access token |
| `POST` | `/api/v1/auth/forgot-password` | Não |
| `POST` | `/api/v1/auth/reset-password` | Token opaco no body |
| `POST` | `/api/v1/auth/change-password` | Bearer access token |
| `POST` | `/api/v1/auth/send-email-verification` | Bearer access token |
| `POST` | `/api/v1/auth/resend-email-verification` | Challenge ID no body |
| `POST` | `/api/v1/auth/verify-email` | Challenge ID e OTP no body |
| `PATCH` | `/api/v1/users/me` | Bearer access token |
| `POST` | `/api/v1/users/me/avatar` | Bearer access token; multipart `avatar` |
| `GET` | `/api/v1/products` | Não |
| `GET` | `/api/v1/products/:id` | Não |
| `POST` | `/api/v1/products` | Bearer token; role `seller`; multipart opcional `image` |
| `PATCH` | `/api/v1/products/:id` | Vendedor proprietário; multipart opcional `image` |
| `DELETE` | `/api/v1/products/:id` | Vendedor proprietário |
| `GET` | `/health` | Não |

## Exemplos

Registo:

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Manuel","lastName":"Silva","email":"manuel@email.pt","phone":"912345678","password":"Password!123","roles":["buyer"],"location":{"city":"Mirandela","postalCode":"5370-000"},"confirmAdult":true,"acceptTerms":true,"marketingConsent":false}'
```

Login:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manuel@email.pt","password":"Password!123"}'
```

Utilizador atual:

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Rotação do refresh token:

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"REFRESH_TOKEN"}'
```

Logout:

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"REFRESH_TOKEN"}'
```

As respostas seguem sempre um envelope. Exemplo de sucesso:

```json
{ "success": true, "data": { "id": "..." } }
```

Exemplo de erro:

```json
{ "success": false, "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "Email ou palavra-passe inválidos." } }
```

## Decisões de segurança

- Passwords usam Argon2id e nunca são selecionadas por omissão.
- Refresh tokens são JWTs rotativos vinculados a uma sessão; a base guarda apenas SHA-256 do token.
- Reutilizar um refresh token já rodado revoga as sessões ainda ativas do utilizador.
- Reset usa tokens aleatórios de utilização única; a verificação de email usa OTP com desafio, tentativas limitadas e HMAC. Nenhum segredo é guardado em claro.
- Alterar a password revoga as outras sessões; fazer reset revoga todas.
- Roles são validadas no servidor e `admin` nunca é aceite no registo público.
- Helmet, CORS, limites de pedidos, limite do body, rejeição de operadores Mongo e erros centralizados são aplicados globalmente.
- Fotografias de perfil são guardadas em `uploads/avatars/` com nomes UUID; MongoDB guarda apenas `avatarFilename`.
- Imagens de produtos são guardadas em `uploads/products/` com nomes UUID; MongoDB guarda apenas `imageFilename`.

Em clientes móveis, guarda access e refresh tokens em armazenamento seguro do sistema operativo, nunca em AsyncStorage.

## Chat entre compradores e vendedores

O chat usa as coleções `conversations` e `messages` na mesma base MongoDB. Os modelos criam índices únicos para a conversa por produto/comprador/vendedor e para cada identificador de envio por autor/conversa. Não requer serviços externos nem novas variáveis de ambiente. O utilizador tem de estar autenticado e pertencer à conversa em todas as operações.

Todos os caminhos abaixo têm o prefixo `/api/v1`:

| Método | Caminho | Dados |
|---|---|---|
| POST | `/conversations` | `{ productId }`: cria ou reutiliza a conversa; o vendedor é obtido do produto |
| GET | `/conversations?page=1&limit=50` | Conversas ordenadas pela última mensagem, outro participante, não lidas por conversa e `unreadTotal` de todas as páginas |
| GET | `/conversations/:id/messages?limit=50&before=...` | Histórico em ordem cronológica; `nextCursor` permite obter a página anterior |
| POST | `/conversations/:id/messages` | `{ text, clientId }`: texto com 1–2000 caracteres; reutilizar `clientId` ao repetir um envio |
| PATCH | `/conversations/:id/read` | `{ messageIds: [...] }`: até 100 mensagens apresentadas; apenas mensagens recebidas pelo utilizador são marcadas |

O chat tem limites próprios: 2000 pedidos por IP em 15 minutos, 120 pedidos por utilizador por minuto e 60 envios por minuto. Não consome o limite geral destinado às restantes rotas. Contadores são derivados de mensagens persistidas, e marcar um lote como lido não marca mensagens que chegam depois. A lista de conversas contém o título do produto no momento em que a conversa foi criada.

Validação: `npm test` inclui envio bidirecional, isolamento de terceiros, leitura, paginação, reenvios idempotentes e junção de mensagens no cliente. Nesta fase não há push nem WebSocket.

## Notificações push de mensagens

O backend usa diretamente a API HTTPS do Expo Push Service. Configure APNs (iOS) e FCM v1 (Android) nas credenciais do projeto EAS, publique o backend e defina `PUSH_ENABLED=true` no Render. Se a segurança adicional do Expo Push Service estiver ativa, configure também `EXPO_ACCESS_TOKEN` como segredo no backend. Não coloque esse segredo no mobile.

- `PUT /api/v1/push/device` recebe `{ token, platform: 'ios' | 'android' }`, com JWT, e associa o dispositivo à sessão autenticada.
- `DELETE /api/v1/push/device` recebe `{ token }`, com JWT, e remove apenas a associação dessa sessão.
- `GET /api/v1/conversations/:id` obtém o contexto para abrir a conversa pelo aviso, com a mesma autorização dos restantes endpoints de chat.

Cada mensagem nova guarda `pushState: pending` na mesma escrita que guarda o texto. O worker, iniciado por `src/server.js`, cria entregas únicas por mensagem/dispositivo/associação e verifica mensagens lidas, conta ativa, sessão não revogada e validade do dispositivo antes de enviar. A rotação do refresh token transfere a associação para a nova sessão. Logout e expiração impedem os envios seguintes; avisos já entregues ao serviço Apple/Google não podem ser retirados remotamente.

O worker corre a cada 5 segundos enquanto o processo está ativo. Falhas temporárias usam espera exponencial até 5 tentativas; tickets aceites são consultados após 15 minutos. `DeviceNotRegistered` remove o token. As entregas expiram em 24 horas e os registos são removidos após 7 dias. Mensagens antigas sem `pushState` não geram notificações retroativas. O conteúdo mostra apenas “Nova mensagem de [nome]” e identificadores para navegação, sem o texto privado.

As coleções `pushdevices` e `pushdeliveries` ficam na mesma base MongoDB e os índices são criados pelos modelos. A fila resiste a reinícios, mas o serviço web deve permanecer ativo para processar imediatamente. Uma instância Render que adormece pode atrasar os envios/recibos; para produção use um serviço sempre ativo. Não é necessário Redis nesta fase.

Reenvios da mesma mensagem não criam novas entregas. Porém, uma falha de rede depois de o Expo aceitar o pedido, ou um reinício antes de guardar o ticket, pode provocar uma repetição externa. Não se promete entrega exatamente uma vez nem entrega garantida ao dispositivo. `status: done` com recibo positivo confirma a aceitação pelo fornecedor, não que o utilizador viu a notificação.

Testes: `npm test` utiliza respostas simuladas do Expo e nunca envia notificações reais. Erros permanentes ficam em `pushdeliveries.lastError` e nos logs, sem tokens ou texto das mensagens.
