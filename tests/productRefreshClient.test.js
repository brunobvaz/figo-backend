import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mergeProductCache } from '../../mobile/src/utils/productCache.js';

const mobile = fileURLToPath(new URL('../../mobile/', import.meta.url));
const nativeRequire = createRequire(path.join(mobile, 'package.json'));
const { transformSync } = nativeRequire('@babel/core');

// Execute the actual hooks with render/effect cleanup and controllable native
// lifecycle events. Native views are lightweight hosts, as in the component tests.
function mountClient(entry, initialArgs, overrides = {}) {
  let cursor = 0, result, args = initialArgs, focused = true, alive = true, queued = false;
  const slots = [], effects = [], listeners = new Set(), modules = new Map();
  const schedule = () => {
    if (queued || !alive) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; if (alive) render(); });
  };
  const changed = (previous, deps) => !previous || !deps || deps.length !== previous.deps?.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]));
  const react = {
    ...nativeRequire('react'),
    useState(initial) {
      const key = cursor++;
      if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[key].value, update => {
        const value = typeof update === 'function' ? update(slots[key].value) : update;
        if (!Object.is(value, slots[key].value)) { slots[key].value = value; schedule(); }
      }];
    },
    useRef(initial) { const key = cursor++; return slots[key] ||= { current: initial }; },
    useMemo(compute, deps) {
      const key = cursor++;
      if (changed(slots[key], deps)) slots[key] = { value: compute(), deps };
      return slots[key].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const key = cursor++;
      if (changed(slots[key], deps)) effects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: effect() }; });
    }
  };
  const AppState = { currentState: 'active', addEventListener: (_, callback) => {
    listeners.add(callback); return { remove: () => listeners.delete(callback) };
  } };
  const cache = { products: [], homeProducts: [], cacheProducts(items) { cache.products = mergeProductCache(cache.products, items); schedule(); } };
  const mocks = {
    react,
    'react-native': { AppState, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ fontScale: 1 }),
      ...Object.fromEntries(['Text', 'View', 'Pressable', 'ScrollView', 'RefreshControl'].map(name => [name, name])) },
    '@react-navigation/native': { useIsFocused: () => focused },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    './useProducts': { default: () => cache },
    '../../hooks/useProducts': { default: () => cache },
    '../../hooks/useAuth': { default: () => ({ user: { name: 'Teste' } }) },
    '../../context/ActiveLocationContext': { useActiveLocation: () => ({ region: {}, activeLocation: null }) },
    ...overrides
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const code = transformSync(fs.readFileSync(file, 'utf8'), { filename: file, babelrc: false, configFile: false,
      plugins: [[nativeRequire.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], nativeRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    const require = name => {
      if (name in mocks) return mocks[name];
      if (name.includes('/components/')) return { __esModule: true, default: name.split('/').at(-1) };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.js`));
      return nativeRequire(name);
    };
    // Babel default imports distinguish ES-module mocks from CommonJS modules.
    for (const mock of Object.values(mocks)) if (mock?.default) mock.__esModule = true;
    new Function('require', 'module', 'exports', code)(require, module, module.exports);
    modules.set(file, module.exports);
    return module.exports;
  }
  const component = load(path.join(mobile, entry)).default;
  function render() { cursor = 0; result = component(...args); effects.splice(0).forEach(effect => effect()); }
  render();
  return {
    get value() { return result; }, cache,
    update(nextArgs) { args = nextArgs; render(); },
    focus(value) { focused = value; render(); },
    appState(value) { AppState.currentState = value; listeners.forEach(listener => listener(value)); },
    unmount() { alive = false; slots.forEach(slot => slot?.cleanup?.()); }
  };
}

const page = (ids, number = 1, total = ids.length, pages = 1) => ({
  items: ids.map(id => ({ id, title: id, updatedAt: '2026-09-17T10:00:00Z' })),
  pagination: { page: number, total, pages }
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const ids = hook => hook.value.products.map(item => item.id);
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function explore(api, filters = {}, coordinates = null, region = {}, enabled = true) {
  return mountClient('src/hooks/useExploreProducts.js', [filters, coordinates, region, enabled], { '../services/productService': { productService: { page: api } } });
}
afterEach(() => vi.useRealTimers());

it('apresenta anúncios de outro dispositivo após 30 segundos sem perder filtros', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValue(page(['old']));
  const hook = explore(api, { category: 'Mel', minPrice: 2, sellerId: 'seller', sortBy: 'price_asc' });
  await flush();
  expect(ids(hook)).toEqual(['old']);
  api.mockResolvedValue(page(['new', 'old']));
  await vi.advanceTimersByTimeAsync(29999);
  expect(api).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(ids(hook)).toEqual(['new', 'old']);
  expect(api.mock.calls[1][0]).toMatchObject({ category: 'Mel', minPrice: 2, sellerId: 'seller', sort: 'price_asc', page: 1 });
  expect(hook.value.refreshing).toBe(false);
  hook.unmount();
});

it('suspende consultas ao sair do ecrã ou da app e atualiza ao regressar', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValue(page(['old']));
  const hook = explore(api);
  await flush();
  hook.focus(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(api).toHaveBeenCalledTimes(1);
  api.mockResolvedValue(page(['new']));
  hook.focus(true);
  await flush();
  expect(ids(hook)).toEqual(['new']);
  hook.appState('background');
  await vi.advanceTimersByTimeAsync(60000);
  expect(api).toHaveBeenCalledTimes(2);
  hook.appState('active');
  await flush();
  expect(api).toHaveBeenCalledTimes(3);
  hook.unmount();
  await vi.advanceTimersByTimeAsync(60000);
  expect(api).toHaveBeenCalledTimes(3);
});

it('renova todas as páginas carregadas e remove anúncios que deixaram de estar na pesquisa', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValueOnce(page(['a', 'b'], 1, 4, 2)).mockResolvedValueOnce(page(['c', 'd'], 2, 4, 2));
  const hook = explore(api);
  await flush();
  await hook.value.loadMore(); await flush();
  expect(ids(hook)).toEqual(['a', 'b', 'c', 'd']);
  const pending = deferred();
  api.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['d'], 2, 3, 2));
  const refresh = hook.value.refresh(); await flush();
  expect(hook.value.refreshing).toBe(true);
  expect(ids(hook)).toEqual(['a', 'b', 'c', 'd']);
  pending.resolve(page(['new', 'a'], 1, 3, 2));
  await refresh; await flush();
  expect(ids(hook)).toEqual(['new', 'a', 'd']);
  expect(api.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 1, 2]);
  expect(hook.value).toMatchObject({ total: 3, hasMore: false, refreshing: false });
  hook.unmount();
});

it('ignora respostas antigas e mantém a espera de 300 ms ao escrever uma pesquisa', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const api = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(page(['mel']));
  const hook = explore(api);
  await flush();
  hook.update([{ query: 'm' }, null, {}, true]);
  await vi.advanceTimersByTimeAsync(100);
  hook.update([{ query: 'mel' }, null, {}, true]);
  pending.resolve(page(['stale']));
  await vi.advanceTimersByTimeAsync(299);
  expect(api).toHaveBeenCalledTimes(1);
  expect(hook.cache.products).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(2);
  expect(api.mock.calls[1][0].search).toBe('mel');
  expect(ids(hook)).toEqual(['mel']);
  hook.unmount();
});

it('mantém produtos numa falha de atualização e permite tentar novamente a primeira página', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValueOnce(page(['old'], 1, 30, 2)).mockRejectedValueOnce(new Error('Sem ligação')).mockResolvedValue(page(['new']));
  const hook = explore(api);
  await flush();
  await hook.value.refresh(); await flush();
  expect(ids(hook)).toEqual(['old']);
  expect(hook.value).toMatchObject({ refreshing: false, busy: false, error: 'Sem ligação' });
  await hook.value.retry(); await flush();
  expect(api.mock.calls.map(([query]) => query.page)).toEqual([1, 1, 1]);
  expect(ids(hook)).toEqual(['new']);
  hook.unmount();
});

it('espera pela paginação em curso antes de atualizar e partilha atualizações simultâneas', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const api = vi.fn().mockResolvedValueOnce(page(['old'], 1, 2, 2)).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(page(['new', 'old'], 1, 2, 1));
  const hook = explore(api);
  await flush();
  hook.value.loadMore();
  const refresh = hook.value.refresh();
  const sameRefresh = hook.value.refresh();
  expect(api).toHaveBeenCalledTimes(2);
  pending.resolve(page(['older'], 2, 2, 2));
  await Promise.all([refresh, sameRefresh]); await flush();
  expect(api.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 1]);
  expect(ids(hook)).toEqual(['new', 'old']);
  hook.unmount();
});

it('só atualiza Perto de ti quando existe localização e preserva a região', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValue(page(['nearby']));
  const filters = { radiusKm: 10, sortBy: 'distance' };
  const hook = explore(api, filters, null, {}, false);
  await vi.advanceTimersByTimeAsync(60000);
  await hook.value.refresh();
  expect(api).not.toHaveBeenCalled();
  hook.update([filters, null, { municipalityCode: '0302' }, true]);
  await flush();
  expect(api.mock.calls[0][0]).toMatchObject({ municipalityCode: '0302', sort: 'recent' });
  expect(ids(hook)).toEqual(['nearby']);
  hook.unmount();
});

it('atualiza o Início automaticamente e renova também Perto de ti no gesto de atualizar', async () => {
  vi.useFakeTimers();
  const refreshProducts = vi.fn().mockResolvedValue(undefined);
  const refreshNearby = vi.fn().mockResolvedValue(undefined);
  const refreshFeatured = vi.fn().mockResolvedValue(undefined);
  const hook = mountClient('src/screens/home/HomeScreen.js', [{ navigation: {} }], {
    '../../hooks/useProducts': { default: () => ({ homeProducts: [], refreshProducts, isLoading: false }) },
    '../../hooks/useExploreProducts': { default: filters => ({ products: [], refresh: filters.featured ? refreshFeatured : refreshNearby }) }
  });
  await flush();
  expect(refreshProducts).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);
  expect(refreshProducts).toHaveBeenCalledTimes(2);
  const pending = deferred();
  refreshNearby.mockReturnValueOnce(pending.promise);
  const refresh = hook.value.props.refreshControl.props.onRefresh(); await flush();
  expect(hook.value.props.refreshControl.props.refreshing).toBe(true);
  expect(refreshNearby).toHaveBeenCalledOnce();
  expect(refreshFeatured).toHaveBeenCalledOnce();
  pending.resolve(); await refresh; await flush();
  expect(hook.value.props.refreshControl.props.refreshing).toBe(false);
  hook.focus(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(refreshProducts).toHaveBeenCalledTimes(3);
  hook.focus(true); await flush();
  expect(refreshProducts).toHaveBeenCalledTimes(4);
  hook.appState('background'); await vi.advanceTimersByTimeAsync(60000);
  expect(refreshProducts).toHaveBeenCalledTimes(4);
  hook.appState('active'); await flush();
  expect(refreshProducts).toHaveBeenCalledTimes(5);
  hook.unmount();
});


it('a secção Destaques consulta a seleção do servidor e retira anúncios desmarcados sem preencher com os recentes', async () => {
  vi.useFakeTimers();
  const featured = { id: 'old-featured', title: 'Antigo em destaque', featured: true, is_active: true, status: 'active', updatedAt: '2026-09-17T10:00:00Z' };
  const api = vi.fn().mockResolvedValue({ items: [featured], pagination: { page: 1, total: 1, pages: 1 } });
  const refreshProducts = vi.fn().mockResolvedValue(undefined);
  const home = mountClient('src/screens/home/HomeScreen.js', [{ navigation: {} }], {
    '../../hooks/useProducts': { default: () => ({ homeProducts: [{ id: 'recent', title: 'Recente normal' }], refreshProducts, isLoading: false }) },
    '../services/productService': { productService: { page: api } }
  });
  const shelves = node => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(shelves);
    return [...(node.type === 'ProductShelf' && node.props.variant === 'featured' ? [node] : []), ...shelves(node.props?.children)];
  };
  await flush();
  expect(api.mock.calls[0][0]).toMatchObject({ featured: true, page: 1 });
  expect(shelves(home.value)[0].props.products.map(item => item.id)).toEqual(['old-featured']);
  api.mockResolvedValue({ items: [], pagination: { page: 1, total: 0, pages: 0 } });
  await vi.advanceTimersByTimeAsync(30000);
  expect(shelves(home.value)).toHaveLength(0);
  home.unmount();
});
