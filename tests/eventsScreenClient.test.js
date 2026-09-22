import { afterEach, expect, it, vi } from 'vitest';
import { mountClient } from './helpers/mountClient.js';

const response = (ids, page = 1, pages = 1) => ({ items: ids.map(id => ({ id, title: id })), pagination: { page, pages, total: pages * ids.length } });
const flush = () => vi.advanceTimersByTimeAsync(0);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const loader = api => ({ '../services/editorialService': { editorialService: { getLocalEvents: api } } });
const mount = (api, filter = 'Todos') => mountClient('src/hooks/useEvents.js', [filter], loader(api));
const ids = hook => hook.value.items.map(item => item.id);
afterEach(() => vi.useRealTimers());

it('carrega eventos reais, pagina sem duplicar e atualiza após regressar ao ecrã', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValueOnce(response(['a', 'b'], 1, 2)).mockResolvedValueOnce(response(['b', 'c'], 2, 2)).mockResolvedValue(response(['nova']));
  const hook = mount(api);
  await flush();
  expect(ids(hook)).toEqual(['a', 'b']);
  expect(hook.value.hasMore).toBe(true);
  await hook.value.loadMore(); await flush();
  expect(ids(hook)).toEqual(['a', 'b', 'c']);
  expect(hook.value.hasMore).toBe(false);
  hook.focus(false); await flush();
  expect(api).toHaveBeenCalledTimes(2);
  hook.focus(true); await flush();
  expect(ids(hook)).toEqual(['nova']);
  expect(api.mock.calls.map(([params]) => params.page)).toEqual([1, 2, 1]);
  hook.unmount();
});

it('ignora pedidos atrasados quando o filtro muda ou o ecrã é desmontado', async () => {
  vi.useFakeTimers();
  const old = deferred();
  const api = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(['feira']));
  const hook = mount(api);
  await flush();
  hook.update(['Feiras']); await flush();
  expect(api.mock.calls[1][0]).toEqual({ filter: 'Feiras', page: 1 });
  expect(ids(hook)).toEqual(['feira']);
  old.resolve(response(['antiga'])); await flush();
  expect(ids(hook)).toEqual(['feira']);
  const late = deferred();
  api.mockReturnValue(late.promise);
  hook.value.refresh(); await flush();
  hook.unmount(); late.resolve(response(['não aplicar'])); await flush();
  expect(ids(hook)).toEqual(['feira']);
});

it('permite repetir a página que falhou sem apagar resultados nem usar mocks', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockRejectedValueOnce(new Error('Sem ligação')).mockResolvedValueOnce(response(['a'], 1, 2)).mockRejectedValueOnce(new Error('Falha na página 2')).mockResolvedValue(response(['b'], 2, 2));
  const hook = mount(api);
  await flush();
  expect(hook.value).toMatchObject({ items: [], busy: false, error: 'Sem ligação' });
  await hook.value.retry(); await flush();
  await hook.value.loadMore(); await flush();
  expect(ids(hook)).toEqual(['a']);
  expect(hook.value.error).toBe('Falha na página 2');
  await hook.value.retry(); await flush();
  expect(ids(hook)).toEqual(['a', 'b']);
  expect(api.mock.calls.map(([params]) => params.page)).toEqual([1, 1, 2, 2]);
  hook.unmount();
});

it('preserva a lista numa falha de atualização e remove eventos apagados após sucesso', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValueOnce(response(['a', 'apagada'])).mockRejectedValueOnce(new Error('Sem rede')).mockResolvedValue(response(['a']));
  const hook = mount(api);
  await flush();
  await hook.value.refresh(); await flush();
  expect(ids(hook)).toEqual(['a', 'apagada']);
  expect(hook.value.error).toBe('Sem rede');
  await hook.value.retry(); await flush();
  expect(ids(hook)).toEqual(['a']);
  expect(hook.value.error).toBe('');
  hook.appState('background'); await flush();
  hook.appState('active'); await flush();
  expect(api).toHaveBeenCalledTimes(4);
  hook.unmount();
});

