import { afterEach, expect, it, vi } from 'vitest';
import { mountClient } from './helpers/mountClient.js';

const response = (ids, page = 1, pages = 1) => ({ items: ids.map(id => ({ id, title: id })), pagination: { page, pages, total: pages * ids.length } });
const flush = () => vi.advanceTimersByTimeAsync(0);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const loader = api => ({ '../services/editorialService': { editorialService: { getSeasonalRecipes: api } } });
const mount = (api, filter = 'Todos') => mountClient('src/hooks/useRecipes.js', [filter], loader(api));
const ids = hook => hook.value.items.map(item => item.id);
afterEach(() => vi.useRealTimers());

it('carrega receitas reais, pagina sem duplicar e atualiza após regressar ao ecrã', async () => {
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
  const api = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(['sopa']));
  const hook = mount(api);
  await flush();
  hook.update(['Sopas']); await flush();
  expect(api.mock.calls[1][0]).toEqual({ filter: 'Sopas', page: 1 });
  expect(ids(hook)).toEqual(['sopa']);
  old.resolve(response(['antiga'])); await flush();
  expect(ids(hook)).toEqual(['sopa']);
  const late = deferred();
  api.mockReturnValue(late.promise);
  hook.value.refresh(); await flush();
  hook.unmount(); late.resolve(response(['não aplicar'])); await flush();
  expect(ids(hook)).toEqual(['sopa']);
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

it('preserva a lista numa falha de atualização e remove receitas apagadas após sucesso', async () => {
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

it('o ecrã apresenta resultados, erro, atualização e paginação sem aviso de demonstração', async () => {
  vi.useFakeTimers();
  const state = { items: [{ id: 'real', title: 'Receita real' }], busy: false, error: '', refreshing: false, hasMore: true, refresh: vi.fn(), retry: vi.fn(), loadMore: vi.fn() };
  const navigation = { navigate: vi.fn() };
  const hook = mountClient('src/screens/recipes/SeasonalRecipesScreen.js', [{ navigation }], {
    '../../hooks/useRecipes': { default: () => state },
    '../../services/editorialService': { RECIPE_FILTERS: ['Todos', 'Rápidas', 'Vegetarianas', 'Doces', 'Sopas'] }
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const cards = () => nodes(hook.value).filter(node => node.type === 'RecipeCard');
  expect(cards()[0].props.recipe.id).toBe('real');
  cards()[0].props.onPress();
  expect(navigation.navigate).toHaveBeenCalledExactlyOnceWith('RecipeDetailScreen', { recipeId: 'real' });
  expect(JSON.stringify(hook.value)).not.toContain('demonstração');
  const more = nodes(hook.value).find(node => node.type === 'Button' && node.props.title === 'Carregar mais');
  more.props.onPress(); expect(state.loadMore).toHaveBeenCalledOnce();
  hook.value.props.refreshControl.props.onRefresh(); expect(state.refresh).toHaveBeenCalledOnce();
  state.error = 'Erro de ligação'; hook.update([{ navigation }]);
  expect(cards()).toHaveLength(1);
  nodes(hook.value).find(node => node.type === 'Button' && node.props.title === 'Tentar novamente').props.onPress();
  expect(state.retry).toHaveBeenCalledOnce();
  state.error = ''; state.items = []; state.hasMore = false; hook.update([{ navigation }]);
  expect(nodes(hook.value).some(node => node.type === 'EmptyState')).toBe(true);
  hook.unmount();
});

const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const fullRecipe = { id: 'recipe', title: 'Receita com título completo', description: 'Descrição longa e completa da receita.', image: 'https://example.com/sopa.jpg',
  preparationMinutes: 30, difficulty: 'Fácil', seasonal: true, categories: ['Sopas', 'Vegetarianas'], ingredients: ['2 batatas', '1 cebola'], steps: ['Preparar os legumes.', 'Cozer e triturar.'] };

it('o card apresenta apenas fotografia, título e metadados, mantendo o acesso ao detalhe', () => {
  const press = vi.fn();
  const card = mountClient('src/components/common/RecipeCard.js', [{ recipe: fullRecipe, onPress: press }]);
  const text = nodes(card.value).filter(node => node.type === 'Text');
  expect(text.map(node => node.props.children)).toEqual([fullRecipe.title]);
  expect(text[0].props.numberOfLines).toBe(2);
  expect(nodes(card.value).some(node => node.props.image === fullRecipe.image)).toBe(true);
  expect(nodes(card.value).some(node => node.props.recipe === fullRecipe)).toBe(true);
  card.value.props.onPress(); expect(press).toHaveBeenCalledOnce();
  card.unmount();
});

it('o detalhe carrega por id, repete erros, atualiza ao regressar e trata uma receita entretanto eliminada', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockRejectedValueOnce(new Error('Sem rede')).mockResolvedValueOnce(fullRecipe)
    .mockRejectedValue(Object.assign(new Error('Esta receita já não está disponível.'), { status: 404 }));
  const hook = mountClient('src/hooks/useRecipe.js', ['recipe'], { '../services/recipeService': { recipeService: { detail: api } } });
  await flush();
  expect(hook.value).toMatchObject({ busy: false, recipe: null, error: 'Sem rede', notFound: false });
  hook.value.retry(); await flush();
  expect(hook.value.recipe).toEqual(fullRecipe);
  hook.appState('background'); await flush();
  hook.appState('active'); await flush();
  expect(hook.value).toMatchObject({ busy: false, recipe: null, notFound: true });
  expect(api.mock.calls).toEqual([['recipe'], ['recipe'], ['recipe']]);
  hook.unmount();
});

it('não substitui o detalhe atual com respostas de outra receita nem aplica respostas após sair', async () => {
  vi.useFakeTimers();
  const old = deferred(); const late = deferred();
  const api = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...fullRecipe, id: 'other' }).mockReturnValue(late.promise);
  const hook = mountClient('src/hooks/useRecipe.js', ['recipe'], { '../services/recipeService': { recipeService: { detail: api } } });
  hook.update(['other']); await flush();
  old.resolve(fullRecipe); await flush();
  expect(hook.value.recipe.id).toBe('other');
  hook.value.retry(); await flush();
  hook.unmount(); late.resolve(fullRecipe); await flush();
  expect(hook.value.recipe).toBeNull();
});

it('apresenta toda a informação no detalhe, passos ordenados, ausência de preparação e estados de erro', () => {
  const state = { recipe: fullRecipe, busy: false, error: '', notFound: false, retry: vi.fn() };
  const navigation = { goBack: vi.fn() }; const args = [{ route: { params: { recipeId: 'recipe' } }, navigation }];
  const hook = mountClient('src/screens/recipes/RecipeDetailScreen.js', args, { '../../hooks/useRecipe': { default: () => state } });
  const text = () => nodes(hook.value).filter(node => node.type === 'Text').map(node => node.props.children);
  expect(text()).toEqual(expect.arrayContaining([fullRecipe.title, fullRecipe.description, ...fullRecipe.categories, ...fullRecipe.ingredients, ...fullRecipe.steps, 1, 2]));
  expect(text().indexOf(fullRecipe.steps[0])).toBeLessThan(text().indexOf(fullRecipe.steps[1]));
  state.recipe = { ...fullRecipe, steps: [] }; hook.update(args);
  expect(text()).toContain('O modo de preparação ainda não foi adicionado.');
  state.recipe = null; state.error = 'Sem rede'; hook.update(args);
  let empty = nodes(hook.value).find(node => node.type === 'EmptyState');
  expect(empty.props.actionLabel).toBe('Tentar novamente'); empty.props.onAction(); expect(state.retry).toHaveBeenCalledOnce();
  state.notFound = true; hook.update(args);
  empty = nodes(hook.value).find(node => node.type === 'EmptyState');
  expect(empty.props.title).toBe('Receita indisponível'); empty.props.onAction(); expect(navigation.goBack).toHaveBeenCalledOnce();
  hook.unmount();
});
