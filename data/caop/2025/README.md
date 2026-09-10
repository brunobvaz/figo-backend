# Localização aproximada por freguesia

`parishes.json` associa cada código DTMNFR ao concelho, nome e ponto representativo em WGS84 (`latitude`, `longitude`). O ponto é calculado dentro do maior polígono da freguesia, não corresponde a uma morada ou ponto de recolha. `points-source.json` regista as fontes DGT, método e SHA-256 dos ficheiros de origem.

## Atualizar os dados

1. Executar `scripts/prepare-caop.py` com o ZIP oficial das áreas CAOP2025.
2. Descarregar o GeoJSON completo do continente de `https://ogcapi.dgterritorio.gov.pt/collections/freguesias/items?f=json&limit=4000` e os ZIPs oficiais CAOP2025 dos Açores e Madeira.
3. Num ambiente Python com `shapely` e `pyproj`, executar `python scripts/prepare-parish-points.py continente.geojson acores.zip madeira.zip`. O script exige cobertura exata dos códigos e verifica que os pontos ficam dentro das geometrias.
4. Executar `npm run import:caop -- --check` e depois `npm run import:caop` no backend com a base de dados pretendida configurada. A importação atualiza o catálogo; não altera pontos de produtos existentes.

## Comportamento

A API das freguesias devolve os pontos. O formulário copia o ponto ao confirmar uma nova freguesia, limpa a localidade anterior e marca `locationSource: parish`. A localização de novos produtos é sempre calculada pela freguesia. Alterar apenas a localidade preserva o ponto, incluindo ao editar um produto cuja API não expõe coordenadas. O seletor confirma concelho e freguesia em conjunto: cancelar não altera a localização guardada.

Ao guardar uma localização com origem `parish`, o servidor usa as coordenadas do catálogo e valida a relação administrativa, ignorando o ponto enviado pelo cliente. Produtos aproximados e as suas distâncias são identificados na interface. Uma freguesia sem ponto válido impede guardar uma nova localização e apresenta uma mensagem de erro. As origens GPS/manual são conservadas apenas no modelo para compatibilidade com produtos antigos; a API não as aceita em novas localizações.
