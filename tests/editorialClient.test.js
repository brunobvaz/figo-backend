import { expect, it, vi } from 'vitest';
import recipes from '../../mobile/src/data/mockRecipes.js';
import { eventService } from '../../mobile/src/services/eventService.js';
import { recipeService } from '../../mobile/src/services/recipeService.js';
import { editorialService, filterRecipes } from '../../mobile/src/services/editorialService.js';
vi.mock('../../mobile/src/services/recipeService.js', () => ({ recipeService: { page: vi.fn() } }));

vi.mock('../../mobile/src/services/eventService.js', () => ({ eventService: { page: vi.fn() } }));

it('lê receitas e eventos da API paginada', async () => {
  const response = { items: [{ id: 'real-recipe' }], pagination: { page: 2, pages: 2 } };
  recipeService.page.mockResolvedValueOnce(response);
  expect(await editorialService.getSeasonalRecipes({ filter: 'Sopas', page: 2 })).toBe(response);
  expect(recipeService.page).toHaveBeenCalledExactlyOnceWith({ filter: 'Sopas', page: 2 });
  eventService.page.mockResolvedValueOnce(response);
  expect(await editorialService.getLocalEvents({ filter: 'Feiras', page: 2 })).toBe(response);
  expect(eventService.page).toHaveBeenCalledExactlyOnceWith({ filter: 'Feiras', page: 2 });
});
it('filtra receitas rápidas, vegetarianas, doces e sopas', () => {
  expect(filterRecipes(recipes, 'Todos')).toHaveLength(6);
  expect(filterRecipes(recipes, 'Rápidas')).toHaveLength(3);
  expect(filterRecipes(recipes, 'Rápidas').every(x => x.preparationMinutes <= 30)).toBe(true);
  expect(filterRecipes(recipes, 'Doces')).toHaveLength(2);
  expect(filterRecipes(recipes, 'Sopas')).toHaveLength(2);
  expect(filterRecipes(recipes, 'Vegetarianas').every(x => x.categories.includes('Vegetarianas'))).toBe(true);
  expect(filterRecipes([], 'Todos')).toEqual([]);
});