const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const fullEvent = { id: 'event', title: 'Feira do backoffice', description: 'Descrição completa da feira.', image: 'https://example.com/feira.jpg',
  type: 'Feira', date: '2026-09-27', startTime: '09:00', endTime: '18:00', location: 'Chaves', distanceKm: 0, free: true };

it('apresenta eventos reais, navega por id, filtra e permite atualizar, paginar e repetir erros', () => {
  const state = { items: [fullEvent], busy: false, error: '', refreshing: false, hasMore: true, refresh: vi.fn(), retry: vi.fn(), loadMore: vi.fn() };
  const useEvents = vi.fn(() => state);
  const navigation = { navigate: vi.fn() };
  const hook = mountClient('src/screens/events/FairsEventsScreen.js', [{ navigation }], {
    '../../hooks/useEvents': { default: useEvents },
    '../../services/editorialService': { EVENT_FILTERS: ['Todos', 'Esta semana', 'Este mês', 'Feiras', 'Mercados'] }
  });
  const card = () => nodes(hook.value).find(node => node.type === 'EventCard');
  expect(card().props.event).toBe(fullEvent);
  card().props.onPress();
  expect(navigation.navigate).toHaveBeenCalledExactlyOnceWith('EventDetailScreen', { eventId: 'event' });
  expect(JSON.stringify(hook.value)).not.toMatch(/demonstração|fictícios|Próximos de ti/);
  nodes(hook.value).find(node => node.type === 'Chip' && node.props.label === 'Feiras').props.onPress();
  hook.update([{ navigation }]);
  expect(useEvents).toHaveBeenLastCalledWith('Feiras');
  nodes(hook.value).find(node => node.type === 'Button' && node.props.title === 'Carregar mais').props.onPress();
  expect(state.loadMore).toHaveBeenCalledOnce();
  hook.value.props.refreshControl.props.onRefresh(); expect(state.refresh).toHaveBeenCalledOnce();
  state.error = 'Sem ligação'; hook.update([{ navigation }]);
  expect(card()).toBeDefined();
  nodes(hook.value).find(node => node.type === 'Button' && node.props.title === 'Tentar novamente').props.onPress();
  expect(state.retry).toHaveBeenCalledOnce();
  state.error = ''; state.items = []; state.hasMore = false; hook.update([{ navigation }]);
  expect(nodes(hook.value).find(node => node.type === 'EmptyState').props.message).toBe('Experimenta alterar o período ou tipo de evento.');
  nodes(hook.value).find(node => node.type === 'Button' && node.props.title === 'Ver todos').props.onPress();
  hook.update([{ navigation }]);
  expect(nodes(hook.value).find(node => node.type === 'EmptyState').props.message).toContain('Ainda não há eventos');
  state.busy = true; hook.update([{ navigation }]);
  expect(nodes(hook.value).some(node => node.type === 'LoadingIndicator')).toBe(true);
  hook.unmount();
});

it('o detalhe repete erros, atualiza ao regressar e trata eventos eliminados', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockRejectedValueOnce(new Error('Sem rede')).mockResolvedValueOnce(fullEvent)
    .mockRejectedValue(Object.assign(new Error('Este evento já não está disponível.'), { status: 404 }));
  const hook = mountClient('src/hooks/useEvent.js', ['event'], { '../services/eventService': { eventService: { detail: api } } });
  await flush();
  expect(hook.value).toMatchObject({ busy: false, event: null, error: 'Sem rede', notFound: false });
  hook.value.retry(); await flush();
  expect(hook.value.event).toEqual(fullEvent);
  hook.appState('background'); await flush();
  hook.appState('active'); await flush();
  expect(hook.value).toMatchObject({ busy: false, event: null, notFound: true });
  expect(api.mock.calls).toEqual([['event'], ['event'], ['event']]);
  hook.unmount();
});

