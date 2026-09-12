import { expect, it, vi } from 'vitest';
import { canOpenConversationProduct, loadConversationProduct } from '../../mobile/src/utils/conversationProduct.js';

it('usa o produto persistido na conversa em vez de um parâmetro desatualizado', async () => {
  const product = { id: 'correct', title: 'Mel Caseiro', price: 7.4, unit: '€/frasco', image: 'mel.jpg', status: 'active' };
  const products = { getById: vi.fn().mockResolvedValue(product) };
  const result = await loadConversationProduct({ conversationId: 'chat', productId: 'wrong' }, { detail: async () => ({ productId: 'correct', productTitle: 'Mel' }) }, products);
  expect(products.getById).toHaveBeenCalledWith('correct');
  expect(result).toEqual({ title: 'Mel Caseiro', product, productId: 'correct' });
  expect(canOpenConversationProduct(result.product)).toBe(true);
});
it('usa o produto de origem enquanto a conversa está a ser criada', async () => {
  const detail = vi.fn();
  const products = { getById: vi.fn().mockResolvedValue({ id: 'p', title: 'Mel', status: 'active' }) };
  expect((await loadConversationProduct({ productId: 'p' }, { detail }, products)).productId).toBe('p');
  expect(detail).not.toHaveBeenCalled();
});
it('preserva título e associação de um produto removido sem devolver erro técnico', async () => {
  const result = await loadConversationProduct({ conversationId: 'chat' }, { detail: async () => ({ productId: 'removed', productTitle: 'Mel Caseiro' }) }, { getById: async () => { throw Error('404 técnico'); } });
  expect(result).toEqual({ title: 'Mel Caseiro', product: null, productId: 'removed' });
  expect(canOpenConversationProduct(result.product)).toBe(false);
});
it('não abre o produto do route quando falha a consulta da conversa', async () => {
  const products = { getById: vi.fn() };
  const result = await loadConversationProduct({ conversationId: 'chat', productId: 'wrong', productTitle: 'Mel' }, { detail: async () => { throw Error('Offline'); } }, products);
  expect(products.getById).not.toHaveBeenCalled();
  expect(result.product).toBeNull();
  expect(result.title).toBe('Mel');
});
it('permite detalhe de produtos vendidos e desativa produtos removidos ou ausentes', () => {
  expect(canOpenConversationProduct({ status: 'sold' })).toBe(true);
  expect(canOpenConversationProduct({ status: 'deleted' })).toBe(false);
  expect(canOpenConversationProduct(null)).toBe(false);
});
it('trata conversas antigas sem referência de produto', async () => {
  const products = { getById: vi.fn() };
  expect((await loadConversationProduct({ conversationId: 'old' }, { detail: async () => ({}) }, products)).product).toBeNull();
  expect(products.getById).not.toHaveBeenCalled();
});
