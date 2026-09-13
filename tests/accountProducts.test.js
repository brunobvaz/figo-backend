import { expect, it, vi } from 'vitest';
import { createAccountFavoritesStore } from '../../mobile/src/storage/accountFavorites.js';
import { loadOwnProducts, loadFavoriteProducts } from '../../mobile/src/utils/accountProducts.js';
it('isola favoritos por conta e ignora a lista antiga sem proprietário', async () => {
  const data = new Map([['favorites', ['shared']]]);
  const store = createAccountFavoritesStore(async key => data.get(key) || [], async (key, ids) => data.set(key, ids), 'favorites');
  expect(await store.load('alice')).toEqual([]);
  await store.save('alice', ['a']); await store.save('bob', ['b']);
  expect(await store.load('alice')).toEqual(['a']);
  expect(await store.load('bob')).toEqual(['b']);
  expect(await store.load(null)).toEqual([]);
  await store.save('bob', []);
  expect(await store.load('alice')).toEqual(['a']);
});
it('ordena alterações rápidas e aguarda a gravação ao voltar à conta', async () => {
  const data = new Map();
  const store = createAccountFavoritesStore(async key => data.get(key) || [], async (key, ids) => {
    await new Promise(resolve => setTimeout(resolve, ids.length === 1 ? 20 : 1)); data.set(key, ids);
  }, 'favorites');
  const first = store.save('alice', ['a']); const second = store.save('alice', ['a', 'b']);
  expect(await store.load('alice')).toEqual(['a', 'b']);
  await Promise.all([first, second]);
});
it('consulta todas as páginas por sellerId e exclui outros vendedores', async () => {
  const service = { mine: vi.fn().mockResolvedValueOnce({ items: [{ id: 'a', seller: { id: 'alice' } }, { id: 'b', seller: { id: 'bob' } }], pagination: { pages: 2 } })
    .mockResolvedValueOnce({ items: [{ id: 'c', seller: { _id: 'alice' } }], pagination: { pages: 2 } }) };
  expect((await loadOwnProducts(service, 'alice')).map(x => x.id)).toEqual(['a', 'c']);
  expect(service.mine.mock.calls.map(([params]) => params)).toEqual([{ page: 1, limit: 100 }, { page: 2, limit: 100 }]);
  expect(await loadOwnProducts(service, null)).toEqual([]);
});
it('carrega favoritos fora da cache e ignora produtos removidos', async () => {
  const service = { getById: vi.fn(async id => { if (id === 'deleted') throw { status: 404 }; return { id }; }) };
  expect(await loadFavoriteProducts(service, ['saved', 'deleted', 'saved'])).toEqual([{ id: 'saved' }]);
  expect(service.getById).toHaveBeenCalledTimes(2);
  expect(await loadFavoriteProducts(service, [])).toEqual([]);
});
it('não esconde falhas de rede nem aplica respostas de uma conta anterior', async () => {
  await expect(loadFavoriteProducts({ getById: async () => { throw Error('Sem ligação'); } }, ['a'])).rejects.toThrow('Sem ligação');
  let active = true;
  expect(await loadOwnProducts({ mine: async () => { active = false; return { items: [{ id: 'a', seller: 'alice' }], pagination: { pages: 2 } }; } }, 'alice', () => active)).toEqual([]);
});
