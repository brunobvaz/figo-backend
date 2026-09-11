import { expect, it } from 'vitest';
import { editorialService, filterRecipes, filterEvents, localEventDate } from '../../mobile/src/services/editorialService.js';

it('carrega seis mocks de cada tipo, com IDs únicos, sem partilhar dados mutáveis', async () => {
  const recipes = await editorialService.getSeasonalRecipes();
  const events = await editorialService.getLocalEvents();
  expect(recipes).toHaveLength(6); expect(events).toHaveLength(6);
  expect(new Set(recipes.map(x => x.id)).size).toBe(6); expect(new Set(events.map(x => x.id)).size).toBe(6);
  recipes[0].ingredients.push('alterado'); events[0].title = 'alterado';
  expect((await editorialService.getSeasonalRecipes())[0].ingredients).not.toContain('alterado');
  expect((await editorialService.getLocalEvents())[0].title).not.toBe('alterado');
});
it('filtra receitas rápidas, vegetarianas, doces e sopas', async () => {
  const recipes = await editorialService.getSeasonalRecipes();
  expect(filterRecipes(recipes, 'Todos')).toHaveLength(6);
  expect(filterRecipes(recipes, 'Rápidas')).toHaveLength(3);
  expect(filterRecipes(recipes, 'Rápidas').every(x => x.preparationMinutes <= 30)).toBe(true);
  expect(filterRecipes(recipes, 'Doces')).toHaveLength(2);
  expect(filterRecipes(recipes, 'Sopas')).toHaveLength(2);
  expect(filterRecipes(recipes, 'Vegetarianas').every(x => x.categories.includes('Vegetarianas'))).toBe(true);
  expect(filterRecipes([], 'Todos')).toEqual([]);
});
it('ordena eventos cronologicamente sem alterar a coleção original', async () => {
  const reversed = (await editorialService.getLocalEvents()).reverse();
  const first = reversed[0].id;
  expect(filterEvents(reversed, 'Todos').map(x => x.date)).toEqual(['2026-09-14', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
  expect(reversed[0].id).toBe(first);
  expect(filterEvents(reversed, 'Feiras')).toHaveLength(2);
  expect(filterEvents(reversed, 'Mercados')).toHaveLength(2);
});
it('filtra semana de segunda a domingo e mês/ano na data local', async () => {
  const events = await editorialService.getLocalEvents();
  expect(filterEvents(events, 'Esta semana', new Date(2026, 8, 16)).map(x => x.date)).toEqual(['2026-09-14', '2026-09-20']);
  expect(filterEvents(events, 'Esta semana', new Date(2026, 8, 20))).toHaveLength(2);
  expect(filterEvents(events, 'Este mês', new Date(2026, 8, 11))).toHaveLength(3);
  expect(filterEvents(events, 'Este mês', new Date(2027, 8, 11))).toEqual([]);
  expect(filterEvents(events, 'Esta semana', new Date(2026, 8, 11))).toEqual([]);
  expect(localEventDate('2026-09-14').getDate()).toBe(14);
});
it('trata corretamente semanas na mudança de ano', () => {
  const events = ['2026-12-27', '2026-12-28', '2027-01-03', '2027-01-04'].map((date, i) => ({ id: String(i), date, startTime: '09:00' }));
  expect(filterEvents(events, 'Esta semana', new Date(2027, 0, 1)).map(x => x.date)).toEqual(['2026-12-28', '2027-01-03']);
});