it('ignora detalhes atrasados de outro evento ou depois de sair do ecrã', async () => {
  vi.useFakeTimers();
  const old = deferred(); const late = deferred();
  const api = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...fullEvent, id: 'other' }).mockReturnValue(late.promise);
  const hook = mountClient('src/hooks/useEvent.js', ['event'], { '../services/eventService': { eventService: { detail: api } } });
  hook.update(['other']); await flush();
  old.resolve(fullEvent); await flush();
  expect(hook.value.event.id).toBe('other');
  hook.value.retry(); await flush();
  hook.unmount(); late.resolve(fullEvent); await flush();
  expect(hook.value.event).toBeNull();
});

it('mostra descrição e dados completos no detalhe e ações para falhas ou eventos eliminados', () => {
  const state = { event: fullEvent, busy: false, error: '', notFound: false, retry: vi.fn() };
  const navigation = { goBack: vi.fn() }; const args = [{ route: { params: { eventId: 'event' } }, navigation }];
  const hook = mountClient('src/screens/events/EventDetailScreen.js', args, { '../../hooks/useEvent': { default: () => state } });
  const text = () => nodes(hook.value).filter(node => node.type === 'Text').map(node => node.props.children);
  expect(text()).toEqual(expect.arrayContaining([fullEvent.title, fullEvent.description, fullEvent.type, 'domingo, 27 de setembro de 2026']));
  expect(nodes(hook.value).some(node => node.props.event === fullEvent)).toBe(true);
  expect(nodes(hook.value).some(node => node.props.image === fullEvent.image)).toBe(true);
  expect(hook.value.props.children[0].type).toBe('EventPoster');
  state.event = null; state.error = 'Sem rede'; hook.update(args);
  let empty = nodes(hook.value).find(node => node.type === 'EmptyState');
  expect(empty.props.actionLabel).toBe('Tentar novamente'); empty.props.onAction(); expect(state.retry).toHaveBeenCalledOnce();
  state.notFound = true; hook.update(args);
  empty = nodes(hook.value).find(node => node.type === 'EmptyState');
  expect(empty.props.title).toBe('Evento indisponível'); empty.props.onAction(); expect(navigation.goBack).toHaveBeenCalledOnce();
  hook.unmount();
});

it('identifica a distância como referência e omite informação opcional ausente', () => {
  const hook = mountClient('src/components/common/EventMeta.js', [{ event: fullEvent }]);
  const text = () => JSON.stringify(nodes(hook.value).filter(node => node.type === 'Text').map(node => node.props.children));
  expect(text()).toContain('Distância de referência: ');
  expect(text()).toContain('Grátis');
  expect(text()).toContain('18:00');
  hook.update([{ event: { ...fullEvent, distanceKm: null, endTime: null, free: false } }]);
  expect(text()).not.toMatch(/Distância|Grátis|18:00/);
  expect(text()).toContain('09:00');
  hook.unmount();
});

it('tolera fotografias ausentes ou falhadas e volta a mostrar uma nova fotografia', () => {
  const hook = mountClient('src/components/common/EventPhoto.js', [{ image: null }]);
  expect(hook.value).toBeNull();
  hook.update([{ image: fullEvent.image }]);
  expect(hook.value.props.source).toEqual({ uri: fullEvent.image });
  hook.value.props.onError(); hook.update([{ image: fullEvent.image }]);
  expect(hook.value).toBeNull();
  hook.update([{ image: 'https://example.com/nova.jpg' }]);
  expect(hook.value.props.source.uri).toContain('nova.jpg');
  hook.unmount();
});

it('agrega cliques repetidos em carregar mais e atualiza após a paginação pendente', async () => {
  vi.useFakeTimers();
  const more = deferred();
  const api = vi.fn().mockResolvedValueOnce(response(['a'], 1, 2)).mockReturnValueOnce(more.promise).mockResolvedValue(response(['nova']));
  const hook = mount(api);
  await flush();
  const first = hook.value.loadMore();
  hook.value.loadMore();
  const refresh = hook.value.refresh();
  more.resolve(response(['b'], 2, 2));
  await first; await refresh; await flush();
  expect(api.mock.calls.map(([params]) => params.page)).toEqual([1, 2, 1]);
  expect(ids(hook)).toEqual(['nova']);
  hook.unmount();
});
