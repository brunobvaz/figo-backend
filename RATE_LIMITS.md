# Limites de pedidos

Publicar o backend para aplicar estes defaults. Não é necessária uma nova build
TestFlight nem migração. Variáveis existentes no Render sobrepõem os defaults.

- API: `GLOBAL_RATE_LIMIT_MAX=1500` em `GLOBAL_RATE_LIMIT_WINDOW_MS=900000`.
  Contagem por identidade assinada no access token; sem token válido, por IP.
- Autenticação: `AUTH_RATE_LIMIT_MAX=10` falhas por operação em
  `AUTH_RATE_LIMIT_WINDOW_MS=900000`. Sucessos não gastam este limite.
- Renovação de sessão: `REFRESH_RATE_LIMIT_MAX=30` por minuto, por utilizador
  identificado através de refresh token validado; tokens inválidos usam IP.
- Registo e envio de verificação: `VERIFICATION_RATE_LIMIT_MAX=10` por janela
  de autenticação. Estes pedidos contam também quando têm sucesso.
- Recuperação de password: `FORGOT_PASSWORD_RATE_LIMIT_MAX=5` por IP na mesma
  janela. Cooldown e máximo de tentativas por código OTP são preservados.
- Chat mantém os limites específicos existentes; imagens ficam fora da API.

Pesquisar `RATE_LIMIT_BLOCKED` nos Logs do Render. Cada registo contém limiter,
route, limit, windowMs, retryAfterSeconds e fingerprints de client/IP. Não
contém tokens, emails nem IPs em claro. Os fingerprints só são comparáveis
durante a vida do processo. Respostas 429 incluem Retry-After e preservam os
códigos de erro existentes. Não se alterou trust proxy sem evidência.

O armazenamento dos contadores continua em memória por instância. Se forem
adicionadas várias instâncias, será necessário um store partilhado. Para
diagnosticar o proxy, comparar fingerprints de IP de testers em redes distintas.
