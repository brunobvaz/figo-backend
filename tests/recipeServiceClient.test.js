import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../mobile/src/services/api.js';
import { recipeService } from '../../mobile/src/services/recipeService.js';
import { recipeImageUrl } from '../../mobile/src/utils/recipeImages.js';

vi.mock('../../mobile/src/services/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../../mobile/src/config/config.js', () => ({ default: { apiBaseUrl: 'http://10.0.2.2:3000/api/v1' } }));
beforeEach(() => vi.resetAllMocks());
const id = '000000000000000000000001';
const image = `/api/v1/recipes/${id}/image?v=5666c564-b942-4628-97af-90b98d659ec3`;
const payload = { items: [{ id, image, title: 'Receita do backoffice' }], pagination: { page: 1, pages: 1, total: 1 } };

it('lê a página pública e resolve imagens usando o servidor configurado no dispositivo', async () => {
  api.get.mockResolvedValue(payload);
  const result = await recipeService.page();
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/recipes?page=1&limit=20');
  expect(result.items[0].image).toBe(`http://10.0.2.2:3000${image}`);
  expect(result.items[0].title).toBe('Receita do backoffice');
  expect(payload.items[0].image).toBe(image);
});
it.each([['Rápidas', 'quick=true'], ['Vegetarianas', 'category=Vegetarianas'], ['Doces', 'category=Doces'], ['Sopas', 'category=Sopas']])('envia o filtro %s antes da paginação', async (filter, query) => {
  api.get.mockResolvedValue({ ...payload, pagination: { page: 2, pages: 3 } });
  await recipeService.page({ filter, page: 2 });
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`/recipes?page=2&limit=20&${query}`);
});
it('preserva resultados vazios e propaga falhas, sem regressar aos mocks', async () => {
  api.get.mockResolvedValueOnce({ items: [], pagination: { page: 1, pages: 0, total: 0 } }).mockRejectedValueOnce(new Error('Sem ligação'));
  expect((await recipeService.page()).items).toEqual([]);
  await expect(recipeService.page()).rejects.toThrow('Sem ligação');
  api.get.mockResolvedValue({});
  await expect(recipeService.page()).rejects.toThrow('Não foi possível ler as receitas');
});
it('aceita URLs HTTPS e rejeita imagens inválidas e rotas administrativas', () => {
  expect(recipeImageUrl('https://example.com/recipe.jpg', 'https://figo-backend.onrender.com/api/v1')).toBe('https://example.com/recipe.jpg');
  expect(recipeImageUrl(image, 'https://figo-backend.onrender.com/api/v1')).toBe(`https://figo-backend.onrender.com${image}`);
  for (const value of [null, 1, 'javascript:alert(1)', 'http://example.com/image.jpg', '//example.com/image.jpg', `/api/v1/admin/recipes/${id}/image`, 'https://user:password@example.com/a.jpg'])
    expect(recipeImageUrl(value, 'http://localhost:3000/api/v1')).toBeNull();
});

it('carrega o detalhe completo e normaliza a fotografia sem alterar a resposta original', async () => {
  const recipe = { id, image, title: 'Sopa', description: 'Descrição completa.', categories: ['Sopas'], ingredients: ['1 batata'], steps: ['Cozer.'] };
  api.get.mockResolvedValue(recipe);
  expect(await recipeService.detail(id)).toEqual({ ...recipe, image: `http://10.0.2.2:3000${image}` });
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`/recipes/${id}`);
  expect(recipe.image).toBe(image);
  api.get.mockResolvedValue({ ...recipe, steps: undefined });
  expect((await recipeService.detail(id)).steps).toEqual([]);
});

it('propaga a eliminação e falhas do detalhe e rejeita respostas incompletas', async () => {
  const missing = Object.assign(new Error('Receita indisponível'), { status: 404 });
  api.get.mockRejectedValueOnce(missing);
  await expect(recipeService.detail(id)).rejects.toBe(missing);
  api.get.mockResolvedValue({ id, title: 'Incompleta' });
  await expect(recipeService.detail(id)).rejects.toThrow('Não foi possível ler esta receita');
});
