# Entrega de imagens

Os ficheiros originais e os nomes guardados na base de dados são preservados.
Os endpoints existentes de imagens aceitam `?w=160`, `320`, `640` ou `1280`.
São geradas versões JPEG com orientação corrigida, sem aumentar a resolução,
guardadas em `uploads/{avatars,products}/.variants/v1`.

A aplicação usa 160/320 px para avatares, 160 px no contexto das conversas,
640 px nos cartões e 1280 px no detalhe. Se a versão reduzida falhar, tenta
o original. URLs antigas continuam válidas. Não há migrações de base de dados.

## Publicação

1. Publicar o backend com `npm ci` no ambiente de destino, incluindo `sharp`.
2. Na pasta do backend, no servidor com acesso aos uploads existentes, executar
   `node scripts/warm-image-variants.js` para preparar as imagens antigas.
3. Publicar a aplicação atualizada.

Os novos uploads preparam as versões em segundo plano. As versões em falta
também são geradas no primeiro pedido, que poderá demorar mais. A preparação
antecipada evita esse custo na primeira visualização.

A cache usa `public, max-age=31536000, immutable`: os uploads devem continuar
a receber nomes únicos, como atualmente. Nunca substituir o conteúdo de um
ficheiro mantendo o mesmo nome. As versões derivadas são descartáveis; os
originais precisam de armazenamento persistente. Não foi configurada uma CDN.

A entrega de imagens não consome o limite global de pedidos da API. A geração
tem concorrência limitada a dois trabalhos, fila limitada e reutilização de
trabalhos simultâneos para a mesma imagem. Falhas de processamento usam o
original com `no-store`, evitando guardar um fallback temporário durante um ano.

## Validação

Executar `npm test`. Os testes cobrem dimensões, compressão, orientação,
preservação dos originais, concorrência, cache HTTP, validação de parâmetros,
fallback e remoção de versões. Medir novamente em produção após publicação:
tamanho transferido, tempo até ao primeiro byte e respostas 429/5xx.
