# Localizações e proximidade

O catálogo CAOP2025 contém 308 concelhos e 3259 freguesias, incluindo Continente, Açores, Madeira e a entrada estatística do Corvo. Cada freguesia tem um ponto representativo interior aos limites oficiais. Consultar `data/caop/2025/README.md` para as fontes e instruções de regeneração/importação.

## Produtos

A escolha do concelho/freguesia preenche automaticamente as coordenadas. A interface identifica a localização e as distâncias como aproximadas. Não existe captura GPS nem seleção de pin nos formulários.

A API aceita `locationSource: parish` para novas localizações e obtém as coordenadas do catálogo, validando a relação concelho/freguesia. A alteração administrativa exige o conjunto completo dos campos de localização. A alteração isolada de `locality` preserva o ponto. Produtos antigos conservam a origem histórica GPS/manual no modelo, mas a API não aceita essas origens em novas localizações.

## Pesquisa

`expo-location` continua a permitir procurar produtos próximos. Se a permissão for recusada, a pesquisa administrativa continua disponível. `react-native-maps` e a configuração de chaves Google Maps foram removidos. Alterações de dependências nativas exigem uma nova build.

## Verificação

Os testes cobrem preenchimento por freguesia, rejeição de GPS/manual em novas localizações, coordenadas em falta e preservação de produtos antigos. Exportar os bundles iOS/Android verifica a resolução de dependências. Testar visualmente a seleção de freguesia, alteração da localidade e pesquisa de proximidade num dispositivo.
