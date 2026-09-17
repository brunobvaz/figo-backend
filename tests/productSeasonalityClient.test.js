import { expect, it } from 'vitest';
import { currentProductSeason, isExplicitlyInSeason, isProductInSeason, SEASONALITY_OPTIONS } from '../../mobile/src/utils/productSeasonality.js';
import { discoveryProducts } from '../../mobile/src/utils/homeDiscovery.js';

it('define as cinco opções sem valores repetidos', () => {
  expect(SEASONALITY_OPTIONS).toHaveLength(5);
  expect(new Set(SEASONALITY_OPTIONS.map(x => x.value)).size).toBe(5);
});
it('usa as estações meteorológicas de Portugal durante os 12 meses', () => {
  expect(Array.from({ length: 12 }, (_, month) => currentProductSeason(new Date(2026, month, 15))))
    .toEqual(['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']);
});
it('inclui produtos antigos/todo o ano e apenas a estação atual', () => {
  const september = new Date(2026, 8, 11);
  expect(isProductInSeason({}, september)).toBe(true);
  expect(isProductInSeason({ seasonality: 'all_year' }, september)).toBe(true);
  expect(isProductInSeason({ seasonality: 'autumn' }, september)).toBe(true);
  expect(isProductInSeason({ seasonality: 'summer' }, september)).toBe(false);
  expect(isProductInSeason({ seasonality: 'invalid' }, september)).toBe(false);
});
it('a descoberta substitui flags temporárias pela sazonalidade guardada', () => {
  const current = currentProductSeason();
  const other = current === 'winter' ? 'summer' : 'winter';
  const input = [{ id: 'a', seasonal: true, seasonality: other }, { id: 'b', seasonal: false, seasonality: current }];
  expect(discoveryProducts(input).map(x => x.seasonal)).toEqual([false, true]);
  expect(input[0].seasonal).toBe(true);
});

it('exclui todo o ano da seleção editorial sem alterar a disponibilidade geral', () => {
  const allYear = { seasonality: 'all_year', seasonal: true };
  expect(isProductInSeason(allYear)).toBe(true);
  expect(isExplicitlyInSeason(allYear, 'autumn')).toBe(false);
  expect(isExplicitlyInSeason({}, 'autumn')).toBe(false);
  expect(isExplicitlyInSeason({ seasonality: 'autumn' }, 'autumn')).toBe(true);
  expect(isExplicitlyInSeason({ seasons: ['all_year'] }, 'autumn')).toBe(false);
  expect(isExplicitlyInSeason({ seasons: ['all_year', 'autumn'] }, 'autumn')).toBe(false);
  expect(isExplicitlyInSeason({ seasons: ['autumn', 'winter'] }, 'autumn')).toBe(true);
  expect(isExplicitlyInSeason({ seasonality: 'summer' }, 'autumn')).toBe(false);
});

it('não destaca anúncios por posição, dados antigos ou valores truthy', () => {
  const products = Array.from({ length: 8 }, (_, index) => ({ id: String(index) }));
  products.push({ id: 'chosen', featured: true }, { id: 'off', featured: false }, { id: 'string', featured: 'true' }, { id: 'hidden', featured: true, is_active: false }, { id: 'deleted', featured: true, status: 'deleted' });
  expect(discoveryProducts(products).filter(product => product.featured).map(product => product.id)).toEqual(['chosen']);
});
