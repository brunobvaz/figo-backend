import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('../../mobile/', import.meta.url));
const nativeRequire = createRequire(path.join(mobile, 'package.json'));
const { transformSync } = nativeRequire('@babel/core');
const file = path.join(mobile, 'src/context/ChatContext.js');
const code = transformSync(fs.readFileSync(file, 'utf8'), {
  babelrc: false, configFile: false, filename: file,
  plugins: [[nativeRequire.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], nativeRequire.resolve('@babel/plugin-transform-modules-commonjs')]
}).code;

// Run the real provider with persistent hook slots and an explicit render/commit,
// so races and AppState events can be controlled without a native runtime.
function provider(list) {
  let index = 0;
  const slots = [], effects = [];
  const react = {
    ...nativeRequire('react'),
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = initial;
      return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }];
    },
    useRef(initial) {
      const key = index++;
      return slots[key] ||= { current: initial };
    },
    useCallback(callback, deps) {
      const key = index++;
      if (!slots[key] || deps.some((dep, i) => !Object.is(dep, slots[key].deps[i]))) slots[key] = { callback, deps };
      return slots[key].callback;
    },
    useEffect(effect, deps) {
      const key = index++;
      if (!slots[key] || deps.some((dep, i) => !Object.is(dep, slots[key].deps[i]))) {
        effects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: effect() }; });
      }
    }
  };
  const listeners = new Set();
  const AppState = { currentState: 'active', addEventListener: (_, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  } };
  const module = { exports: {} };
  const require = name => name === 'react' ? react : name === 'react-native' ? { AppState }
    : name === '../services/chatService' ? { chatService: { list } } : nativeRequire(name);
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const render = () => { index = 0; return module.exports.ChatProvider({ children: null }).props.value; };
  render();
  effects.splice(0).forEach(effect => effect());
  return {
    value: render,
    changeAppState(state) { AppState.currentState = state; listeners.forEach(listener => listener(state)); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

const page = (unreadTotal, items = []) => ({ items, unreadTotal, pagination: { total: items.length } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());

it('atualiza o total ao receber mensagens e ao regressar do segundo plano', async () => {
  vi.useFakeTimers();
  const list = vi.fn().mockResolvedValue(page(0));
  const chat = provider(list);
  await flush();
  expect(chat.value().unreadTotal).toBe(0);
  list.mockResolvedValue(page(2, [{ id: 'conversation', unreadCount: 2 }]));
  await vi.advanceTimersByTimeAsync(8000);
  expect(chat.value().unreadTotal).toBe(2);
  expect(chat.value().conversations[0].unreadCount).toBe(2);
  chat.changeAppState('background');
  await vi.advanceTimersByTimeAsync(16000);
  expect(list).toHaveBeenCalledTimes(2);
  list.mockResolvedValue(page(3));
  chat.changeAppState('active');
  await flush();
  expect(chat.value().unreadTotal).toBe(3);
  chat.unmount();
});

it.each([
  ['uma mensagem recebida', 0, 1],
  ['uma confirmação de leitura', 3, 0]
])('não perde %s durante uma consulta em curso', async (_, staleCount, currentCount) => {
  vi.useFakeTimers();
  const pending = deferred();
  const list = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(page(currentCount));
  const chat = provider(list);
  const notification = chat.value().refresh();
  const anotherNotification = chat.value().refresh();
  expect(list).toHaveBeenCalledTimes(1);
  expect(notification).toBe(anotherNotification);
  pending.resolve(page(staleCount));
  await notification;
  expect(list).toHaveBeenCalledTimes(2);
  expect(chat.value().unreadTotal).toBe(currentCount);
  chat.unmount();
});

it('preserva a contagem durante uma falha de rede e recupera na consulta seguinte', async () => {
  vi.useFakeTimers();
  const list = vi.fn().mockResolvedValue(page(4));
  const chat = provider(list);
  await flush();
  list.mockRejectedValueOnce(new Error('Sem ligação'));
  await chat.value().refresh();
  expect(chat.value()).toMatchObject({ unreadTotal: 4, error: 'Sem ligação', loading: false });
  list.mockResolvedValue(page(0));
  await chat.value().refresh();
  expect(chat.value()).toMatchObject({ unreadTotal: 0, error: null });
  chat.unmount();
});

it('descarta respostas e atualizações pendentes quando termina a sessão', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const list = vi.fn().mockReturnValue(pending.promise);
  const chat = provider(list);
  const refresh = chat.value().refresh();
  chat.unmount();
  pending.resolve(page(7));
  await refresh;
  await vi.advanceTimersByTimeAsync(16000);
  chat.changeAppState('active');
  expect(chat.value().unreadTotal).toBe(0);
  expect(list).toHaveBeenCalledTimes(1);
});
