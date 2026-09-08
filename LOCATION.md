# Localizações e proximidade

Implementação: CAOP2025 da Direção-Geral do Território, 308 municípios e 3259 entradas de freguesia, cobrindo Continente, Açores e Madeira. A entrada do Corvo é estatística, conforme as notas da fonte. Alguns códigos de freguesia contêm letras: não converter códigos para números.

Fonte: https://www.dgterritorio.gov.pt/sites/default/files/ficheiros-cartografia/Areas_Freg_Mun_Dist_Pais_CAOP2025.zip
Os JSON e o SHA-256 da fonte estão em `data/caop/2025/`.

## Importação

Na pasta backend:

```sh
npm run import:caop -- --check
npm run import:caop
```

Usa `MONGODB_URI` e `MONGODB_DB_NAME` do `.env`, como o servidor. Cria/atualiza apenas os domínios, os metadados e o índice `products.geo`. Não altera anúncios existentes. É repetível. Ativa a versão depois de terminar ambas as coleções.

Para reproduzir a conversão do ZIP oficial (Python 3, biblioteca padrão):

```sh
python3 scripts/prepare-caop.py /caminho/Areas_Freg_Mun_Dist_Pais_CAOP2025.zip
```

Não usar o importador fixo de 2025 para uma versão diferente sem rever os cabeçalhos, códigos, contagens e migração. Versões antigas permanecem referenciadas nos endereços dos produtos.

## API

- `GET /api/v1/locations/municipalities`: `{version, items}`.
- `GET /api/v1/locations/parishes?municipalityCode=0302`: `{version, items}`.
- `POST /products`: campos usuais mais `municipalityCode`, `parishCode`, `locality`, `latitude`, `longitude`, `locationSource` (`gps` ou `manual`, ponto escolhido no mapa).
- `PATCH /products/:id`: pode omitir todos os campos de localização para preservar o local. Se alterar algum, exige o conjunto completo.
- `GET /products?latitude=41&longitude=-8&radiusKm=25&page=1&limit=20`: proximidade em linha reta, com `distanceMeters` e paginação. Raios entre 0,1 e 500 km; latitude e longitude em conjunto. Combina pesquisa, categoria, vendedor, concelho e freguesia.

O servidor verifica a associação concelho/freguesia e gera o texto `location`. As coordenadas são GeoJSON `[longitude, latitude]` em `geo`, com índice `2dsphere`. Os endpoints públicos não devolvem `geo`. A posição do comprador é usada apenas na consulta, sem persistência. Configurar os logs de acesso da infraestrutura para não conservar coordenadas nas query strings.

Os dados importados são administrativos, sem polígonos: não verificam se um ponto GPS está dentro da freguesia. O vendedor confirma a posição. Produtos antigos sem coordenadas aparecem nas listas normais, mas não na proximidade; ao editar devem completar a localização. Não inferir coordenadas exatas a partir do texto antigo.

## Mobile

Seletores pesquisáveis, localidade, localização atual com confirmação e escolha no mapa. Pesquisas de proximidade consultam a API e têm paginação. Permissão recusada: pesquisa administrativa e seleção manual no mapa continuam disponíveis. O mapa usa Apple Maps no iOS e Google Maps no Android.

Dependências: `expo-location`, `react-native-maps`. As permissões e plugins estão em `app.config.js`; o Info.plist iOS existente também foi atualizado.

Para Android, configurar `GOOGLE_MAPS_ANDROID_API_KEY` no ambiente de build, com Maps SDK for Android ativo e restrição ao package/SHA-1 da app. iOS usa Apple Maps, sem chave Google. GPS e pesquisa administrativa não dependem desta chave.

Depois de instalar módulos nativos é preciso recompilar, não basta recarregar Metro:

```sh
# Na pasta mobile
npx expo run:ios
# Android gerado pelo Expo aplica os plugins de app.config.js
npx expo run:android
```

Testes manuais: publicar com GPS; publicar escolhendo ponto; negar permissão; mudar concelho e confirmar que a freguesia/ponto são limpos; editar só título sem perder localização; atualizar um anúncio antigo; pesquisar a 5/25/50 km; mudar filtros durante carregamento; abrir detalhes e carregar mais resultados.

## Verificação realizada

- Base configurada: CAOP2025 ativa, 308 municípios, 3259 entradas de freguesia e índice `geo_2dsphere` confirmados.
- Suite backend: 51 testes aprovados. Testes geográficos repetidos após corrigir o escape da pesquisa textual, incluindo `[`.
- Bundles finais de iOS e Android exportados pelo Expo.
- Compilação nativa iOS Debug para simulador arm64 concluída com sucesso. Não equivale a teste manual de GPS ou mapa num dispositivo real.
- CocoaPods sincronizado com os módulos Expo instalados. Foi necessário repor o framework precompilado Debug do React Native: a cache não tinha o marcador de configuração e o script assumia erradamente que não precisava de substituição. Foram usados os scripts oficiais `replace-rncore-version.js` (Release e depois Debug), sem alterar flags ABI nem código de dependências.
