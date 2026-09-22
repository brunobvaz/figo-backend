import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../mobile/src/services/api.js';
import { eventService } from '../../mobile/src/services/eventService.js';
import { eventFilterParams, localEventDate } from '../../mobile/src/utils/eventDates.js';
import { eventImageUrl } from '../../mobile/src/utils/eventImages.js';

vi.mock('../../mobile/src/services/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../../mobile/src/config/config.js', () => ({ default: { apiBaseUrl: 'http://10.0.2.2:3000/api/v1' } }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
const id = '000000000000000000000001';
const image = `/api/v1/events/${id}/image?v=5666c564-b942-4628-97af-90b98d659ec3`;
const event = { id, image, title: 'Evento do backoffice', date: '2026-09-27', startTime: '09:00', description: 'Descrição completa.', location: 'Chaves' };
const payload = { items: [event], pagination: { page: 1, pages: 1, total: 1 } };

it('lê a lista e detalhe públicos e resolve a imagem para o servidor configurado no dispositivo', async () => {
  api.get.mockResolvedValueOnce(payload).mockResolvedValueOnce(event);
  expect((await eventService.page()).items[0]).toEqual({ ...event, image: `http://10.0.2.2:3000${image}` });
  expect(await eventService.detail(id)).toEqual({ ...event, image: `http://10.0.2.2:3000${image}` });
  expect(api.get.mock.calls).toEqual([['/events?page=1&limit=20'], [`/events/${id}`]]);
  expect(event.image).toBe(image);
});

it.each([
  ['Feiras', 'type=Feira'], ['Mercados', 'type=Mercado'],
  ['Esta semana', 'from=2026-09-14&to=2026-09-20'], ['Este mês', 'from=2026-09-01&to=2026-09-30']
])('envia o filtro %s para o servidor antes da paginação', async (filter, query) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 16, 12));
  api.get.mockResolvedValue(payload);
  await eventService.page({ filter, page: 2 });
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`/events?page=2&limit=20&${query}`);
});

it('calcula dias locais, semanas de segunda a domingo e meses na mudança de ano e ano bissexto', () => {
  expect(eventFilterParams('Esta semana', new Date(2026, 8, 20, 23, 59))).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  expect(eventFilterParams('Esta semana', new Date(2027, 0, 1))).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  expect(eventFilterParams('Este mês', new Date(2028, 1, 29))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  expect(eventFilterParams('Este mês', new Date(2026, 11, 31))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  const date = localEventDate('2026-09-27');
  expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 27]);
});

it('mantém a base vazia e propaga erros de ligação ou eliminação sem recorrer a mocks', async () => {
  const missing = Object.assign(new Error('Evento indisponível'), { status: 404 });
  api.get.mockResolvedValueOnce({ items: [], pagination: { page: 1, pages: 0, total: 0 } })
    .mockRejectedValueOnce(new Error('Sem ligação')).mockRejectedValueOnce(missing);
  expect((await eventService.page()).items).toEqual([]);
  await expect(eventService.page()).rejects.toThrow('Sem ligação');
  await expect(eventService.detail(id)).rejects.toBe(missing);
  api.get.mockResolvedValue({});
  await expect(eventService.page()).rejects.toThrow('Não foi possível ler os eventos');
  await expect(eventService.detail(id)).rejects.toThrow('Não foi possível ler este evento');
});

it('aceita URLs HTTPS e imagens públicas locais, rejeitando formatos inválidos e rotas administrativas locais', () => {
  expect(eventImageUrl('https://example.com/feira.jpg', 'https://figo-backend.onrender.com/api/v1')).toBe('https://example.com/feira.jpg');
  expect(eventImageUrl(image, 'https://figo-backend.onrender.com/api/v1')).toBe(`https://figo-backend.onrender.com${image}`);
  for (const value of [null, 1, 'javascript:alert(1)', 'http://example.com/image.jpg', '//example.com/image.jpg', `/api/v1/admin/events/${id}/image`, 'https://user:password@example.com/a.jpg'])
    expect(eventImageUrl(value, 'http://localhost:3000/api/v1')).toBeNull();
});
