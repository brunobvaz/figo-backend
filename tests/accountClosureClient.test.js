import { expect, it, vi } from 'vitest';
import { requestAccountClosure } from '../../mobile/src/utils/accountClosure.js';
const credentials = { email: 'test@example.test', password: 'secret' };
const prepared = { userId: 'user-1', receipt: 'limited-receipt' };
it('guarda o comprovativo antes do pedido e recupera uma resposta perdida sem repetir a eliminação', async () => {
  const storage = { save: vi.fn(), clear: vi.fn() };
  const api = { post: vi.fn(async path => {
    if (path.endsWith('/deletion-receipt')) return prepared;
    if (path.endsWith('/delete')) { expect(storage.save).toHaveBeenCalledWith({ ...prepared, status: 'requesting' }); throw Error('network'); }
    return { status: 'deleted' };
  }) };
  expect(await requestAccountClosure(api, storage, 'delete', credentials)).toEqual({ ...prepared, status: 'deleted' });
  expect(api.post.mock.calls.map(([path]) => path)).toEqual(['/auth/account/deletion-receipt', '/auth/account/delete', '/auth/account/deletion-status']);
  expect(JSON.stringify(storage.save.mock.calls)).not.toContain('secret');
});
it('mantém o comprovativo quando não há ligação e não afirma que a eliminação terminou', async () => {
  const storage = { save: vi.fn(), clear: vi.fn() };
  const api = { post: vi.fn().mockResolvedValueOnce(prepared).mockRejectedValue(Error('network')) };
  expect((await requestAccountClosure(api, storage, 'delete', credentials)).status).toBe('requesting');
  expect(storage.clear).not.toHaveBeenCalled();
});
it('informa falha e descarta o comprovativo se o servidor não recebeu o pedido', async () => {
  const storage = { save: vi.fn(), clear: vi.fn() };
  const failure = Error('pedido não enviado');
  const api = { post: vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce(failure).mockRejectedValueOnce({ status: 404 }) };
  await expect(requestAccountClosure(api, storage, 'delete', credentials)).rejects.toBe(failure);
  expect(storage.clear).toHaveBeenCalledOnce();
});
it('não pede remoção se não conseguir guardar o comprovativo localmente', async () => {
  const storage = { save: vi.fn().mockRejectedValue(Error('storage')), clear: vi.fn() };
  const api = { post: vi.fn().mockResolvedValue(prepared) };
  await expect(requestAccountClosure(api, storage, 'delete', credentials)).rejects.toThrow('storage');
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('a desativação não cria um comprovativo de eliminação nem apaga dados locais', async () => {
  const storage = { save: vi.fn(), clear: vi.fn() };
  const api = { post: vi.fn().mockResolvedValue({ userId: 'user-1', status: 'deactivated' }) };
  expect((await requestAccountClosure(api, storage, 'deactivate', credentials)).status).toBe('deactivated');
  expect(api.post).toHaveBeenCalledWith('/auth/account/deactivate', { ...credentials, confirm: true });
  expect(storage.save).not.toHaveBeenCalled(); expect(storage.clear).not.toHaveBeenCalled();
});
