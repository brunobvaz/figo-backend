# Até seis fotografias por produto

## Aplicação

Criar e editar anúncios apresenta seis posições, contador, remoção individual e dicas. O seletor permite adicionar várias fotografias de uma vez até preencher as posições livres. JPEG, PNG e WebP, até 5 MB por fotografia; o servidor também valida o conteúdo do ficheiro e limita-o a 50 megapíxeis.

A primeira fotografia é a capa nas listas, favoritos e conversas. Tocar noutra miniatura no formulário coloca-a em primeiro lugar. O detalhe mostra a galeria com deslize horizontal, contador e miniaturas. Publicar/guardar pelo novo formulário exige pelo menos uma fotografia. Os uploads têm um tempo limite de dois minutos para acomodar até 30 MB.

A edição consulta primeiro o produto no servidor. Fotografias existentes são referenciadas, sem voltar a carregar os ficheiros. As alterações de fotografias incluem uma revisão; uma galeria alterada entretanto noutro dispositivo é rejeitada com 409 para não perder imagens.

## Dados e API

`Product.images` guarda uma lista ordenada, até seis elementos: `{ filename }` para ficheiros da API; `{ url }` conserva imagens históricas externas. `imageFilename` e `image` mantêm a capa para clientes antigos. `imagesRevision` começa em 0 e aumenta apenas ao alterar a galeria.

Os endpoints de criar/editar continuam a aceitar `multipart/form-data`:

- `images`: até 6 ficheiros (máximo global também considera o campo legado `image`).
- `imageOrder`: JSON com a ordem final, por exemplo `[{"filename":"existente.jpg"},{"upload":0}]`.
- `imagesRevision`: revisão que foi carregada ao abrir a edição.

Cada upload é utilizado uma vez. Referências a imagens de outro produto, repetidas, ausentes ou ficheiros não usados são rejeitados. Uma edição apenas de texto preserva a galeria. O campo legado `image` para um único upload substitui só a capa, mantendo as restantes imagens. Campos de fotografias e campos legados não devem ser misturados no mesmo pedido.

A API lê produtos ainda não migrados. Produtos históricos sem fotografia permanecem sem fotografia; não são criadas imagens artificiais. Ao editá-los no novo formulário, o utilizador terá de escolher pelo menos uma.

## Migração

Na pasta backend, com a configuração da base pretendida:

```
npm run migrate:product-images -- --dry-run
npm run migrate:product-images -- --apply
```

O primeiro comando apenas conta documentos. O segundo acrescenta `images` e `imagesRevision`, e cria índices de pesquisa de imagens. Tem execução repetível e não substitui galerias já existentes. Converte `imageFilename` em primeira fotografia; se não existir, conserva o URL de `image`; sem ambos, guarda `[]`. Não altera IDs, datas, vendedor, estados, disponibilidade nem ficheiros. Inclui anúncios ocultos, esgotados e removidos.

Publicar o backend novo antes dos clientes novos. A compatibilidade refere-se a clientes antigos a utilizar o backend novo; não se deve continuar a escrever com um servidor antigo que desconhece `images` depois da migração.

## Ficheiros e contas

Uploads parciais são limpos quando o pedido falha. Os ficheiros removidos de uma galeria ficam numa lista interna persistente até a eliminação dos originais e variantes terminar. O worker `startProductImageCleanupWorker` repete a limpeza a cada 30 segundos, incluindo após reinício do servidor. Esta lista não é exposta na API.

Desativar a conta oculta também as imagens adicionais. Remover anúncio/conta limpa todas as fotografias e respetivas variantes, incluindo ficheiros pendentes de uma edição anterior. Imagens guardadas externamente por URL não são apagadas pelo servidor: é removida a referência.

## Verificação

`tests/productPhotos.test.js`: uploads, contagem, validação, ordem, capa, edições, compatibilidade, referências, concorrência, limpeza, eliminação de conta e migração.

`tests/productPhotosClient.test.js`: compatibilidade, seleção múltipla, limites, duplicados e ordem dos ficheiros enviados.

Documentação do seletor usado: https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/
