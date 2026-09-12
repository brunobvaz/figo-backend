import { expect, it } from 'vitest';
import { applyEditorialFilters, hasExploreFilters, parishMarkers, parsePriceRange, productQuery, resetExploreFilters } from '../../mobile/src/utils/exploreFilters.js';

it('preserva pesquisa e filtros ao alternar lista e mapa', () => {
  const filters = { query: ' mel ', category: 'Mel', minPrice: 0, maxPrice: 10, radiusKm: 10, sortBy: 'distance', availableOnly: true, unit: '€/frasco' };
  const point = { latitude: 41, longitude: -8 };
  expect(productQuery({ ...filters, viewMode: 'list' }, point)).toEqual(productQuery({ ...filters, viewMode: 'map' }, point));
  expect(productQuery(filters, point)).toMatchObject({ search: 'mel', category: 'Mel', minPrice: 0, maxPrice: 10, radiusKm: 10, sort: 'distance', latitude: 41, availableOnly: true, unit: '€/frasco' });
});
it('mantém a pesquisa por região quando GPS não está disponível', () => {
  const query = productQuery({ radiusKm: 10, sortBy: 'distance', category: 'Legumes' }, null, { municipalityCode: '0302' });
  expect(query).toMatchObject({ category: 'Legumes', municipalityCode: '0302', sort: 'recent' });
  expect(query.latitude).toBeUndefined(); expect(query.radiusKm).toBeUndefined();
  expect(productQuery({}, { latitude: 41, longitude: -8 }).latitude).toBeUndefined();
  expect(productQuery({ sortBy: 'distance' }, { latitude: 41, longitude: -8 }).radiusKm).toBeUndefined();
});
it('valida preço português, zero, limites e intervalos invertidos', () => {
  expect(parsePriceRange('0', '10,50')).toEqual({ minPrice: 0, maxPrice: 10.5 });
  expect(parsePriceRange('', '')).toEqual({ minPrice: undefined, maxPrice: undefined });
  for (const [min, max] of [['11', '10'], ['-1', ''], ['abc', ''], ['', '1000001'], ['1e2', '']]) expect(parsePriceRange(min, max).error).toBeTruthy();
});
it('limpa filtros sem alterar a vista nem o objeto original', () => {
  const filters = { viewMode: 'map', query: 'mel', radiusKm: 10, featured: true, sortBy: 'distance' };
  expect(resetExploreFilters(filters)).toEqual({ viewMode: 'map' });
  expect(hasExploreFilters(filters)).toBe(true);
  expect(hasExploreFilters(resetExploreFilters(filters))).toBe(false);
  expect(filters.query).toBe('mel');
});
it('aplica os mesmos destaques do Home sem destacar a primeira linha de cada pesquisa', () => {
  const items = [{ id: 'b' }, { id: 'a' }, { id: 'c', featured: false, seasonal: true, seasonality: 'autumn' }];
  const editorial = [{ id: 'a', featured: true }, { id: 'b', featured: false }, { id: 'c', featured: true }];
  expect(applyEditorialFilters(items, { featured: true }, editorial).map(x => x.id)).toEqual(['a']);
  expect(applyEditorialFilters(items, { season: 'autumn' }, editorial).map(x => x.id)).toEqual(['c']);
  expect(applyEditorialFilters([], {}, editorial)).toEqual([]);
  expect(items[0].featured).toBeUndefined();
});
it('agrupa produtos coincidentes sem inventar pins para locais desconhecidos', () => {
  const parishes = new Map([['a', { latitude: 41, longitude: -8 }], ['invalid', { latitude: 100, longitude: -8 }]]);
  const products = [{ id: '1', address: { parishCode: 'a' } }, { id: '2', address: { parishCode: 'a' } }, { id: '3' }, { id: '4', address: { parishCode: 'invalid' } }];
  const markers = parishMarkers(products, parishes);
  expect(markers).toHaveLength(1); expect(markers[0].coordinate).toEqual({ latitude: 41, longitude: -8 });
  expect(markers[0].products.map(x => x.id)).toEqual(['1', '2']);
  expect(parishMarkers([], parishes)).toEqual([]);
});

it('o atalho Da época exclui todo o ano mesmo com metadados antigos', () => {
  const items = [{ id: 'all', seasonality: 'all_year', seasonal: true }, { id: 'autumn', seasonality: 'autumn' }, { id: 'summer', seasonality: 'summer' }];
  expect(applyEditorialFilters(items, { season: 'autumn' }, []).map(item => item.id)).toEqual(['autumn']);
  expect(hasExploreFilters({ season: 'autumn' })).toBe(true);
  expect(resetExploreFilters({ season: 'autumn' })).toEqual({ viewMode: 'list' });
});
