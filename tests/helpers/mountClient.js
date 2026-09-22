import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const mobile = fileURLToPath(new URL('../../../mobile/', import.meta.url));
const nativeRequire = createRequire(path.join(mobile, 'package.json'));
const { transformSync } = nativeRequire('@babel/core');

export function mountClient(entry, initialArgs, overrides = {}) {
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
  const cache = { products: [], homeProducts: [], cacheProducts(items) { cache.products = items; schedule(); } };
  const mocks = {
    react,
    'react-native': { AppState, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ fontScale: 1 }),
      ...Object.fromEntries(['Text', 'View', 'Pressable', 'ScrollView', 'RefreshControl', 'Image'].map(name => [name, name])) },
    '@react-navigation/native': { useIsFocused: () => focused },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' },
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

